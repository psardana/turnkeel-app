import { can, canReadEvent, streamShowsActor } from '@turnkeel/core';
import {
  STREAM_REPLAY_LIMIT,
  eventAreaOf,
  listEventsQuerySchema,
  toStreamMessage,
  type Event,
} from '@turnkeel/protocol';
import type { Hono } from 'hono';
import { stream, streamSSE } from 'hono/streaming';
import type { AppEnv } from '../http/context.js';
import { contextOf, type AppDeps } from '../http/deps.js';
import { personCaller } from '../http/principal.js';
import { parseQuery } from '../http/validate.js';
import { messages } from '../messages.js';
import { openWorkspace, reposOf } from '../services/access.js';
import { exportEvents, listEvents } from '../services/events.js';

/** The header a reconnecting stream sends, and the query value that stands in for it. */
const LAST_EVENT_ID_HEADER = 'last-event-id';
const LAST_EVENT_ID_QUERY = 'lastEventId';

/** The event list, the export and the live stream. */
export function eventRoutes(v1: Hono<AppEnv>, deps: AppDeps) {
  v1.get('/workspaces/:ws/events', async (c) => {
    const query = parseQuery(listEventsQuerySchema, c);
    return c.json(await listEvents(contextOf(c, deps), c.req.param('ws'), query));
  });

  v1.get('/workspaces/:ws/events/export', async (c) => {
    const { workspace, lines } = await exportEvents(contextOf(c, deps), c.req.param('ws'));
    c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${workspace.slug}-events.ndjson"`);
    c.header('Cache-Control', 'no-store');
    return stream(c, async (out) => {
      for await (const line of lines) await out.write(line);
    });
  });

  /**
   * The live stream. Open to every principal that can see the workspace;
   * it needs no `events.read`, because a message carries the names of the fields that
   * changed and never their values. A principal gets only the messages about
   * items it may read.
   */
  v1.get('/workspaces/:ws/stream', async (c) => {
    const ctx = contextOf(c, deps);
    const local = ctx.caller.principal.kind === 'user' && ctx.caller.principal.local;
    const workspace = await openWorkspace(ctx, c.req.param('ws'));
    const latest = await reposOf(deps.db, workspace.id).events.latestSeq();

    // A browser's EventSource sends Last-Event-ID only when it reconnects by itself.
    // A page that opens a new stream after its tab was hidden sends the query value.
    const lastId = c.req.header(LAST_EVENT_ID_HEADER) ?? c.req.query(LAST_EVENT_ID_QUERY);
    let fromSeq = latest;
    let reset = false;
    if (lastId !== undefined) {
      const last = /^\d{1,15}$/.test(lastId.trim()) ? Number(lastId.trim()) : Number.NaN;
      // An id that is not known, or too far behind: the client refetches what it shows.
      if (Number.isNaN(last) || last > latest || latest - last > STREAM_REPLAY_LIMIT) reset = true;
      else fromSeq = last;
    }

    c.header('X-Accel-Buffering', 'no');
    c.header('Cache-Control', 'no-cache, no-transform');
    return streamSSE(
      c,
      async (sse) => {
        let caller = ctx.caller;
        let closed = false;
        let finish = () => {};
        const finished = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const close = () => {
          closed = true;
          finish();
        };
        sse.onAbort(close);
        deps.streams.add(close);

        const heartbeat = setInterval(() => {
          sse.write(': heartbeat\n\n').catch(close);
        }, deps.heartbeatMs);

        // The session was checked when the stream was opened. It can end while the
        // stream is open: the person signs out elsewhere, or its time runs out. So a
        // signed-in person's session is looked at again from time to time, and the
        // stream ends when it is gone. Local mode has no session that ends before the
        // server does. An agent's token gets the same second look: a token that was
        // revoked, that expired or whose agent was disabled ends its stream.
        const { auth } = deps;
        const { headers } = c.req.raw;
        let checking = false;
        const look = (stillStands: () => Promise<boolean>) => () => {
          if (checking || closed) return;
          checking = true;
          stillStands()
            .then((stands) => {
              if (!stands) close();
            })
            .catch(close)
            .finally(() => {
              checking = false;
            });
        };
        const principal = ctx.caller.principal;
        const sessionCheck =
          principal.kind === 'agent'
            ? setInterval(
                look(() => deps.agentTokens.stillValid(ctx.caller)),
                deps.sessionCheckMs,
              )
            : auth === null || local || ctx.caller.user === null
              ? undefined
              : setInterval(
                  look(async () => {
                    // No refresh: this answer is already on its way and can set no cookie.
                    const session = await auth.api.getSession({
                      headers,
                      query: { disableRefresh: true },
                    });
                    return session?.user.id === ctx.caller.user?.id;
                  }),
                  deps.sessionCheckMs,
                );

        const deliver = async (event: Event) => {
          if (closed) return;
          // The token of this stream was revoked, or its agent disabled: it ends at once.
          if (
            principal.kind === 'agent' &&
            ((event.type === 'token.revoked' && event.subject.id === principal.tokenId) ||
              (event.type === 'agent.disabled' && event.subject.id === principal.agentId))
          ) {
            close();
            return;
          }
          // What a person holds can change while the stream is open. An event about
          // people is the moment it does, so the principal is read again before it is judged.
          if (eventAreaOf(event.type) === 'people' && caller.user !== null) {
            caller = await personCaller(deps.db, caller.user, local);
            if (!can(caller.principal, 'workspace.read', { workspaceId: workspace.id }).allowed) {
              close();
              return;
            }
          }
          if (canReadEvent(caller.principal, event).allowed) {
            await sse.writeSSE({
              id: String(event.seq),
              event: 'change',
              data: JSON.stringify(
                toStreamMessage(event, {
                  actorId: streamShowsActor(caller.principal, event),
                }),
              ),
            });
          }
          // Nothing is appended after `workspace.deleted`, and all access has stopped.
          if (event.type === 'workspace.deleted') close();
        };

        try {
          await sse.write(': connected\n\n');
          if (reset) {
            await sse.writeSSE({
              id: String(latest),
              event: 'reset',
              data: JSON.stringify({ seq: latest }),
            });
          }
          const subscription = await deps.bus.subscribe(workspace.id, fromSeq, (event) =>
            deliver(event).catch(close),
          );
          try {
            await finished;
          } finally {
            subscription.unsubscribe();
          }
        } finally {
          clearInterval(heartbeat);
          clearInterval(sessionCheck);
          deps.streams.delete(close);
        }
      },
      (error) => {
        deps.logger.error(messages.log.streamError, safeError(error));
        return Promise.resolve();
      },
    );
  });
}

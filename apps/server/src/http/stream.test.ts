import { repositories, findWorkspaceBySlug, workspaceScope } from '@turnkeel/db';
import { testEngines, waitFor } from '@turnkeel/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bodyOf,
  buildWorld,
  createTestServer,
  eventsOf,
  openStream,
  type OpenStream,
  type StreamBlock,
  type TestServer,
  type World,
} from '../testing/harness.js';

const messageOf = (block: StreamBlock) => JSON.parse(block.data ?? '') as StreamMessage;

describe.each(testEngines)('the stream on %s', (engine) => {
  let t: TestServer;
  let w: World;
  const open: OpenStream[] = [];
  const stream = async (
    ...args: Parameters<typeof openStream> extends [TestServer, ...infer Rest] ? Rest : never
  ) => {
    const opened = await openStream(t, ...args);
    open.push(opened);
    return opened;
  };
  let counter = 0;
  /** Creates a project in `acme` and returns it: one event, `project.created`. */
  const createProject = async (workspace = 'acme') => {
    counter += 1;
    const letters = String.fromCharCode(65 + (counter % 26), 65 + Math.floor(counter / 26));
    const response = await t.post(
      `/api/v1/workspaces/${workspace}/projects`,
      { name: `Stream ${counter}`, key: `S${letters}`, slug: `stream-${counter}` },
      w.owner,
    );
    expect(response.status).toBe(201);
    return bodyOf<Project>(response);
  };

  beforeAll(async () => {
    t = await createTestServer(engine, { runtime: { heartbeatMs: 150 } });
    w = await buildWorld(t);
  }, 120_000);
  afterAll(async () => {
    for (const opened of open) await opened.close();
    await t.stop();
  }, 60_000);

  it('answers as a server-sent event stream', async () => {
    const s = await stream('acme', w.owner);
    expect(s.response.status).toBe(200);
    expect(s.response.headers.get('content-type')).toContain('text/event-stream');
    expect((await s.next()).comment).toBe('connected');
  });

  it('sends a live event as `event: change` with the seq as its id', async () => {
    const s = await stream('acme', w.owner);
    const project = await createProject();
    const block = await s.nextMessage();
    const last = (await eventsOf(t, 'acme')).at(-1);
    expect(block.event).toBe('change');
    expect(block.id).toBe(String(last?.seq));
    const message = messageOf(block);
    expect(streamMessageSchema.safeParse(message).success).toBe(true);
    expect(message).toMatchObject({
      seq: last?.seq,
      type: 'project.created',
      subject: { type: 'project', id: project.id },
      projectId: project.id,
      actor: { kind: 'user', id: w.ids.owner },
    });
  });

  it('a message carries the names of the fields that changed and never their values', async () => {
    const s = await stream('acme', w.owner);
    const response = await t.patch(
      '/api/v1/workspaces/acme/projects/web',
      { name: 'A name that must not travel', repoUrl: 'https://example.com/secret-repo' },
      w.owner,
    );
    expect(response.status).toBe(200);
    const block = await s.nextMessage();
    const message = messageOf(block);
    expect(message.type).toBe('project.updated');
    expect(message.fields.sort()).toEqual(['name', 'repoUrl']);
    expect(Object.keys(message).sort()).toEqual(
      ['actor', 'at', 'fields', 'projectId', 'seq', 'subject', 'type'].sort(),
    );
    expect(Object.keys(message.actor).sort()).toEqual(['id', 'kind']);
    expect(block.data).not.toContain('A name that must not travel');
    expect(block.data).not.toContain('secret-repo');
    expect(block.data).not.toContain('Olive');
  });

  it('sends a comment line as a heartbeat', async () => {
    const s = await stream('acme', w.owner);
    expect((await s.next()).comment).toBe('connected');
    expect((await s.next()).comment).toBe('heartbeat');
    expect((await s.next()).comment).toBe('heartbeat');
  });

  it('replays the events after Last-Event-ID, in order, before the new ones', async () => {
    const before = (await eventsOf(t, 'acme')).length;
    const first = await createProject();
    const second = await createProject();
    const s = await stream('acme', w.owner, { lastEventId: before });
    const replayed = [messageOf(await s.nextMessage()), messageOf(await s.nextMessage())];
    expect(replayed.map((message) => [message.seq, message.subject.id])).toEqual([
      [before + 1, first.id],
      [before + 2, second.id],
    ]);
    const third = await createProject();
    expect(messageOf(await s.nextMessage())).toMatchObject({
      seq: before + 3,
      subject: { id: third.id },
    });
  });

  it('takes the last id from the query too, for a page that opens a new stream itself', async () => {
    const before = (await eventsOf(t, 'acme')).length;
    const project = await createProject();
    const s = await stream('acme', w.owner, { query: `?lastEventId=${before}` });
    expect(messageOf(await s.nextMessage())).toMatchObject({ subject: { id: project.id } });
  });

  it('without Last-Event-ID it sends only what happens from now on', async () => {
    await createProject();
    const s = await stream('acme', w.owner);
    expect((await s.next()).comment).toBe('connected');
    expect(await s.quiet(300)).toBe(true);
  });

  it('sends `event: reset` when the id is not known', async () => {
    const latest = (await eventsOf(t, 'acme')).length;
    for (const lastEventId of [latest + 50, 'not-a-number']) {
      const s = await stream('acme', w.owner, { lastEventId });
      const block = await s.nextMessage();
      expect(block.event).toBe('reset');
      expect(block.id).toBe(String(latest));
      expect(JSON.parse(block.data ?? '')).toEqual({ seq: latest });
    }
  });

  it('a principal does not receive another workspace’s events', async () => {
    const acme = await stream('acme', w.viewer);
    const globex = await stream('globex', w.stranger);
    expect((await acme.next()).comment).toBe('connected');
    expect((await globex.next()).comment).toBe('connected');

    const inGlobex = await createProject('globex');
    expect(messageOf(await globex.nextMessage()).subject.id).toBe(inGlobex.id);
    expect(await acme.quiet(400)).toBe(true);

    const inAcme = await createProject('acme');
    expect(messageOf(await acme.nextMessage()).subject.id).toBe(inAcme.id);
    expect(await globex.quiet(400)).toBe(true);
  });

  it('the stream of a workspace the caller is not in is the one 404, and 401 without a session', async () => {
    const outside = await t.get('/api/v1/workspaces/acme/stream', w.stranger);
    expect(outside.status).toBe(404);
    expect(await outside.json()).toEqual({
      error: { code: 'not_found', message: 'There is nothing at this address.' },
    });
    expect((await t.get('/api/v1/workspaces/acme/stream')).status).toBe(401);
  });

  it('events about members reach an Admin and not a Member', async () => {
    const forAdmin = await stream('acme', w.admin);
    const forMember = await stream('acme', w.member);
    expect((await forAdmin.next()).comment).toBe('connected');
    expect((await forMember.next()).comment).toBe('connected');

    const invited = await t.post(
      '/api/v1/workspaces/acme/invitations',
      { email: 'stream-guest@example.com', role: 'viewer' },
      w.owner,
    );
    expect(invited.status).toBe(201);
    const message = messageOf(await forAdmin.nextMessage());
    expect(message.type).toBe('member.invited');
    // The address is in the event and not in the message.
    expect(JSON.stringify(message)).not.toContain('stream-guest@example.com');
    expect(await forMember.quiet(400)).toBe(true);

    // The Member still gets what they may read.
    const project = await createProject();
    expect(messageOf(await forMember.nextMessage()).subject.id).toBe(project.id);
  });

  it('a person with a role in one project gets that project’s events and no other project’s', async () => {
    const s = await stream('acme', w.tester);
    expect((await s.next()).comment).toBe('connected');
    await t.patch('/api/v1/workspaces/acme/projects/web', { name: 'Not for the tester' }, w.owner);
    expect(await s.quiet(400)).toBe(true);
    await t.patch('/api/v1/workspaces/acme/projects/app', { name: 'For the tester' }, w.owner);
    expect(messageOf(await s.nextMessage())).toMatchObject({
      type: 'project.updated',
      projectId: w.app.id,
    });
  });

  it('a role change takes effect on an open stream', async () => {
    const s = await stream('acme', w.viewer);
    expect((await s.next()).comment).toBe('connected');
    // As a Viewer: nothing about members.
    await t.post(
      '/api/v1/workspaces/acme/invitations',
      { email: 'g1@example.com', role: 'viewer' },
      w.owner,
    );
    expect(await s.quiet(400)).toBe(true);
    // Made Admin, the same stream now carries them, starting with the change itself.
    await t.patch(`/api/v1/workspaces/acme/members/${w.ids.viewer}`, { role: 'admin' }, w.owner);
    expect(messageOf(await s.nextMessage()).type).toBe('member.role_changed');
    await t.post(
      '/api/v1/workspaces/acme/invitations',
      { email: 'g2@example.com', role: 'viewer' },
      w.owner,
    );
    expect(messageOf(await s.nextMessage()).type).toBe('member.invited');
  });

  it('ends the stream of a person who is removed from the workspace', async () => {
    const s = await stream('acme', w.reviewer);
    expect((await s.next()).comment).toBe('connected');
    const removed = await t.delete(`/api/v1/workspaces/acme/members/${w.ids.reviewer}`, w.owner);
    expect(removed.status).toBe(204);
    await s.ended();
  });

  it('sends `event: reset` when more than 1,000 events are missing', async () => {
    const workspace = await findWorkspaceBySlug(t.test.db, 'globex');
    if (!workspace) throw new Error('globex is missing');
    const start = (await eventsOf(t, 'globex')).length;
    // Events straight into the log: 1,001 of them is one more than a stream replays.
    await t.test.db.transaction(async (tx) => {
      const repos = repositories(tx, workspaceScope(workspace.id));
      for (let index = 0; index < 1001; index += 1) {
        await repos.events.append({
          type: 'workspace.updated',
          actor: { kind: 'user', id: w.ids.owner, name: 'Olive Owner' },
          via: 'web',
          requestId: '99999999-9999-4999-8999-999999999999',
          subject: { type: 'workspace', id: workspace.id },
          data: { name: ['a', 'b'] },
        });
      }
    });
    const tooFar = await stream('globex', w.stranger, { lastEventId: start });
    const reset = await tooFar.nextMessage();
    expect(reset.event).toBe('reset');
    expect(reset.id).toBe(String(start + 1001));

    // Exactly 1,000 behind is still replayed.
    const justInside = await stream('globex', w.stranger, { lastEventId: start + 1 });
    const firstReplayed = await justInside.nextMessage();
    expect(firstReplayed.event).toBe('change');
    expect(firstReplayed.id).toBe(String(start + 2));
  }, 60_000);

  it('ends the stream after `workspace.deleted`, which is its last message', async () => {
    const created = await t.post(
      '/api/v1/workspaces',
      { name: 'Short lived', slug: 'short-lived', handle: 'olive' },
      w.owner,
    );
    expect(created.status).toBe(201);
    const s = await stream('short-lived', w.owner);
    expect((await s.next()).comment).toBe('connected');
    expect((await t.delete('/api/v1/workspaces/short-lived', w.owner)).status).toBe(200);
    expect(messageOf(await s.nextMessage()).type).toBe('workspace.deleted');
    await s.ended();
  });

  it('stops delivering when the client goes away', async () => {
    const before = t.runtime.openStreams();
    const s = await openStream(t, 'acme', w.owner);
    expect((await s.next()).comment).toBe('connected');
    expect(t.runtime.openStreams()).toBe(before + 1);
    await s.close();
    // The server notices and lets go of the stream and its subscription.
    await waitFor(() => t.runtime.openStreams() === before, {
      timeoutMs: 20_000,
      what: 'the stream to be let go',
    });
    await createProject();
    expect((await t.get('/api/v1/workspaces/acme', w.owner)).status).toBe(200);
  });
});

describe.each(testEngines)('an open stream and the session it was opened with, on %s', (engine) => {
  let t: TestServer;
  beforeAll(async () => {
    // The session is looked at every 100 ms here, and once a minute when Turnkeel runs.
    t = await createTestServer(engine, { runtime: { sessionCheckMs: 100 } });
  }, 60_000);
  afterAll(async () => {
    await t.stop();
  }, 60_000);

  it('ends when the person signs out, and stays open until then', async () => {
    const owner = await t.signIn('olive@example.com', 'Olive Owner');
    await t.post('/api/v1/workspaces', { name: 'Acme', slug: 'acme', handle: 'olive' }, owner);
    // The same person in a second browser, whose session goes on.
    const elsewhere = await t.signIn('olive@example.com');
    const opened = await openStream(t, 'acme', owner);
    const other = await openStream(t, 'acme', elsewhere);
    try {
      expect((await opened.next()).comment).toBe('connected');
      expect((await other.next()).comment).toBe('connected');

      // Several checks pass, and the stream still delivers.
      await new Promise((resolve) => setTimeout(resolve, 350));
      const created = await t.post(
        '/api/v1/workspaces/acme/projects',
        { name: 'Kept', key: 'KEPT', slug: 'kept' },
        owner,
      );
      expect(created.status).toBe(201);
      expect(JSON.parse((await opened.nextMessage()).data ?? '')).toMatchObject({
        type: 'project.created',
      });

      const out = await t.request('POST', '/api/auth/sign-out', {
        as: owner,
        json: {},
        headers: { origin: 'http://localhost:4400' },
      });
      expect(out.status).toBe(200);
      await opened.ended(5000);

      // The other session's stream is not touched.
      await t.post(
        '/api/v1/workspaces/acme/projects',
        { name: 'After', key: 'AFTER', slug: 'after' },
        elsewhere,
      );
      const messages = [await other.nextMessage(), await other.nextMessage()];
      expect(messages.map((block) => block.event)).toEqual(['change', 'change']);
      await waitFor(() => t.runtime.openStreams() === 1, { what: 'the ended stream to be gone' });
    } finally {
      await opened.close();
      await other.close();
    }
  }, 60_000);

  it('a stream opened with a token ends at the next look after the token expires', async () => {
    const owner = await t.signIn('olive@example.com', 'Olive Owner');
    expect(
      (
        await t.post(
          '/api/v1/workspaces',
          { name: 'Tokens', slug: 'tokens', handle: 'olive' },
          owner,
        )
      ).status,
    ).toBe(201);
    const project = await bodyOf<Project>(
      await t.post(
        '/api/v1/workspaces/tokens/projects',
        { name: 'P', key: 'PP', slug: 'pp' },
        owner,
      ),
    );
    const agent = await bodyOf<Agent>(
      await t.post('/api/v1/workspaces/tokens/agents', { name: 'expiring', kind: 'other' }, owner),
    );
    const made = await bodyOf<CreateTokenResponse>(
      await t.post(
        `/api/v1/agents/${agent.id}/tokens`,
        {
          name: 'CI',
          scopes: ['cards:read'],
          projectIds: [project.id],
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
        owner,
      ),
    );
    const withToken: TestServer['request'] = (method, path, options = {}) =>
      t.request(method, path, {
        ...options,
        headers: { ...options.headers, authorization: `Bearer ${made.value}` },
      });
    const opened = await openStream({ ...t, request: withToken }, 'tokens', undefined);
    try {
      expect((await opened.next()).comment).toBe('connected');
      // Several looks pass while the token still works, and the stream stays open.
      expect(await opened.quiet(350)).toBe(true);

      // The token expires in the database. No event says so, so only a look can see it.
      await queryRows(
        t.test.db,
        sql`update agent_tokens set expires_at = now() - interval '1 second' where id = ${made.token.id}::uuid returning id`,
      );
      await opened.ended(5000);
    } finally {
      await opened.close();
    }
  }, 60_000);
});

import { can, canReadEvent, type Principal } from '@turnkeel/core';
import type { WorkspaceRow } from '@turnkeel/db';
import {
  eventAreas,
  eventTypesByArea,
  type Event,
  type EventPage,
  type EventType,
  type ListEventsQuery,
} from '@turnkeel/protocol';
import type { ServiceContext } from './context.js';

/** How many pages one request reads from the log at most while it looks for events the caller may see. */
const MAX_SCANNED_PAGES = 20;

/**
 * The event types of the areas the principal may read at all in this workspace, so
 * the database leaves the others out. Whether one event may be read is still asked
 * of `canReadEvent`, event by event.
 */
function readableTypes(
  principal: Principal,
  workspaceId: string,
  area: ListEventsQuery['area'],
): EventType[] {
  const types: EventType[] = [];
  for (const candidate of area ? [area] : eventAreas) {
    if (candidate === 'people' && !can(principal, 'member.read', { workspaceId }).allowed) {
      continue;
    }
    if (candidate === 'agents' && !can(principal, 'agent.read', { workspaceId }).allowed) {
      continue;
    }
    types.push(...eventTypesByArea[candidate]);
  }
  return types;
}

/**
 * `GET /workspaces/:ws/events`, under `events.read`: the Activity view and the
 * history of one item, newest first, paged by `seq`. A person sees only
 * the events about items they may read.
 */
export async function listEvents(
  ctx: ServiceContext,
  slug: string,
  query: ListEventsQuery,
): Promise<EventPage> {
  const workspace = await openWorkspace(ctx, slug);
  const { principal } = ctx.caller;
  await authorize(ctx, 'events.read', {
    workspaceId: workspace.id,
    projectId: query.project ?? null,
  });
  const repos = reposOf(ctx.db, workspace.id);
  const types = readableTypes(principal, workspace.id, query.area);

  const items: Event[] = [];
  let before = query.before;
  for (let page = 0; page < MAX_SCANNED_PAGES; page += 1) {
    const batch = await repos.events.list({
      projectId: query.project,
      types,
      actorId: query.actor,
      subjectId: query.subject,
      from: query.from === undefined ? undefined : new Date(query.from),
      to: query.to === undefined ? undefined : new Date(query.to),
      before,
      limit: query.limit,
    });
    for (const [index, event] of batch.items.entries()) {
      if (!canReadEvent(principal, event).allowed) continue;
      items.push(event);
      if (items.length === query.limit) {
        const more = index < batch.items.length - 1 || batch.nextBefore !== null;
        return { items, nextBefore: more ? event.seq : null };
      }
    }
    if (batch.nextBefore === null) return { items, nextBefore: null };
    before = batch.nextBefore;
  }
  // Many events in a row that the caller may not read: the next request goes on from here.
  return { items, nextBefore: before ?? null };
}

/**
 * `GET /workspaces/:ws/events/export`, under `events.export`: the whole log, oldest
 * first, one JSON object on each line (NDJSON). A person's session only.
 */
export async function exportEvents(
  ctx: ServiceContext,
  slug: string,
): Promise<{ workspace: WorkspaceRow; lines: AsyncGenerator<string, void, void> }> {
  const workspace = await openWorkspace(ctx, slug);
  const { principal } = ctx.caller;
  await authorize(ctx, 'events.export', { workspaceId: workspace.id });
  const repos = reposOf(ctx.db, workspace.id);

  async function* lines() {
    for await (const event of repos.events.all()) {
      if (canReadEvent(principal, event).allowed) yield `${JSON.stringify(event)}\n`;
    }
  }
  return { workspace, lines: lines() };
}

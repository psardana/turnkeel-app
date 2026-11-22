import type { Event, EventType } from '@turnkeel/protocol';
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, max } from 'drizzle-orm';
import { isTransaction, type Executor } from '../database.js';
import { NotInTransactionError } from '../errors.js';
import { appendEvent, toEvent, type EventInput } from '../events/append.js';
import { events } from '../schema/index.js';
import type { WorkspaceScope } from '../scope.js';

/** The filters of the Activity view. */
export interface EventFilter {
  projectId?: string | undefined;
  /** For the area filter: the types of that area. */
  types?: readonly EventType[] | undefined;
  actorId?: string | undefined;
  /** For the History of one item. */
  subjectId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  /** Only events with a lower `seq`: the `nextBefore` of the page before. */
  before?: number | undefined;
  limit: number;
}

export function eventsRepository(executor: Executor, scope: WorkspaceScope) {
  const inWorkspace = eq(events.workspaceId, scope.workspaceId);

  return {
    /** Appends an event to this workspace. See `appendEvent`. */
    async append(input: Omit<EventInput, 'workspaceId'>): Promise<Event> {
      if (!isTransaction(executor)) throw new NotInTransactionError('events.append');
      return appendEvent(executor, { ...input, workspaceId: scope.workspaceId });
    },

    /** One page, newest first. `nextBefore` is null when nothing older matches. */
    async list(filter: EventFilter): Promise<{ items: Event[]; nextBefore: number | null }> {
      if (filter.types?.length === 0) return { items: [], nextBefore: null };
      const rows = await executor
        .select()
        .from(events)
        .where(
          and(
            inWorkspace,
            filter.projectId === undefined ? undefined : eq(events.projectId, filter.projectId),
            filter.types === undefined ? undefined : inArray(events.type, [...filter.types]),
            filter.actorId === undefined ? undefined : eq(events.actorId, filter.actorId),
            filter.subjectId === undefined ? undefined : eq(events.subjectId, filter.subjectId),
            filter.from === undefined ? undefined : gte(events.at, filter.from),
            filter.to === undefined ? undefined : lte(events.at, filter.to),
            filter.before === undefined ? undefined : lt(events.seq, filter.before),
          ),
        )
        .orderBy(desc(events.seq))
        .limit(filter.limit + 1);
      const page = rows.slice(0, filter.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toEvent),
        nextBefore: rows.length > filter.limit && last ? last.seq : null,
      };
    },

    /** The events after a `seq`, oldest first: what a stream replays. */
    async listAfter(afterSeq: number, limit: number): Promise<Event[]> {
      const rows = await executor
        .select()
        .from(events)
        .where(and(inWorkspace, gt(events.seq, afterSeq)))
        .orderBy(asc(events.seq))
        .limit(limit);
      return rows.map(toEvent);
    },

    /** The `seq` of the newest event, or 0 when the workspace has none. */
    async latestSeq(): Promise<number> {
      const rows = await executor
        .select({ seq: max(events.seq) })
        .from(events)
        .where(inWorkspace);
      return rows[0]?.seq ?? 0;
    },

    /** The whole log, oldest first, read in batches: what the export writes as NDJSON. */
    async *all(batchSize = 500): AsyncGenerator<Event, void, void> {
      let afterSeq = 0;
      for (;;) {
        const batch = await this.listAfter(afterSeq, batchSize);
        for (const event of batch) yield event;
        const last = batch[batch.length - 1];
        if (batch.length < batchSize || !last) return;
        afterSeq = last.seq;
      }
    },
  };
}

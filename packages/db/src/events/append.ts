import { randomUUID } from 'node:crypto';
import {
  eventDataSchema,
  eventSubjectSchema,
  eventTypes,
  eventVias,
  idSchema,
  actorSchema,
  type Actor,
  type Event,
  type EventData,
  type EventSubject,
  type EventType,
  type EventVia,
  type Ref,
} from '@turnkeel/protocol';
import { sql } from 'drizzle-orm';
import { isTransaction, queryRows, type Transaction } from '../database.js';
import { InvalidEventError, NotInTransactionError, UnknownWorkspaceError } from '../errors.js';
import { events } from '../schema/index.js';

/** The channel every appended event is announced on. A notification carries ids only. */
export const EVENT_CHANNEL = 'turnkeel_events';

/** What a caller says about an event. `seq`, `id` and, unless given, `at` are filled in here. */
export interface EventInput {
  workspaceId: string;
  projectId?: string | null;
  type: EventType;
  actor: Actor;
  via: EventVia;
  /** The same for all the events of one request. */
  requestId: string;
  tokenId?: string | null;
  sessionId?: string | null;
  subject: EventSubject;
  data?: EventData;
  /**
   * The server's clock unless given. Only the importer and the demo's seeding write a
   * time that is not the clock's.
   */
  at?: Date;
}

/** Keys that never belong in an event's data, at any depth. */
const secretKeys = new Set([
  'token',
  'tokenhash',
  'token_hash',
  'secret',
  'secrets',
  'password',
  'magiclink',
  'signinlink',
]);

/** What an event may say of a key: that it was set, replaced or removed, never its value. */
const apiKeyChanges = new Set(['set', 'replaced', 'removed']);

function findSecretKey(value: unknown, depth = 0): string | null {
  if (depth > 8 || typeof value !== 'object' || value === null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSecretKey(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [key, inner] of Object.entries(value)) {
    if (secretKeys.has(key.toLowerCase())) return key;
    // The assistant's key is named only by what happened to it.
    if (key.toLowerCase() === 'apikey' && !apiKeyChanges.has(inner as string)) return key;
    const found = findSecretKey(inner, depth + 1);
    if (found) return found;
  }
  return null;
}

function check(input: EventInput): void {
  const problems: string[] = [];
  if (!(eventTypes as readonly string[]).includes(input.type)) {
    problems.push(`unknown type ${String(input.type)}`);
  }
  if (!(eventVias as readonly string[]).includes(input.via)) {
    problems.push(`unknown channel ${String(input.via)}`);
  }
  if (!actorSchema.safeParse(input.actor).success) problems.push('actor is not { kind, id, name }');
  if (!eventSubjectSchema.safeParse(input.subject).success) {
    problems.push('subject is not { type, id, owner? } with a known type');
  }
  for (const [name, value] of [
    ['workspaceId', input.workspaceId],
    ['requestId', input.requestId],
    ['projectId', input.projectId],
    ['tokenId', input.tokenId],
    ['sessionId', input.sessionId],
  ] as const) {
    if (value !== undefined && value !== null && !idSchema.safeParse(value).success) {
      problems.push(`${name} is not a UUID`);
    }
  }
  if (!eventDataSchema.safeParse(input.data ?? {}).success) problems.push('data is not an object');
  const secret = findSecretKey(input.data ?? {});
  if (secret) {
    problems.push(
      `data has the key "${secret}"; an event names such a field and never holds its value (R48)`,
    );
  }
  if (problems.length > 0) {
    throw new InvalidEventError(`This event cannot be appended: ${problems.join('; ')}.`);
  }
}

/**
 * Appends one event, inside the caller's transaction, so the event commits with the
 * change it records or not at all.
 *
 * It first takes the next `seq` from the workspace's counter row. That update locks
 * the row until the transaction ends, so a second writer in the same workspace waits
 * here until the first has committed. The order of `seq` is therefore the order of
 * commit, without gaps, and a reader that resumes from a `seq` misses nothing.
 * A transaction that rolls back gives its number back with everything else.
 *
 * Then it announces the event on `EVENT_CHANNEL`. Postgres delivers a notification
 * when the transaction commits and drops it when it rolls back. The payload is the
 * workspace id and the `seq`, nothing more.
 */
export async function appendEvent(tx: Transaction, input: EventInput): Promise<Event> {
  if (!isTransaction(tx)) throw new NotInTransactionError('appendEvent');
  check(input);

  const workspaceId = input.workspaceId.toLowerCase();
  const counter = await queryRows<{ seq: string }>(
    tx,
    sql`update event_counters set last_seq = last_seq + 1 where workspace_id = ${workspaceId}::uuid returning last_seq::text as seq`,
  );
  const first = counter[0];
  if (!first) throw new UnknownWorkspaceError(workspaceId);
  const seq = Number(first.seq);

  const owner: Ref | undefined = input.subject.owner;
  const row = {
    id: randomUUID(),
    workspaceId,
    seq,
    projectId: input.projectId ?? null,
    at: input.at ?? new Date(),
    actorKind: input.actor.kind,
    actorId: input.actor.id,
    actorName: input.actor.name,
    via: input.via,
    tokenId: input.tokenId ?? null,
    sessionId: input.sessionId ?? null,
    requestId: input.requestId,
    type: input.type,
    subjectType: input.subject.type,
    subjectId: input.subject.id,
    subjectOwnerKind: owner?.kind ?? null,
    subjectOwnerId: owner?.id ?? null,
    data: input.data ?? {},
  };
  await tx.insert(events).values(row);
  await tx.execute(sql`select pg_notify(${EVENT_CHANNEL}, ${`${workspaceId}:${seq}`})`);

  return toEvent(row);
}

/**
 * Takes the workspace's event lock without appending anything, and holds it until the
 * transaction ends. A write whose check must not race another write in the same
 * workspace takes it first: for example, that a new project's slug does not equal
 * another project's key.
 */
export async function lockWorkspace(tx: Transaction, workspaceId: string): Promise<void> {
  if (!isTransaction(tx)) throw new NotInTransactionError('lockWorkspace');
  const rows = await queryRows<{ seq: string }>(
    tx,
    sql`select last_seq::text as seq from event_counters where workspace_id = ${workspaceId}::uuid for update`,
  );
  if (rows.length === 0) throw new UnknownWorkspaceError(workspaceId);
}

export type EventRow = typeof events.$inferSelect;

/** A row of the event log as the protocol's event. */
export function toEvent(row: EventRow): Event {
  const subject: EventSubject = {
    type: row.subjectType as EventSubject['type'],
    id: row.subjectId,
  };
  if (row.subjectOwnerKind !== null && row.subjectOwnerId !== null) {
    subject.owner = { kind: row.subjectOwnerKind as Ref['kind'], id: row.subjectOwnerId };
  }
  return {
    seq: row.seq,
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    at: row.at.toISOString(),
    actor: { kind: row.actorKind, id: row.actorId, name: row.actorName },
    via: row.via,
    tokenId: row.tokenId,
    sessionId: row.sessionId,
    requestId: row.requestId,
    type: row.type as EventType,
    subject,
    data: row.data,
  };
}

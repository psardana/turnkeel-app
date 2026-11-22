import { principalRef, type PersonPrincipal } from '@turnkeel/core';
import type { Database, Repositories, Stamp, Transaction } from '@turnkeel/db';
import type { Event, EventData, EventSubject, EventType, User } from '@turnkeel/protocol';
import type { Caller } from '../http/context.js';
import { HttpError } from '../http/errors.js';
import type { Logger } from '../log.js';
import type { Mailer } from '../mail/mailer.js';
import { messages } from '../messages.js';

/**
 * Keeps the first result of a write that carried an idempotency key, in the
 * transaction of that write. Null when the request carried no key.
 */
export interface KeyedWrite {
  save(tx: Transaction, workspaceId: string, body: unknown): Promise<void>;
  /**
   * Replaces the kept answer after the write has committed. Only for an answer that
   * says something the transaction could not know yet, which is what became of an
   * invitation's mail.
   */
  update(body: unknown): Promise<void>;
}

/** What the services know about the install they run in. */
export interface ServerSettings {
  /** `local` without sign-in, `server` with it. */
  readonly mode: 'local' | 'server';
  /** `TURNKEEL_OPEN_SIGNUP=true`. */
  readonly openSignup: boolean;
  /** The address links in mail start with. */
  readonly baseUrl: () => string;
  /**
   * `TURNKEEL_PUBLIC_URL`, or null when it is not set: the public changelog's feed needs
   * absolute URLs and is served only with it.
   */
  readonly publicUrl?: string | null;
}

/**
 * What a service function gets about the request it serves. A REST route and an MCP
 * tool build one and call the same function: handlers are thin.
 */
export interface ServiceContext {
  readonly db: Database;
  readonly caller: Caller;
  /** The same for every event of the request. */
  readonly requestId: string;
  readonly keyed: KeyedWrite | null;
  readonly settings: ServerSettings;
  readonly mailer: Mailer;
  readonly logger: Logger;
  /** Bounds how many `access.denied` events an agent's refused writes append. */
  readonly denials: DeniedLimiter;
  /** The connectors this server has, which a gate's check names. */
  readonly connectors: ConnectorRuntime;
  /**
   * Where files are kept, for Send now, which runs the publishing job's path for one post.
   * Null on a server with no file storage; left out where none is needed.
   */
  readonly storage?: FileStorage | null;
  /**
   * The time the writes of this context are stamped with, in place of the server's clock.
   * Only the demo's seed sets it, so its history reads like a few weeks of work. A request
   * never has one.
   */
  readonly clock?: () => Date;
}

/**
 * The transaction of a write whose answer is kept for its idempotency key: the
 * answer `run` returns, the final one the caller gets, is saved in the same transaction,
 * so it is kept if and only if the write commits. Without a key it is a transaction.
 */
export function keptTransaction<T>(
  ctx: ServiceContext,
  workspaceId: string,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    const answer = await run(tx);
    await ctx.keyed?.save(tx, workspaceId, answer);
    return answer;
  });
}

/** Who writes, and when: the server's clock, never the device's. */
export function stampOf(ctx: ServiceContext, at?: Date): Stamp {
  return { by: principalRef(ctx.caller.principal), at: at ?? ctx.clock?.() ?? new Date() };
}

/** What an event says besides who, how and in which request. */
export interface EventDraft {
  type: EventType;
  subject: EventSubject;
  projectId?: string | null;
  data?: EventData;
  at?: Date;
}

/** Appends an event for this request, in the transaction the repositories were made on. */
export function appendEvent(
  ctx: ServiceContext,
  repos: Repositories,
  draft: EventDraft,
): Promise<Event> {
  const at = draft.at ?? ctx.clock?.();
  return repos.events.append({
    ...draft,
    ...(at === undefined ? {} : { at }),
    actor: ctx.caller.actor,
    via: ctx.caller.via,
    tokenId: ctx.caller.tokenId,
    requestId: ctx.requestId,
  });
}

/** The caller as a person with an account. Throws 403 for an agent or the system. */
export function requirePerson(ctx: ServiceContext): { principal: PersonPrincipal; user: User } {
  const { principal, user } = ctx.caller;
  if (principal.kind !== 'user' || user === null) {
    throw new HttpError('forbidden', messages.errors.personOnly);
  }
  return { principal, user };
}

/**
 * The fields of `patch` whose value differs from `current`, as `{ field: [before, after] }`:
 * what an update event carries. Empty when the patch changes nothing.
 */
export function changesOf<Row extends object>(
  current: Row,
  patch: Partial<Record<keyof Row, unknown>>,
): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [field, after] of Object.entries(patch)) {
    if (after === undefined) continue;
    const before = (current as Record<string, unknown>)[field];
    if (JSON.stringify(before) !== JSON.stringify(after)) changes[field] = [before, after];
  }
  return changes;
}

/** The new values of a set of changes, for the repository's update. */
export function afterValues(changes: Record<string, [unknown, unknown]>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(changes).map(([field, [, after]]) => [field, after]));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${stableJson(inner)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

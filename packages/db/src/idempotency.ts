import { randomUUID } from 'node:crypto';
import type { PrincipalRef } from '@turnkeel/protocol';
import type { Executor } from './database.js';
import { idempotencyRecords } from './schema/index.js';

export type IdempotencyRecordRow = typeof idempotencyRecords.$inferSelect;

/** How long the first result of a keyed write is kept. */
export const IDEMPOTENCY_HOURS = 24;

/**
 * What an idempotency key is scoped to: the principal, for an agent the token it
 * used, and the tool name or the method and path. A record is found by these, not by a
 * workspace, because the lookup happens before the write has run. The path of a
 * workspace's route carries its slug, and the kept answer is given again only after
 * the caller's access to the record's workspace has been checked anew.
 */
export interface IdempotencyKey {
  principal: PrincipalRef;
  /**
   * The token an agent used. Two tokens of the same agent do not share keys, so a token
   * never gets the kept answer of a request another token made. Null, or left out, for
   * a person.
   */
  tokenId?: string | null;
  scope: string;
  key: string;
}

function matching(where: IdempotencyKey) {
  const tokenId = where.tokenId ?? null;
  return and(
    eq(idempotencyRecords.principalKind, where.principal.kind),
    eq(idempotencyRecords.principalId, where.principal.id),
    tokenId === null
      ? isNull(idempotencyRecords.tokenId)
      : eq(idempotencyRecords.tokenId, tokenId.toLowerCase()),
    eq(idempotencyRecords.scope, where.scope),
    eq(idempotencyRecords.key, where.key),
  );
}

/** The record of an earlier write with this key, unless it has expired. */
export async function findIdempotencyRecord(
  executor: Executor,
  where: IdempotencyKey,
  now: Date = new Date(),
): Promise<IdempotencyRecordRow | null> {
  const rows = await executor.select().from(idempotencyRecords).where(matching(where));
  const record = rows[0];
  if (!record || record.expiresAt.getTime() <= now.getTime()) return null;
  return record;
}

/**
 * Keeps the first result of a keyed write, in the transaction of that write. An
 * expired record with the same key is replaced. A second writer with the same key
 * fails on the unique index, so only one result is ever kept.
 */
export async function saveIdempotencyRecord(
  executor: Executor,
  input: IdempotencyKey & {
    workspaceId: string;
    requestHash: string;
    /** What the write answered, as JSON: for example `{ status, body }`. Not null. */
    response: unknown;
  },
  now: Date = new Date(),
): Promise<IdempotencyRecordRow> {
  if (input.response === null || input.response === undefined) {
    throw new TypeError('An idempotency record needs the response it stands for.');
  }
  await executor
    .delete(idempotencyRecords)
    .where(and(matching(input), lte(idempotencyRecords.expiresAt, now)));
  const rows = await executor
    .insert(idempotencyRecords)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      principalKind: input.principal.kind,
      principalId: input.principal.id,
      tokenId: input.tokenId?.toLowerCase() ?? null,
      key: input.key,
      scope: input.scope,
      requestHash: input.requestHash,
      response: input.response,
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_HOURS * 60 * 60 * 1000),
      createdAt: now,
    })
    .returning();
  return rows[0]!;
}

/**
 * Changes the kept answer of a keyed write. For the rare write whose answer says
 * something that is known only after its transaction: an invitation's record is saved
 * with the invitation and corrected when its mail could not be sent. Returns false
 * when no record with this key is kept.
 */
export async function updateIdempotencyResponse(
  executor: Executor,
  where: IdempotencyKey,
  response: unknown,
): Promise<boolean> {
  if (response === null || response === undefined) {
    throw new TypeError('An idempotency record needs the response it stands for.');
  }
  const rows = await executor
    .update(idempotencyRecords)
    .set({ response })
    .where(matching(where))
    .returning({ id: idempotencyRecords.id });
  return rows.length > 0;
}

/** Removes the records that have expired. Returns how many. */
export async function deleteExpiredIdempotencyRecords(
  executor: Executor,
  now: Date = new Date(),
): Promise<number> {
  const rows = await executor
    .delete(idempotencyRecords)
    .where(lte(idempotencyRecords.expiresAt, now))
    .returning({ id: idempotencyRecords.id });
  return rows.length;
}

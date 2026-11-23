import { createHash } from 'node:crypto';
import { principalRef } from '@turnkeel/core';
import {
  findIdempotencyRecord,
  saveIdempotencyRecord,
  updateIdempotencyResponse,
  type Database,
  type IdempotencyKey,
} from '@turnkeel/db';
import type { Context } from 'hono';
import { messages } from '../messages.js';
import type { KeyedWrite } from '../services/context.js';
import { HttpError } from './errors.js';

/** The header a POST may carry. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** Set on an answer that is the kept result of an earlier request with the same key. */
export const REPLAYED_HEADER = 'Idempotency-Replayed';

/** JSON with the keys of every object in order, so the same request always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

interface Kept {
  status: number;
  body: unknown;
}

/** The answer of a keyed write: the kept one, or the one just made. */
export interface KeyedAnswer {
  status: number;
  body: unknown;
  replayed: boolean;
}

/**
 * Runs a write once per idempotency key, on any channel. `scope` is the method and
 * the path of a REST request, or the tool's name for MCP. The key is scoped to the
 * principal (for an agent, to the token it used) and to `scope`. A repeat with the same
 * key and the same request gets the first answer back and writes nothing; the same key
 * with another request is refused with 409. `run` gets a `KeyedWrite` and must call its
 * `save` inside the transaction of the write, so the result is kept if and only if the
 * write commits.
 *
 * A kept answer is given again only to a caller who may still have it: `check` is
 * asked first, with the workspace the record was kept in, and throws what the write
 * itself would throw now, such as the one 404 for a person removed since.
 */
export async function runKeyedWrite(
  db: Database,
  caller: Caller,
  input: {
    scope: string;
    key: string;
    status: number;
    body: unknown;
    check: (workspaceId: string) => Promise<void>;
    /** What a key used with another request is refused with: MCP names `idempotencyKey`. */
    reusedMessage?: string;
  },
  run: (keyed: KeyedWrite) => Promise<unknown>,
): Promise<KeyedAnswer> {
  const where: IdempotencyKey = {
    principal: principalRef(caller.principal),
    tokenId: caller.principal.kind === 'agent' ? caller.principal.tokenId : null,
    scope: input.scope,
    key: input.key,
  };
  const requestHash = createHash('sha256').update(canonical(input.body)).digest('hex');

  const replay = async (): Promise<KeyedAnswer | null> => {
    const record = await findIdempotencyRecord(db, where);
    if (!record) return null;
    // Access first: a caller who may no longer reach the workspace or do the action
    // learns nothing from the record, not even that the key was used.
    await input.check(record.workspaceId);
    if (record.requestHash !== requestHash) {
      throw new HttpError(
        'idempotency_key_reused',
        input.reusedMessage ?? messages.errors.idempotencyKeyReused,
      );
    }
    const kept = record.response as Kept;
    return { status: kept.status, body: kept.body, replayed: true };
  };

  const earlier = await replay();
  if (earlier) return earlier;

  const keyed: KeyedWrite = {
    async save(tx, workspaceId, body) {
      await saveIdempotencyRecord(tx, {
        ...where,
        workspaceId,
        requestHash,
        response: { status: input.status, body } satisfies Kept,
      });
    },
    async update(body) {
      await updateIdempotencyResponse(db, where, { status: input.status, body } satisfies Kept);
    },
  };

  try {
    return { status: input.status, body: await run(keyed), replayed: false };
  } catch (error) {
    // Two requests with the same key at once: one commits, and the other fails, on
    // the unique index of the records or on whatever the first one's write made
    // impossible, such as a slug that is now taken. Either way the first one's
    // result is the answer. A request that failed alone kept nothing, and its own
    // error stands.
    const first = await replay();
    if (first) return first;
    throw error;
  }
}

/**
 * Runs a POST once per idempotency key, as `runKeyedWrite` does, with the key in
 * the `Idempotency-Key` header and the scope the method and the path. Without the header
 * it just runs. A kept answer carries `Idempotency-Replayed: true`.
 */
export async function runKeyed(
  c: Context<AppEnv>,
  db: Database,
  input: {
    status: 200 | 201;
    body: unknown;
    check: (workspaceId: string) => Promise<void>;
  },
  run: (keyed: KeyedWrite | null) => Promise<unknown>,
): Promise<Response> {
  const key = c.req.header(IDEMPOTENCY_HEADER)?.trim();
  if (key === undefined) return c.json(await run(null), input.status);
  if (key.length < 1 || key.length > 200) {
    throw new HttpError('bad_request', messages.errors.badIdempotencyKey);
  }
  const answer = await runKeyedWrite(
    db,
    c.get('caller'),
    { scope: `${c.req.method} ${new URL(c.req.url).pathname}`, key, ...input },
    run,
  );
  if (answer.replayed) c.header(REPLAYED_HEADER, 'true');
  return c.json(answer.body, answer.status as 200 | 201);
}

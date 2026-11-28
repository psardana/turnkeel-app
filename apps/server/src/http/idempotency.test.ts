import type { AgentPrincipal } from '@turnkeel/core';
import {
  createTestDatabase,
  createTestWorkspace,
  testEngines,
  type TestDatabase,
  type TestWorkspace,
} from '@turnkeel/db/testing';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppEnv, Caller } from './context.js';
import { HttpError, notFound } from './errors.js';
import { REPLAYED_HEADER, runKeyed } from './idempotency.js';

const agentId = '55555555-5555-4555-8555-555555555555';
const tokenA = '66666666-6666-4666-8666-666666666666';
const tokenB = '77777777-7777-4777-8777-777777777777';

/**
 * `runKeyed` on its own, in a small app: the API alone does not show
 * a kept answer of an agent this simply. The route keeps a counter
 * as its answer, which tells a first run from a kept answer.
 */
describe.each(testEngines)('runKeyed on %s', (engine) => {
  let test: TestDatabase;
  let ws: TestWorkspace;
  let runs = 0;
  /** What the check before a kept answer says: the caller still may, or the one 404. */
  let stillAllowed = true;

  const callerOf = (tokenId: string): Caller => {
    const principal: AgentPrincipal = {
      kind: 'agent',
      agentId,
      tokenId,
      workspaceId: ws.workspace.id,
      scopes: ['cards:write'],
      projectIds: [],
      workspaceWide: false,
    };
    return {
      principal,
      actor: { kind: 'agent', id: agentId, name: 'keyed' },
      via: 'rest',
      tokenId,
      user: null,
    };
  };

  function app() {
    const hono = new Hono<AppEnv>();
    hono.onError((error, c) => {
      if (error instanceof HttpError) {
        return c.json(error.body, error.status as ContentfulStatusCode);
      }
      throw error;
    });
    hono.use('*', async (c, next) => {
      c.set('caller', callerOf(c.req.header('x-token') ?? tokenA));
      await next();
    });
    hono.post('/write', async (c) => {
      const body: unknown = await c.req.json();
      const check = async (workspaceId: string) => {
        expect(workspaceId).toBe(ws.workspace.id);
        if (!stillAllowed) throw notFound();
        await Promise.resolve();
      };
      return runKeyed(c, test.db, { status: 201, body, check }, async (keyed) => {
        runs += 1;
        const answer = { run: runs };
        await test.db.transaction(
          (tx) => keyed?.save(tx, ws.workspace.id, answer) ?? Promise.resolve(),
        );
        return answer;
      });
    });
    return hono;
  }

  const post = (tokenId: string, key: string) =>
    app().request('http://localhost/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-token': tokenId },
      body: JSON.stringify({ same: true }),
    });

  beforeAll(async () => {
    test = await createTestDatabase(engine);
    ws = await createTestWorkspace(test.db);
  });
  afterAll(async () => {
    await test.destroy();
  });

  it('the same token gets its kept answer back', async () => {
    const first = await post(tokenA, 'k-1');
    expect(first.status).toBe(201);
    const kept = (await first.json()) as { run: number };
    const again = await post(tokenA, 'k-1');
    expect(again.headers.get(REPLAYED_HEADER)).toBe('true');
    expect(await again.json()).toEqual(kept);
  });

  it('another token of the same agent gets no kept answer, and runs as a request of its own', async () => {
    const first = (await (await post(tokenA, 'k-2')).json()) as { run: number };
    const other = await post(tokenB, 'k-2');
    expect(other.status).toBe(201);
    expect(other.headers.get(REPLAYED_HEADER)).toBeNull();
    expect(((await other.json()) as { run: number }).run).toBe(first.run + 1);
    // And from then on each token has its own kept answer.
    expect(await (await post(tokenA, 'k-2')).json()).toEqual(first);
    expect(((await (await post(tokenB, 'k-2')).json()) as { run: number }).run).toBe(first.run + 1);
  });

  it('a kept answer is given only after the check says the caller still may', async () => {
    expect((await post(tokenA, 'k-3')).status).toBe(201);
    stillAllowed = false;
    try {
      const replay = await post(tokenA, 'k-3');
      expect(replay.status).toBe(404);
      expect(replay.headers.get(REPLAYED_HEADER)).toBeNull();
    } finally {
      stillAllowed = true;
    }
  });
});

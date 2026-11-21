import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type Transaction } from '../database.js';
import { InvalidEventError, NotInTransactionError, UnknownWorkspaceError } from '../errors.js';
import { repositories } from '../repositories/index.js';
import { workspaceScope } from '../scope.js';
import {
  createTestDatabase,
  createTestWorkspace,
  deferred,
  postgresTestUrl,
  sleep,
  testEngines,
  type TestDatabase,
  type TestWorkspace,
} from '../testing/index.js';
import { EVENT_CHANNEL, appendEvent, lockWorkspace, type EventInput } from './append.js';

function input(ws: TestWorkspace, overrides: Partial<EventInput> = {}): EventInput {
  return {
    workspaceId: ws.workspace.id,
    type: 'workspace.updated',
    actor: { kind: 'user', id: ws.owner.id, name: ws.owner.name },
    via: 'web',
    requestId: randomUUID(),
    subject: { type: 'workspace', id: ws.workspace.id },
    data: { name: ['Example', 'Example Co'] },
    ...overrides,
  };
}

async function seqs(test: TestDatabase, ws: TestWorkspace): Promise<number[]> {
  const rows = await queryRows<{ seq: number }>(
    test.db,
    sql`select seq::int as seq from events where workspace_id = ${ws.workspace.id}::uuid order by seq`,
  );
  return rows.map((row) => row.seq);
}

describe.each(testEngines)('appendEvent on %s', (engine) => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase(engine);
  });

  afterAll(async () => {
    await test.destroy();
  });

  it('numbers the events of a workspace 1, 2, 3 without gaps', async () => {
    const ws = await createTestWorkspace(test.db);
    const first = await test.db.transaction((tx) => appendEvent(tx, input(ws)));
    const rest = await test.db.transaction(async (tx) => [
      await appendEvent(tx, input(ws)),
      await appendEvent(tx, input(ws)),
    ]);
    expect([first.seq, ...rest.map((event) => event.seq)]).toEqual([1, 2, 3]);
    expect(await seqs(test, ws)).toEqual([1, 2, 3]);
  });

  it('counts each workspace on its own', async () => {
    const a = await createTestWorkspace(test.db);
    const b = await createTestWorkspace(test.db);
    await test.db.transaction(async (tx) => {
      await appendEvent(tx, input(a));
      await appendEvent(tx, input(b));
      await appendEvent(tx, input(a));
    });
    expect(await seqs(test, a)).toEqual([1, 2]);
    expect(await seqs(test, b)).toEqual([1]);
  });

  it('a transaction that rolls back gives its number back', async () => {
    const ws = await createTestWorkspace(test.db);
    await test.db.transaction((tx) => appendEvent(tx, input(ws)));
    await expect(
      test.db.transaction(async (tx) => {
        const lost = await appendEvent(tx, input(ws));
        expect(lost.seq).toBe(2);
        throw new Error('the write failed after its event');
      }),
    ).rejects.toThrow('the write failed after its event');
    const next = await test.db.transaction((tx) => appendEvent(tx, input(ws)));
    expect(next.seq).toBe(2);
    expect(await seqs(test, ws)).toEqual([1, 2]);
  });

  it('stores the principal, the channel, the token and the request with the event', async () => {
    const ws = await createTestWorkspace(test.db);
    const requestId = randomUUID();
    const tokenId = randomUUID();
    const sessionId = randomUUID();
    const at = new Date('2026-11-11T09:30:00.000Z');
    const stored = await test.db.transaction(async (tx) => {
      await appendEvent(tx, input(ws, { requestId, type: 'project.created' }));
      return appendEvent(
        tx,
        input(ws, {
          requestId,
          type: 'member.joined',
          actor: { kind: 'agent', id: ws.owner.id, name: 'builder' },
          via: 'mcp',
          tokenId,
          sessionId,
          at,
          subject: {
            type: 'member',
            id: ws.member.id,
            owner: { kind: 'user', id: ws.owner.id },
          },
          data: { role: 'owner' },
        }),
      );
    });
    expect(stored).toMatchObject({
      seq: 2,
      workspaceId: ws.workspace.id,
      projectId: null,
      at: '2026-11-11T09:30:00.000Z',
      actor: { kind: 'agent', id: ws.owner.id, name: 'builder' },
      via: 'mcp',
      tokenId,
      sessionId,
      requestId,
      type: 'member.joined',
      subject: { type: 'member', id: ws.member.id, owner: { kind: 'user', id: ws.owner.id } },
      data: { role: 'owner' },
    });

    const read = await repositories(test.db, workspaceScope(ws.workspace.id)).events.listAfter(
      0,
      10,
    );
    expect(read).toHaveLength(2);
    expect(read[1]).toEqual(stored);
    // R24: all the events of one request carry the same requestId.
    expect(new Set(read.map((event) => event.requestId))).toEqual(new Set([requestId]));
  });

  it('the event commits with the change it records, or not at all', async () => {
    const ws = await createTestWorkspace(test.db);
    const scope = workspaceScope(ws.workspace.id);
    await expect(
      test.db.transaction(async (tx) => {
        const repos = repositories(tx, scope);
        await repos.workspace.update({ name: 'Renamed' }, { by: ws.by });
        await repos.events.append(input(ws));
        throw new Error('something failed before commit');
      }),
    ).rejects.toThrow('something failed before commit');
    expect((await repositories(test.db, scope).workspace.get())?.name).toBe(ws.workspace.name);
    expect(await seqs(test, ws)).toEqual([]);

    await test.db.transaction(async (tx) => {
      const repos = repositories(tx, scope);
      await repos.workspace.update({ name: 'Renamed' }, { by: ws.by });
      await repos.events.append(input(ws));
    });
    expect((await repositories(test.db, scope).workspace.get())?.name).toBe('Renamed');
    expect(await seqs(test, ws)).toEqual([1]);
  });

  it('refuses to run outside a transaction', async () => {
    const ws = await createTestWorkspace(test.db);
    await expect(appendEvent(test.db as unknown as Transaction, input(ws))).rejects.toBeInstanceOf(
      NotInTransactionError,
    );
    await expect(
      lockWorkspace(test.db as unknown as Transaction, ws.workspace.id),
    ).rejects.toBeInstanceOf(NotInTransactionError);
    await expect(
      repositories(test.db, workspaceScope(ws.workspace.id)).events.append(input(ws)),
    ).rejects.toBeInstanceOf(NotInTransactionError);
    expect(await seqs(test, ws)).toEqual([]);
  });

  it('refuses a workspace that does not exist', async () => {
    const ws = await createTestWorkspace(test.db);
    await expect(
      test.db.transaction((tx) => appendEvent(tx, input(ws, { workspaceId: randomUUID() }))),
    ).rejects.toBeInstanceOf(UnknownWorkspaceError);
  });

  it('refuses a type, a channel or a subject that the protocol does not have', async () => {
    const ws = await createTestWorkspace(test.db);
    const bad: Partial<EventInput>[] = [
      { type: 'workspace.exploded' as EventInput['type'] },
      { via: 'fax' as EventInput['via'] },
      { subject: { type: 'secret' as 'workspace', id: ws.workspace.id } },
      { requestId: 'not-a-uuid' },
      { actor: { kind: 'user', id: 'nobody', name: 'Nobody' } },
    ];
    for (const overrides of bad) {
      await expect(
        test.db.transaction((tx) => appendEvent(tx, input(ws, overrides))),
      ).rejects.toBeInstanceOf(InvalidEventError);
    }
    expect(await seqs(test, ws)).toEqual([]);
  });

  it('refuses data that holds a token, a hash of one, a secret or a password', async () => {
    const ws = await createTestWorkspace(test.db);
    const bad: Record<string, unknown>[] = [
      { token: 'tk_live_abc' },
      { tokenHash: [null, 'abc'] },
      { invitation: { email: 'ana@example.com', token_hash: 'abc' } },
      { settings: { secret: 'abc' } },
      { changes: [{ password: 'abc' }] },
      { Secrets: { apiKey: 'abc' } },
    ];
    for (const data of bad) {
      await expect(
        test.db.transaction((tx) => appendEvent(tx, input(ws, { data }))),
      ).rejects.toThrow(/R48/);
    }
    // Naming the field that changed is what R48 asks for, and is accepted.
    const named = await test.db.transaction((tx) =>
      appendEvent(tx, input(ws, { data: { fields: ['token', 'secret'] } })),
    );
    expect(named.data).toEqual({ fields: ['token', 'secret'] });
  });

  it('an apiKey in an event is only set, replaced or removed, never a value', async () => {
    const ws = await createTestWorkspace(test.db);
    await expect(
      test.db.transaction((tx) => appendEvent(tx, input(ws, { data: { apiKey: 'sk-abc' } }))),
    ).rejects.toThrow(/R48/);
    for (const change of ['set', 'replaced', 'removed']) {
      const event = await test.db.transaction((tx) =>
        appendEvent(tx, input(ws, { data: { apiKey: change } })),
      );
      expect(event.data).toEqual({ apiKey: change });
    }
  });

  it('announces the event with the workspace id and the seq, and nothing else', async () => {
    const ws = await createTestWorkspace(test.db);
    const payloads: string[] = [];
    let stop: () => Promise<void>;
    if (test.handle.engine === 'pglite') {
      stop = await test.handle.pglite.listen(EVENT_CHANNEL, (payload) => payloads.push(payload));
    } else {
      const client = new pg.Client({ connectionString: test.url });
      await client.connect();
      client.on('notification', (message) => payloads.push(message.payload ?? ''));
      await client.query(`listen ${EVENT_CHANNEL}`);
      stop = () => client.end();
    }
    try {
      await test.db.transaction(async (tx) => {
        await appendEvent(tx, input(ws, { data: { name: ['A secret plan', 'Another'] } }));
        await appendEvent(tx, input(ws));
      });
      // A rolled-back event is never announced.
      await test.db
        .transaction(async (tx) => {
          await appendEvent(tx, input(ws));
          throw new Error('rolled back');
        })
        .catch(() => {});
      await test.db.transaction((tx) => appendEvent(tx, input(ws)));
      for (let waited = 0; waited < 3000 && payloads.length < 3; waited += 20) await sleep(20);
      expect(payloads).toEqual([
        `${ws.workspace.id}:1`,
        `${ws.workspace.id}:2`,
        `${ws.workspace.id}:3`,
      ]);
    } finally {
      await stop();
    }
  });
});

describe.skipIf(!postgresTestUrl)(
  'seq order is commit order, with writers at once (Postgres)',
  () => {
    let test: TestDatabase;

    beforeAll(async () => {
      test = await createTestDatabase('postgres');
    });

    afterAll(async () => {
      await test.destroy();
    });

    it('a second writer waits for the first to commit, then takes the next seq', async () => {
      const ws = await createTestWorkspace(test.db);
      const scope = workspaceScope(ws.workspace.id);
      const firstMayCommit = deferred();
      const firstAppended = deferred<number>();

      const first = test.db.transaction(async (tx) => {
        const event = await appendEvent(tx, input(ws));
        firstAppended.resolve(event.seq);
        await firstMayCommit.promise;
        return event.seq;
      });
      expect(await firstAppended.promise).toBe(1);

      let secondSeq: number | undefined;
      const second = test.db.transaction(async (tx) => {
        const event = await appendEvent(tx, input(ws));
        secondSeq = event.seq;
        return event.seq;
      });

      // The first writer holds the workspace's lock, so the second has no number yet,
      // and a reader sees neither event.
      await sleep(300);
      expect(secondSeq).toBeUndefined();
      expect(await repositories(test.db, scope).events.latestSeq()).toBe(0);

      firstMayCommit.resolve();
      expect(await first).toBe(1);
      expect(await second).toBe(2);
      expect(await seqs(test, ws)).toEqual([1, 2]);
    });

    it('when the first writer rolls back, the second takes its number and no gap is left', async () => {
      const ws = await createTestWorkspace(test.db);
      const firstMayFinish = deferred();
      const firstAppended = deferred();

      const first = test.db.transaction(async (tx) => {
        await appendEvent(tx, input(ws));
        firstAppended.resolve();
        await firstMayFinish.promise;
        throw new Error('rolled back');
      });
      first.catch(() => {});
      await firstAppended.promise;

      const second = test.db.transaction((tx) => appendEvent(tx, input(ws)));
      await sleep(200);
      firstMayFinish.resolve();
      await expect(first).rejects.toThrow('rolled back');
      expect((await second).seq).toBe(1);
      expect(await seqs(test, ws)).toEqual([1]);
    });

    it('writers in different workspaces do not wait for each other', async () => {
      const a = await createTestWorkspace(test.db);
      const b = await createTestWorkspace(test.db);
      const aMayCommit = deferred();
      const aAppended = deferred();

      const first = test.db.transaction(async (tx) => {
        await appendEvent(tx, input(a));
        aAppended.resolve();
        await aMayCommit.promise;
      });
      await aAppended.promise;
      // This would hang until the test's timeout if b waited for a.
      const other = await test.db.transaction((tx) => appendEvent(tx, input(b)));
      expect(other.seq).toBe(1);
      aMayCommit.resolve();
      await first;
    });

    it('with many writers and a reader that keeps resuming, the reader never sees a gap and misses nothing', async () => {
      const ws = await createTestWorkspace(test.db);
      const scope = workspaceScope(ws.workspace.id);
      const writers = 24;
      let committed = 0;
      let writing = true;

      // The reader resumes from the last seq it saw, as a stream does on reconnect. If a
      // later seq could commit before an earlier one, the reader would skip the earlier one.
      const seen: number[] = [];
      const reader = (async () => {
        let last = 0;
        for (;;) {
          // Read the flag before the query: a query that started before the last commit
          // can come back empty after it, and must not end the reader.
          const writersDone = !writing;
          const batch = await repositories(test.db, scope).events.listAfter(last, 1000);
          for (const event of batch) {
            expect(event.seq).toBe(last + 1);
            last = event.seq;
            seen.push(event.seq);
          }
          if (writersDone && batch.length === 0) return;
        }
      })();

      await Promise.all(
        Array.from({ length: writers }, async (_, writer) => {
          const requestId = randomUUID();
          const fails = writer % 5 === 4;
          try {
            await test.db.transaction(async (tx) => {
              // Work before the event, of different lengths, so the writers interleave.
              await sleep(Math.floor(Math.random() * 20));
              const count = 1 + (writer % 3);
              for (let index = 0; index < count; index += 1) {
                await appendEvent(tx, input(ws, { requestId, data: { writer: [null, writer] } }));
              }
              await sleep(Math.floor(Math.random() * 10));
              if (fails) throw new Error('this writer rolls back');
              committed += count;
            });
          } catch (error) {
            if (!fails) throw error;
          }
        }),
      );
      writing = false;
      await reader;

      const stored = await seqs(test, ws);
      expect(stored).toEqual(Array.from({ length: committed }, (_, index) => index + 1));
      expect(seen).toEqual(stored);

      // The events of one request are next to each other: nothing commits in between.
      const all = await repositories(test.db, scope).events.listAfter(0, 1000);
      const order = all.map((event) => event.requestId);
      const runs = order.filter((id, index) => index === 0 || order[index - 1] !== id);
      expect(new Set(runs).size).toBe(runs.length);
    }, 60_000);
  },
);

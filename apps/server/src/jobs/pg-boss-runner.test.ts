import { randomUUID } from 'node:crypto';
import { appendEvent, createEventBus, queryRows, schema } from '@turnkeel/db';
import {
  createTestDatabase,
  createTestWorkspace,
  sleep,
  testEngines,
  waitFor,
  type TestDatabase,
} from '@turnkeel/db/testing';
import type { Event } from '@turnkeel/protocol';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobRunner, type Job, type JobRunner } from './index.js';

/**
 * pg-boss on both engines. On PGlite it shares the one instance with Drizzle, the
 * migrations and the event listener, which is what local mode does.
 */
describe.each(testEngines)('the job runner on %s', (engine) => {
  let test: TestDatabase;
  let runner: JobRunner;
  const errors: unknown[] = [];

  beforeAll(async () => {
    test = await createTestDatabase(engine);
    runner = createJobRunner(test.handle, {
      onError: (error) => errors.push(error),
      pollingIntervalSeconds: 0.5,
      scheduleIntervalSeconds: 1,
    });
    await runner.start();
  }, 60_000);

  afterAll(async () => {
    await runner.stop();
    await test.destroy();
  }, 60_000);

  it('keeps its tables in a schema of its own, next to Turnkeel’s', async () => {
    const rows = await queryRows<{ schema: string; count: number }>(
      test.db,
      sql`select table_schema::text as schema, count(*)::int as count from information_schema.tables where table_schema in ('public', 'pgboss') group by table_schema order by table_schema`,
    );
    expect(rows.map((row) => row.schema)).toEqual(['pgboss', 'public']);
    expect(rows.find((row) => row.schema === 'public')?.count).toBe(70);
  });

  it('runs a job that was queued, with its data', async () => {
    const ran: Job<{ greeting: string }>[] = [];
    const abortedWhileRunning: (boolean | undefined)[] = [];
    await runner.define<{ greeting: string }>('test.greet', (job) => {
      ran.push(job);
      abortedWhileRunning.push(job.signal?.aborted);
      return Promise.resolve();
    });
    const id = await runner.enqueue('test.greet', { greeting: 'hello' });
    await waitFor(() => ran.length === 1, { timeoutMs: 15_000, what: 'the queued job' });
    expect(ran[0]).toEqual({
      id,
      name: 'test.greet',
      data: { greeting: 'hello' },
      signal: expect.any(AbortSignal) as unknown,
    });
    // The handler gets the job's signal, which pg-boss aborts when it gives up on the job.
    expect(abortedWhileRunning).toEqual([false]);
    await sleep(700);
    expect(ran).toHaveLength(1);
  }, 30_000);

  it('does not run a job before its start time', async () => {
    const ranAt: number[] = [];
    await runner.define('test.later', () => {
      ranAt.push(Date.now());
      return Promise.resolve();
    });
    const startAfter = new Date(Date.now() + 2000);
    await runner.enqueue('test.later', {}, { startAfter });
    await waitFor(() => ranAt.length === 1, { timeoutMs: 20_000, what: 'the delayed job' });
    // The database's clock decides. Allow it to differ a little from this process's.
    expect(ranAt[0]).toBeGreaterThanOrEqual(startAfter.getTime() - 250);
  }, 30_000);

  it('runs a job on a schedule', async () => {
    const ran: Job<{ from: string }>[] = [];
    await runner.define<{ from: string }>('test.tick', (job) => {
      ran.push(job);
      return Promise.resolve();
    });
    // Every second. Turnkeel's own schedules are minutes apart; this keeps the test short.
    await runner.schedule('test.tick', '* * * * * *', { from: 'schedule' });
    try {
      await waitFor(() => ran.length >= 1, { timeoutMs: 30_000, what: 'the scheduled job' });
      expect(ran[0]).toMatchObject({ name: 'test.tick', data: { from: 'schedule' } });
    } finally {
      await runner.unschedule('test.tick');
    }
  }, 60_000);

  it('tries a job again when its handler throws', async () => {
    let attempts = 0;
    await runner.define('test.flaky', () => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('the first attempt fails'));
      return Promise.resolve();
    });
    await runner.enqueue('test.flaky', {});
    await waitFor(() => attempts === 2, { timeoutMs: 30_000, what: 'the second attempt' });
  }, 60_000);

  it('runs one job of a kind at a time', async () => {
    let running = 0;
    let most = 0;
    let done = 0;
    await runner.define('test.slow', async () => {
      running += 1;
      most = Math.max(most, running);
      await sleep(150);
      running -= 1;
      done += 1;
    });
    await Promise.all([1, 2, 3].map((n) => runner.enqueue('test.slow', { n })));
    await waitFor(() => done === 3, { timeoutMs: 30_000, what: 'three slow jobs' });
    expect(most).toBe(1);
  }, 60_000);

  it('lets a job write through Drizzle and append an event, which the event bus delivers', async () => {
    const ws = await createTestWorkspace(test.db);
    const bus = await createEventBus(test.handle);
    const received: Event[] = [];
    try {
      await bus.subscribe(ws.workspace.id, 0, (event) => {
        received.push(event);
      });
      await runner.define<{ workspaceId: string; name: string }>('test.rename', async (job) => {
        await test.db.transaction(async (tx) => {
          await tx
            .update(schema.workspaces)
            .set({ name: job.data.name })
            .where(sql`${schema.workspaces.id} = ${job.data.workspaceId}::uuid`);
          await appendEvent(tx, {
            workspaceId: job.data.workspaceId,
            type: 'workspace.updated',
            // Events that a job writes carry the system as actor and `via: job`.
            actor: { kind: 'system', id: '00000000-0000-0000-0000-000000000000', name: 'System' },
            via: 'job',
            requestId: randomUUID(),
            subject: { type: 'workspace', id: job.data.workspaceId },
            data: { name: [ws.workspace.name, job.data.name] },
          });
        });
      });
      await runner.enqueue('test.rename', {
        workspaceId: ws.workspace.id,
        name: 'Renamed by a job',
      });
      await waitFor(() => received.length === 1, {
        timeoutMs: 30_000,
        what: 'the event of the job',
      });
      expect(received[0]).toMatchObject({
        seq: 1,
        type: 'workspace.updated',
        via: 'job',
        actor: { kind: 'system' },
      });
      const rows = await test.db
        .select({ name: schema.workspaces.name })
        .from(schema.workspaces)
        .where(sql`${schema.workspaces.id} = ${ws.workspace.id}::uuid`);
      expect(rows[0]?.name).toBe('Renamed by a job');
    } finally {
      await bus.close();
    }
  }, 60_000);

  it('reported no error while it ran', () => {
    expect(errors).toEqual([]);
  });
});

describe('the job runner on PGlite, started and stopped', () => {
  it('leaves the PGlite instance open and usable after stop, and keeps a queued job for the next start', async () => {
    const test = await createTestDatabase('pglite');
    try {
      const first = createJobRunner(test.handle, { pollingIntervalSeconds: 0.5 });
      await first.start();
      await first.start();
      // Queued on the first runner, for a time after its stop, so it cannot run there.
      const ranFirst: string[] = [];
      await first.define('test.kept', (job) => {
        ranFirst.push(job.id);
        return Promise.resolve();
      });
      const id = await first.enqueue('test.kept', {}, { startAfter: new Date(Date.now() + 3000) });
      await first.stop();
      await first.stop();
      expect(ranFirst).toEqual([]);

      expect(test.handle.engine === 'pglite' && test.handle.pglite.closed).toBe(false);
      const ws = await createTestWorkspace(test.db);
      expect(ws.workspace.id).toMatch(/^[0-9a-f-]{36}$/);

      const second = createJobRunner(test.handle, { pollingIntervalSeconds: 0.5 });
      await second.start();
      try {
        // Nothing is queued on the second runner: the job it runs is the one that was kept.
        const ran: string[] = [];
        await second.define('test.kept', (job) => {
          ran.push(job.id);
          return Promise.resolve();
        });
        await waitFor(() => ran.length === 1, { timeoutMs: 15_000, what: 'the kept job' });
        expect(ran).toEqual([id]);
        expect(ranFirst).toEqual([]);
      } finally {
        await second.stop();
      }
    } finally {
      await test.destroy();
    }
  }, 60_000);
});

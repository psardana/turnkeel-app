import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, isTransaction, queryRows } from './database.js';
import { findWorkspaceBySlug } from './directory.js';
import { runMigrations } from './migrate.js';
import {
  createTestDatabase,
  createTestWorkspace,
  deferred,
  postgresTestUrl,
  sleep,
  testEngines,
  waitFor,
  type TestDatabase,
} from './testing/index.js';

describe.each(testEngines)('createDatabase on %s', (engine) => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase(engine);
  });

  afterAll(async () => {
    await test.destroy();
  });

  it('says which engine it opened, and hands out the driver behind it', () => {
    expect(test.handle.engine).toBe(engine);
    if (test.handle.engine === 'postgres') {
      expect(test.handle.url).toBe(test.url);
      expect(test.handle.directUrl).toBe(test.url);
      expect(typeof test.handle.pool.connect).toBe('function');
    } else {
      expect(test.handle.dataDir).toBeNull();
      expect(typeof test.handle.pglite.listen).toBe('function');
    }
  });

  it('runs raw SQL and gives rows of the same shape on both engines', async () => {
    const rows = await queryRows<{ one: number; text: string; big: string }>(
      test.db,
      sql`select 1::int as one, 'a'::text as text, 9007199254740993::bigint::text as big`,
    );
    expect(rows).toEqual([{ one: 1, text: 'a', big: '9007199254740993' }]);
  });

  it('runs a transaction that commits, and one that rolls back', async () => {
    const committed = await createTestWorkspace(test.db);
    expect((await findWorkspaceBySlug(test.db, committed.workspace.slug))?.id).toBe(
      committed.workspace.id,
    );

    await expect(
      test.db.transaction(async (tx) => {
        expect(isTransaction(tx)).toBe(true);
        await tx.execute(
          sql`update workspaces set name = 'Changed' where id = ${committed.workspace.id}::uuid`,
        );
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect((await findWorkspaceBySlug(test.db, committed.workspace.slug))?.name).toBe(
      committed.workspace.name,
    );
    expect(isTransaction(test.db)).toBe(false);
  });

  it('stores a time in UTC and reads it back as the same instant', async () => {
    const at = new Date('2026-11-11T09:30:00.123Z');
    const ws = await createTestWorkspace(test.db);
    await test.db.execute(
      sql`update workspaces set updated_at = ${at.toISOString()}::timestamptz where id = ${ws.workspace.id}::uuid`,
    );
    const read = await findWorkspaceBySlug(test.db, ws.workspace.slug);
    expect(read?.updatedAt.toISOString()).toBe('2026-11-11T09:30:00.123Z');
  });
});

describe('createDatabase with a folder', () => {
  it('keeps PGlite in the folder, so the data is there after a restart', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'turnkeel-db-test-'));
    try {
      const first = await createDatabase({ dataDir });
      expect(first.engine).toBe('pglite');
      expect(first.engine === 'pglite' && first.dataDir).toBe(dataDir);
      await runMigrations(first);
      const ws = await createTestWorkspace(first.db, { slug: 'kept' });
      await first.close();

      const second = await createDatabase({ dataDir });
      try {
        // A second start migrates again and finds nothing to do.
        await runMigrations(second);
        expect((await findWorkspaceBySlug(second.db, 'kept'))?.id).toBe(ws.workspace.id);
      } finally {
        await second.close();
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('opens PGlite in memory when it is given neither a URL nor a folder', async () => {
    const handle = await createDatabase({ url: '  ', dataDir: '' });
    try {
      expect(handle.engine).toBe('pglite');
      expect(handle.engine === 'pglite' && handle.dataDir).toBeNull();
    } finally {
      await handle.close();
    }
  });
});

describe.skipIf(!postgresTestUrl)('createDatabase on Postgres', () => {
  it('uses the direct URL for migrations when one is given', async () => {
    const test = await createTestDatabase('postgres', { migrate: false });
    try {
      const pooled = await createDatabase({
        // Nothing listens here; only the direct URL can migrate.
        url: 'postgres://nobody:nothing@127.0.0.1:1/none',
        directUrl: test.url,
      });
      try {
        expect(pooled.engine === 'postgres' && pooled.directUrl).toBe(test.url);
        await runMigrations(pooled);
      } finally {
        await pooled.close();
      }
      const tables = await queryRows<{ count: number }>(
        test.db,
        sql`select count(*)::int as count from information_schema.tables where table_schema = 'public'`,
      );
      expect(tables[0]?.count).toBe(70);
    } finally {
      await test.destroy();
    }
  });
});

describe.skipIf(!postgresTestUrl)('a Postgres connection that is lost', () => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase('postgres', { migrate: false });
  });

  afterAll(async () => {
    await test.destroy();
  });

  it('inside a transaction rejects that transaction, reports the error and leaves the pool usable', async () => {
    const reported: Error[] = [];
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    const handle = await createDatabase({
      url: test.url,
      onError: (error) => reported.push(error),
    });
    process.on('uncaughtException', onUncaught);
    try {
      const backend = deferred<number>();
      const transaction = handle.db.transaction(async (tx) => {
        const rows = await queryRows<{ pid: number }>(tx, sql`select pg_backend_pid()::int as pid`);
        backend.resolve(rows[0]?.pid ?? 0);
        await tx.execute(sql`select pg_sleep(5)`);
      });
      // The transaction's failure is looked at below; this keeps it from being unhandled meanwhile.
      transaction.catch(() => {});
      const pid = await backend.promise;
      await test.db.execute(sql`select pg_terminate_backend(${pid}::int)`);

      await expect(transaction).rejects.toThrow();
      // The error event of the client arrives after its queries were failed.
      await waitFor(() => reported.length > 0, { what: 'the lost connection to be reported' });
      await sleep(50);
      expect(uncaught).toEqual([]);
      expect(reported).toHaveLength(1);

      const rows = await queryRows<{ one: number }>(handle.db, sql`select 1::int as one`);
      expect(rows).toEqual([{ one: 1 }]);
    } finally {
      process.off('uncaughtException', onUncaught);
      await handle.close();
    }
  });

  it('while it is idle is reported once and replaced by a new one', async () => {
    const reported: Error[] = [];
    const handle = await createDatabase({
      url: test.url,
      poolSize: 1,
      onError: (error) => reported.push(error),
    });
    try {
      const rows = await queryRows<{ pid: number }>(
        handle.db,
        sql`select pg_backend_pid()::int as pid`,
      );
      await test.db.execute(sql`select pg_terminate_backend(${rows[0]?.pid ?? 0}::int)`);
      await waitFor(() => reported.length > 0, { what: 'the lost connection to be reported' });
      await sleep(50);
      expect(reported).toHaveLength(1);
      expect(await queryRows<{ one: number }>(handle.db, sql`select 1::int as one`)).toEqual([
        { one: 1 },
      ]);
    } finally {
      await handle.close();
    }
  });
});

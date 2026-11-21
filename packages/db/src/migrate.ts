import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { migrate as migratePostgres } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import { queryRows, type DatabaseHandle, type Executor } from './database.js';

/**
 * Where the migrations are when this package runs from its sources. The server's
 * bundle has them elsewhere and passes its own folder to `runMigrations`.
 */
export const defaultMigrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * The advisory lock that one migrating process holds: the ASCII bytes of "turnkeel"
 * as a 64-bit number. Postgres takes it as a bigint.
 */
export const MIGRATION_LOCK_KEY = '8391171957396464492';

export interface RunMigrationsOptions {
  /** The folder with the `.sql` files and `meta/_journal.json`. */
  migrationsFolder?: string | undefined;
}

/**
 * Applies the migrations that the database does not have yet. The server calls it at
 * every start.
 *
 * On Postgres it opens a connection of its own, from the direct URL, and takes a
 * session-level advisory lock before it looks at anything. When several server
 * processes start together, one migrates and the others wait, find nothing left to do
 * and go on. On PGlite there is one process and one
 * connection, so there is nothing to lock.
 */
export async function runMigrations(
  handle: DatabaseHandle,
  options: RunMigrationsOptions = {},
): Promise<void> {
  const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder;

  if (handle.engine === 'pglite') {
    // The cast: the migrator wants the driver's own Drizzle type, which `handle.db` is.
    await migratePglite(handle.db as unknown as Parameters<typeof migratePglite>[0], {
      migrationsFolder,
    });
    return;
  }

  const client = new pg.Client({
    connectionString: handle.directUrl,
    application_name: 'turnkeel-migrations',
  });
  // A connection that is lost while this waits for the lock emits an error on the
  // client. The query that was waiting fails with it; without a listener the event
  // would be an uncaught exception.
  client.on('error', () => {});
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
    try {
      await migratePostgres(drizzlePostgres({ client }), { migrationsFolder });
    } finally {
      await client.query('select pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

/** One row of Drizzle's record of applied migrations. */
export interface AppliedMigration {
  /** The SHA-256 of the migration's file. */
  hash: string;
  /** The `when` of the migration's entry in `meta/_journal.json`. */
  createdAt: number;
}

/** The migrations the database has, oldest first. */
export async function appliedMigrations(executor: Executor): Promise<AppliedMigration[]> {
  const rows = await queryRows<{ hash: string; created_at: string }>(
    executor,
    sql`select hash, created_at::text as created_at from drizzle.__drizzle_migrations order by id`,
  );
  return rows.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) }));
}

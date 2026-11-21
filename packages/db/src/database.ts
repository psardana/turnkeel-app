import { PGlite } from '@electric-sql/pglite';
import type { ExtractTablesWithRelations, SQL } from 'drizzle-orm';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { PgTransaction, type PgDatabase, type PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import pg from 'pg';
import { databaseEngine } from './engine.js';
import * as schema from './schema/index.js';

export type Schema = typeof schema;

/**
 * The Drizzle interface the rest of the code uses. It is the same for Postgres and
 * for PGlite; only `createDatabase` knows which driver is behind it.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

/** A Drizzle transaction, as `db.transaction` hands it to its callback. */
export type Transaction = PgTransaction<
  PgQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;

/** Either of the two: what a query can run on. */
export type Executor = Database | Transaction;

export interface CreateDatabaseOptions {
  /** `DATABASE_URL`. Postgres when it is set, PGlite when it is not. */
  url?: string | undefined;
  /**
   * `DATABASE_URL_DIRECT`: a direct connection for the event listener and for
   * migrations, for when `url` goes through a pooler. `url` is used when it is not set.
   */
  directUrl?: string | undefined;
  /** The folder PGlite keeps its data in. Without it PGlite runs in memory, which is what tests use. */
  dataDir?: string | undefined;
  /** The most connections the Postgres pool opens. node-postgres opens 10 unless told otherwise. */
  poolSize?: number | undefined;
  /**
   * Hears about a pooled connection that was lost, idle or in use. Without it such an
   * error is dropped; the query that was running on the connection fails either way.
   */
  onError?: ((error: Error) => void) | undefined;
}

interface HandleBase {
  /** The Drizzle database. */
  readonly db: Database;
  /** Closes the pool, or the PGlite instance. */
  close(): Promise<void>;
}

export interface PostgresHandle extends HandleBase {
  readonly engine: 'postgres';
  readonly pool: pg.Pool;
  readonly url: string;
  /** The connection for the event listener and for migrations. Equal to `url` unless a direct one was given. */
  readonly directUrl: string;
}

export interface PgliteHandle extends HandleBase {
  readonly engine: 'pglite';
  /**
   * The one PGlite instance of this process. Drizzle, the event listener and the job
   * runner all use it; it has a single connection, so nothing runs in parallel on it.
   */
  readonly pglite: PGlite;
  /** The data folder, or null when the data is in memory. */
  readonly dataDir: string | null;
}

/** A database with the driver behind it, for the few places that need the driver. */
export type DatabaseHandle = PostgresHandle | PgliteHandle;

/**
 * Opens the database: Postgres through node-postgres when `url` is set, PGlite
 * otherwise. Both come back with the same Drizzle interface (`handle.db`).
 * It applies no migration; `runMigrations` does that.
 */
export async function createDatabase(options: CreateDatabaseOptions = {}): Promise<DatabaseHandle> {
  if (databaseEngine(options.url) === 'postgres') {
    const url = (options.url ?? '').trim();
    const directUrl = options.directUrl?.trim() ? options.directUrl.trim() : url;
    const pool = new pg.Pool({
      connectionString: url,
      ...(options.poolSize === undefined ? {} : { max: options.poolSize }),
    });
    // A client that loses its connection emits an error. The pool listens only while
    // the client is idle and takes its listener off when it hands the client out, and
    // `db.transaction` holds a client for as long as it runs. Without a listener Node
    // treats the error as an uncaught exception and stops the process, so every client
    // gets one for its whole life. The query that was running fails by itself, and the
    // pool drops the client when it is given back.
    pool.on('connect', (client) => {
      client.on('error', (error) => options.onError?.(error));
    });
    // The pool repeats the error of an idle client as its own. The listener above has
    // reported it; this one is here so that the pool's event has a listener too.
    pool.on('error', () => {});
    const db = drizzlePostgres({ client: pool, schema }) as unknown as Database;
    return {
      engine: 'postgres',
      db,
      pool,
      url,
      directUrl,
      close: () => pool.end(),
    };
  }

  const dataDir = options.dataDir?.trim() ? options.dataDir.trim() : null;
  const pglite = await (dataDir === null ? PGlite.create() : PGlite.create(dataDir));
  const db = drizzlePglite({ client: pglite, schema }) as unknown as Database;
  return {
    engine: 'pglite',
    db,
    pglite,
    dataDir,
    close: () => pglite.close(),
  };
}

/** True when `executor` is a transaction and not the database itself. */
export function isTransaction(executor: Executor): executor is Transaction {
  return executor instanceof PgTransaction;
}

/**
 * Runs raw SQL and returns its rows. The two drivers shape their results alike but
 * type them differently, and they do not agree on how a bigint or a time comes back,
 * so a query that goes through here casts what it selects (`::int`, `::text`).
 */
export async function queryRows<Row extends Record<string, unknown>>(
  executor: Executor,
  query: SQL,
): Promise<Row[]> {
  const result: unknown = await executor.execute(query);
  return (result as { rows: Row[] }).rows;
}

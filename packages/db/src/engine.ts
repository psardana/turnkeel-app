export type DatabaseEngine = 'postgres' | 'pglite';

/**
 * Which database the server runs on: Postgres when `DATABASE_URL` is set,
 * PGlite in the data folder when it is not.
 */
export function databaseEngine(databaseUrl: string | undefined): DatabaseEngine {
  return databaseUrl !== undefined && databaseUrl.trim() !== '' ? 'postgres' : 'pglite';
}

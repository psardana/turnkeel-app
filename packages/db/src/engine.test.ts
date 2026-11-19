import { describe, expect, it } from 'vitest';
import { databaseEngine } from './index.js';

describe('databaseEngine', () => {
  it('is Postgres when a database URL is set', () => {
    expect(databaseEngine('postgres://turnkeel:turnkeel@127.0.0.1:54420/turnkeel')).toBe(
      'postgres',
    );
  });

  it('is PGlite when no database URL is set', () => {
    expect(databaseEngine(undefined)).toBe('pglite');
  });

  it('is PGlite when the database URL is empty', () => {
    expect(databaseEngine('')).toBe('pglite');
    expect(databaseEngine('  ')).toBe('pglite');
  });
});

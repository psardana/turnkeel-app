import { randomUUID } from 'node:crypto';
import type { PrincipalRef } from '@turnkeel/protocol';
import pg from 'pg';
import { createDatabase, type Database, type DatabaseHandle } from '../database.js';
import { createUser, createWorkspace } from '../directory.js';
import type { DatabaseEngine } from '../engine.js';
import { runMigrations } from '../migrate.js';
import { repositories } from '../repositories/index.js';
import type { MemberRow, UserRow, WorkspaceRow } from '../rows.js';
import { workspaceScope } from '../scope.js';

/**
 * Helpers for the tests that need a database, in this package and in the server.
 * Nothing here is used when Turnkeel runs.
 *
 * Integration tests run on PGlite in memory, always, and also on Postgres when
 * `TEST_DATABASE_URL` is set. On Postgres every call of
 * `createTestDatabase` makes a database of its own next to the one the URL names and
 * drops it afterwards, so test files that run at the same time never meet.
 */

/** `TEST_DATABASE_URL`, when it is set. */
export const postgresTestUrl: string | undefined = process.env.TEST_DATABASE_URL?.trim()
  ? process.env.TEST_DATABASE_URL.trim()
  : undefined;

/** The engines the integration tests run on: PGlite, and Postgres when there is one. */
export const testEngines: readonly DatabaseEngine[] = postgresTestUrl
  ? ['pglite', 'postgres']
  : ['pglite'];

export interface TestDatabase {
  readonly engine: DatabaseEngine;
  readonly handle: DatabaseHandle;
  readonly db: Database;
  /** The URL of this test's own database. Undefined on PGlite. */
  readonly url: string | undefined;
  /** Closes the database and, on Postgres, drops it. */
  destroy(): Promise<void>;
}

async function withAdmin<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  if (!postgresTestUrl) throw new Error('TEST_DATABASE_URL is not set.');
  const client = new pg.Client({ connectionString: postgresTestUrl });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * Opens an empty database for one test file and applies the migrations, unless
 * `migrate` is false. Call `destroy` when the file is done.
 */
export async function createTestDatabase(
  engine: DatabaseEngine,
  options: { migrate?: boolean } = {},
): Promise<TestDatabase> {
  let handle: DatabaseHandle;
  let url: string | undefined;
  let drop = async () => {};

  if (engine === 'postgres') {
    const name = `turnkeel_test_${randomUUID().replaceAll('-', '')}`;
    await withAdmin((client) => client.query(`create database "${name}"`));
    const target = new URL(postgresTestUrl ?? '');
    target.pathname = `/${name}`;
    url = target.toString();
    handle = await createDatabase({ url });
    drop = () =>
      withAdmin(async (client) => {
        await client.query(`drop database if exists "${name}" with (force)`);
      });
  } else {
    handle = await createDatabase();
  }

  try {
    if (options.migrate !== false) await runMigrations(handle);
  } catch (error) {
    await handle.close().catch(() => {});
    await drop();
    throw error;
  }

  return {
    engine,
    handle,
    db: handle.db,
    url,
    async destroy() {
      await handle.close();
      await drop();
    },
  };
}

export interface TestWorkspace {
  workspace: WorkspaceRow;
  owner: UserRow;
  member: MemberRow;
  /** The owner, as `createdBy` and an event's actor name them. */
  by: PrincipalRef;
}

let counter = 0;

/** Makes an account. The email address is unique unless one is given. */
export async function createTestUser(
  db: Database,
  input: { name?: string; email?: string; emailVerified?: boolean } = {},
): Promise<UserRow> {
  counter += 1;
  return createUser(db, {
    name: input.name ?? `Test Person ${counter}`,
    email: input.email ?? `person-${counter}-${randomUUID().slice(0, 8)}@example.com`,
    emailVerified: input.emailVerified ?? true,
  });
}

/** Makes a workspace with one Owner. The slug is unique unless one is given. */
export async function createTestWorkspace(
  db: Database,
  input: { name?: string; slug?: string; handle?: string } = {},
): Promise<TestWorkspace> {
  const owner = await createTestUser(db);
  const by: PrincipalRef = { kind: 'user', id: owner.id };
  return db.transaction(async (tx) => {
    const workspace = await createWorkspace(
      tx,
      {
        name: input.name ?? 'Example Co',
        slug: input.slug ?? `example-${randomUUID().slice(0, 8)}`,
        baseCurrency: 'USD',
      },
      { by },
    );
    const member = await repositories(tx, workspaceScope(workspace.id)).members.add(
      { userId: owner.id, role: 'owner', handle: input.handle ?? 'owner' },
      { by },
    );
    return { workspace, owner, member, by };
  });
}

/** Waits until `check` is true. Throws after `timeoutMs`. */
export async function waitFor(
  check: () => boolean,
  options: { timeoutMs?: number; what?: string } = {},
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 5000);
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${options.what ?? 'a condition'}.`);
    }
    await sleep(10);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A promise with its `resolve` and `reject` on the outside. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

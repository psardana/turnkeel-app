// @ts-check
/**
 * Starts a Turnkeel server for the browser tests, as a process of its own, through
 * the server's programmatic start (`startLocal`, `startServer`). The test that
 * started it talks to it over the IPC channel:
 *
 * - it gets `{ type: 'ready', url, oneTimeUrl }` when the server listens,
 * - `{ type: 'one-time-url' }` is answered with `{ type: 'one-time-url', url }`,
 * - `{ type: 'stop' }` stops the server and removes what it made.
 *
 * Both get the connectors of `apps/server/src/testing/fixture-connectors.ts`: a stub in
 * place of the real `fetch`, so no connector reaches Apple or any other host, and a
 * connector that takes webhooks.
 *
 * `local` is local mode on PGlite in a folder of its own, with the workspace "My workspace"
 * made. `empty` is the first run of local mode as `npx turnkeel` starts it: nothing made, so
 * the app asks the one question. `demo` is the first run of `turnkeel
 * --demo`, which loads the demo, with the install's assistant default when
 * `TURNKEEL_ASSISTANT_*` is set. `sign-in` is a server with
 * sign-in on the Postgres and the mail catcher of docker compose, in a database of
 * its own that is dropped at the end.
 */
import '../../apps/server/scripts/ts-resolve.mjs';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { loadConfig, silentLogger, startLocal, startServer } =
  await import('../../apps/server/src/index.ts');

const mode = process.argv[2];
const logger = process.env.E2E_SERVER_LOG ? undefined : silentLogger;

/** @type {(() => Promise<void>)[]} */
const cleanups = [];

/** @returns {Promise<import('../../apps/server/src/index.ts').RunningServer>} */
async function start() {
  if (mode === 'local') {
    // No demo, and the workspace "My workspace" made through the API, without a project,
    // which most tests work in.
    const dataDir = await mkdtemp(path.join(tmpdir(), 'turnkeel-e2e-'));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    const server = await startLocal({ port: 0, dataDir, demo: false, ...options });
    const session = await fetch(server.newOneTimeUrl(), { redirect: 'manual' });
    const cookie = session.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
    const made = await fetch(`${server.url}/api/v1/workspaces`, {
      method: 'POST',
      headers: { cookie, origin: server.url, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'My workspace', slug: 'my-workspace', handle: 'owner' }),
    });
    if (made.status !== 201) throw new Error(`My workspace was not made: ${made.status}`);
    return server;
  }

  if (mode === 'empty') {
    // The first run of local mode as `npx turnkeel` starts it: empty, with one question.
    const dataDir = await mkdtemp(path.join(tmpdir(), 'turnkeel-e2e-empty-'));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    return startLocal({ port: 0, dataDir, ...options });
  }

  if (mode === 'demo') {
    // The first run of `turnkeel --demo`: the demo is loaded.
    // The install's assistant default, when the test sets one, comes from the environment,
    // as it would for a server started by hand.
    const dataDir = await mkdtemp(path.join(tmpdir(), 'turnkeel-e2e-demo-'));
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    const assistant = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name.startsWith('TURNKEEL_ASSISTANT_')),
    );
    const config = loadConfig({
      TURNKEEL_HOST: '127.0.0.1',
      TURNKEEL_DATA_DIR: dataDir,
      TURNKEEL_DEMO: 'true',
      ...assistant,
    });
    return startServer({ ...config, port: 0 }, options);
  }

  if (mode === 'sign-in') {
    const base = new URL(process.env.E2E_DATABASE_URL ?? '');
    // node-postgres is a dependency of the server, not of the repository root.
    const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));
    /** @type {typeof import('pg')} */
    const pg = require('pg');
    const name = `turnkeel_e2e_${randomBytes(6).toString('hex')}`;
    const admin = new pg.Client({ connectionString: base.href });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    cleanups.push(async () => {
      const client = new pg.Client({ connectionString: base.href });
      await client.connect();
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await client.end();
    });
    const database = new URL(base.href);
    database.pathname = `/${name}`;
    const port = process.env.E2E_PORT ?? '4400';
    return startServer(
      loadConfig({
        TURNKEEL_PUBLIC_URL: `http://localhost:${port}`,
        TURNKEEL_HOST: '127.0.0.1',
        TURNKEEL_PORT: port,
        TURNKEEL_AUTH_SECRET: randomBytes(32).toString('base64'),
        DATABASE_URL: database.href,
        SMTP_URL: process.env.E2E_SMTP_URL,
        MAIL_FROM: 'Turnkeel <turnkeel@localhost>',
      }),
      options,
    );
  }

  throw new Error(`Unknown mode: ${String(mode)}`);
}

async function cleanUp() {
  for (const cleanup of cleanups.reverse()) {
    await cleanup().catch((error) => console.error(error));
  }
}

let server;
try {
  server = await start();
} catch (error) {
  await cleanUp();
  process.send?.({
    type: 'failed',
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop().catch((error) => console.error(error));
  await cleanUp();
  process.exit(0);
}

process.on('message', (message) => {
  const type = /** @type {{ type?: unknown } | null} */ (message)?.type;
  if (type === 'one-time-url')
    process.send?.({ type: 'one-time-url', url: server.newOneTimeUrl() });
  if (type === 'stop') void stop();
});
process.once('disconnect', () => void stop());
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());

process.send?.({ type: 'ready', url: server.url, oneTimeUrl: server.oneTimeUrl });

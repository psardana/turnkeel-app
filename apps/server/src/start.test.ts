import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Me, Project } from '@turnkeel/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataDirInUseError } from './local/data-dir.js';
import { memoryLogger, silentLogger } from './log.js';
import type { ReadyMessage } from './main.js';
import {
  describeStart,
  ListenError,
  startLocal,
  startServer,
  type RunningServer,
} from './start.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** For the starts that are not about jobs: without the job runner a start is much quicker. */
const quick = { logger: silentLogger, webDir: null, jobs: false } as const;

/** These tests start whole servers on disk, which takes a while on a busy machine. */
const SLOW = 240_000;

/** A GET over a real socket, with whatever Host header the test wants. */
function rawGet(
  port: number,
  requestPath: string,
  host: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: requestPath, method: 'GET', headers: { host } },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

/** A GET over a real socket to one address of this machine, with the headers the test wants. */
function rawGetOn(
  address: string,
  port: number,
  requestPath: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string; cookie: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: address, port, path: requestPath, method: 'GET', headers },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body,
            cookie: (response.headers['set-cookie'] ?? [])
              .map((line) => line.split(';')[0])
              .join('; '),
          }),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}

function urlPath(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/** Whether this machine has the address, which a machine without IPv6 does not for `::1`. */
function canListenOn(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(0, address, () => probe.close(() => resolve(true)));
  });
}

/** Opens the one-time URL and returns the Cookie header for what follows. */
async function exchange(oneTimeUrl: string): Promise<string> {
  const response = await fetch(oneTimeUrl, { redirect: 'manual' });
  expect(response.status).toBe(302);
  return response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

describe('startLocal: local mode as the launcher starts it', () => {
  let dataDir: string;
  let server: RunningServer;
  let cookie: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-data-'));
    // `turnkeel --demo`: the first run without it starts empty.
    server = await startLocal({
      port: 0,
      dataDir,
      demo: true,
      logger: silentLogger,
      webDir: null,
    });
    cookie = await exchange(server.oneTimeUrl ?? '');
  }, SLOW);
  afterAll(async () => {
    await server.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }, 60_000);

  it('returns the address, the one-time URL and a stop function', () => {
    expect(server.mode).toBe('local');
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    expect(server.oneTimeUrl).toMatch(
      new RegExp(`^http://127\\.0\\.0\\.1:${server.port}/api/v1/local/session\\?code=[\\w-]{20,}$`),
    );
    expect(typeof server.stop).toBe('function');
  });

  it('keeps PGlite in the data folder, which only the OS user can open', () => {
    expect(existsSync(path.join(dataDir, 'db', 'PG_VERSION'))).toBe(true);
    if (process.platform !== 'win32') expect(statSync(dataDir).mode & 0o077).toBe(0);
  });

  it('serves the API over HTTP to the browser that opened the one-time URL', async () => {
    const me = (await (
      await fetch(`${server.url}/api/v1/me`, { headers: { cookie } })
    ).json()) as Me;
    expect(me.local).toBe(true);
    expect(me.workspaces.map((entry) => entry.workspace.name)).toEqual(['Demo']);
    expect((await fetch(`${server.url}/api/v1/me`)).status).toBe(401);
    expect((await fetch(server.oneTimeUrl ?? '', { redirect: 'manual' })).status).toBe(401);
  });

  it('loaded the demo on this first run, and hands its token to the first page once', async () => {
    expect(server.demoLoaded).toBe(true);
    const take = () =>
      fetch(`${server.url}/api/v1/local/demo-token`, {
        method: 'POST',
        headers: { cookie, origin: server.url },
      });
    const first = (await (await take()).json()) as { demo: { token: string } | null };
    expect(first.demo).toMatchObject({ workspace: 'demo', project: 'DEMO', agent: 'builder' });
    expect(first.demo?.token).toMatch(/^tk_/);
    expect(((await (await take()).json()) as { demo: unknown }).demo).toBeNull();
    // Without the local session there is nothing to take.
    expect((await fetch(`${server.url}/api/v1/local/demo-token`, { method: 'POST' })).status).toBe(
      401,
    );
  });

  it('gives out another one-time URL when asked', async () => {
    const second = await exchange(server.newOneTimeUrl());
    expect((await fetch(`${server.url}/api/v1/me`, { headers: { cookie: second } })).status).toBe(
      200,
    );
  });

  it('over a real socket, a Host that is not a loopback name of this server and its port is rejected', async () => {
    expect((await rawGet(server.port, '/healthz', `127.0.0.1:${server.port}`)).status).toBe(200);
    expect((await rawGet(server.port, '/healthz', `localhost:${server.port}`)).status).toBe(200);
    expect(
      (await rawGet(server.port, '/healthz', `turnkeel.localhost:${server.port}`)).status,
    ).toBe(200);
    for (const host of [
      'evil.example',
      `evil.example:${server.port}`,
      '127.0.0.1:1',
      'localhost',
      'turnkeel.localhost:1',
      `localhost.evil.example:${server.port}`,
      `a_b.localhost:${server.port}`,
    ]) {
      const answer = await rawGet(server.port, '/healthz', host);
      expect([host, answer.status]).toEqual([host, 403]);
      expect(JSON.parse(answer.body)).toMatchObject({ error: { code: 'forbidden', rule: 'R33' } });
    }
  });

  it('streams a project’s event over HTTP as it is created', async () => {
    const controller = new AbortController();
    const response = await fetch(`${server.url}/api/v1/workspaces/demo/stream`, {
      headers: { cookie, accept: 'text/event-stream' },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (marker: string) => {
      while (!text.includes(marker)) {
        const chunk = (await reader.read()) as { done: boolean; value?: Uint8Array };
        if (chunk.done) throw new Error('The stream ended.');
        text += decoder.decode(chunk.value, { stream: true });
      }
    };
    await readUntil(': connected');

    const created = await fetch(`${server.url}/api/v1/workspaces/demo/projects`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: server.url },
      body: JSON.stringify({ name: 'Over HTTP', key: 'HTTP', slug: 'over-http' }),
    });
    expect(created.status).toBe(201);
    const project = (await created.json()) as Project;
    await readUntil(project.id);
    expect(text).toContain('event: change');
    expect(text).toContain('"type":"project.created"');
    expect(text).not.toContain('Over HTTP');
    controller.abort();
    await reader.cancel().catch(() => {});
  });

  it('refuses a second server on the same data folder while this one runs', async () => {
    await expect(startLocal({ port: 0, dataDir, ...quick })).rejects.toBeInstanceOf(
      DataDirInUseError,
    );
  });

  it(
    'says so when the port is taken, and leaves nothing running',
    async () => {
      const other = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-data-'));
      try {
        await expect(
          startLocal({ port: server.port, dataDir: other, demo: true, ...quick }),
        ).rejects.toThrow(ListenError);
        // The data folder was let go again, and nothing was seeded into it: the port is
        // bound before the demo is loaded, so the next start is the first run whose page
        // shows the token.
        const next = await startLocal({ port: 0, dataDir: other, demo: true, ...quick });
        expect(next.demoLoaded).toBe(true);
        await next.stop();
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    },
    SLOW,
  );

  it('refuses to listen on an address that is not the loopback address', async () => {
    await expect(
      startLocal({ port: 0, dataDir, host: '0.0.0.0', logger: silentLogger }),
    ).rejects.toBeInstanceOf(ConfigError);
    // Also when the configuration was put together by hand, past the check of the environment.
    const byHand = { ...server.runtime.config, host: '0.0.0.0', port: 0 };
    await expect(startServer(byHand, quick)).rejects.toThrow(
      /Without sign-in the server listens on 127\.0\.0\.1, localhost or ::1 only/,
    );
    // An address of 127.0.0.0/8 that no allowed Host reaches is refused as well.
    await expect(startServer({ ...byHand, host: '127.0.0.2' }, quick)).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it('says what a person needs to know at start', () => {
    const logger = memoryLogger();
    describeStart(server, logger);
    expect(logger.lines).toEqual([
      `Database: PGlite (${path.join(dataDir, 'db')}).`,
      `Turnkeel is listening at http://127.0.0.1:${server.port}`,
      'Local mode: this machine only, no accounts or passwords. A browser gets in with a one-time address from the terminal where turnkeel runs; agents use a token.',
      `Open this address once to use Turnkeel in your browser: ${server.oneTimeUrl}`,
      messages.log.loadedDemo,
    ]);
  });

  it('leaves the one-time URL out for a launcher, which is handed it another way', () => {
    const logger = memoryLogger();
    describeStart(server, logger, { oneTimeUrl: false });
    expect(logger.lines).toEqual([
      `Database: PGlite (${path.join(dataDir, 'db')}).`,
      `Turnkeel is listening at http://127.0.0.1:${server.port}`,
      messages.log.localMode,
    ]);
  });
});

describe.skipIf(process.platform === 'win32')('startLocal on a data folder made by hand', () => {
  it(
    'closes the folder and the database inside it to other accounts',
    async () => {
      const dataDir = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-start-open-'));
      chmodSync(dataDir, 0o755);
      const server = await startLocal({ port: 0, dataDir, ...quick });
      try {
        expect(statSync(dataDir).mode & 0o777).toBe(0o700);
        expect(statSync(path.join(dataDir, 'db')).mode & 0o777).toBe(0o700);
        expect(existsSync(path.join(dataDir, 'db', 'PG_VERSION'))).toBe(true);
        const cookie = await exchange(server.oneTimeUrl!);
        const me = await fetch(`${server.url}/api/v1/me`, { headers: { cookie } });
        expect(me.status).toBe(200);
      } finally {
        await server.stop();
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    SLOW,
  );
});

describe('startServer with sign-in, over a real socket', () => {
  const ask = (server: RunningServer, request: number) =>
    fetch(`http://127.0.0.1:${server.port}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:4400',
        // What a client sends to be counted as someone else each time.
        'x-forwarded-for': `198.51.100.${request}`,
        'x-turnkeel-client-ip': `198.51.100.${request}`,
      },
      body: JSON.stringify({ email: `nobody-${request}@example.com`, callbackURL: '/' }),
    }).then((response) => response.status);

  const start = (dataDir: string, env: Record<string, string> = {}) =>
    startServer(
      {
        ...loadConfig({
          TURNKEEL_PUBLIC_URL: 'http://localhost:4400',
          TURNKEEL_AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
          TURNKEEL_DATA_DIR: dataDir,
          ...env,
        }),
        port: 0,
      },
      quick,
    );

  it(
    'names the public address as the one to open, and the bound address without a link',
    async () => {
      const dataDir = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-start-lines-'));
      try {
        const server = await start(dataDir);
        try {
          const logger = memoryLogger();
          describeStart(server, logger);
          expect(logger.lines).toContain(
            `Turnkeel is listening on ${server.host}, port ${server.port}.`,
          );
          expect(logger.lines).toContain(
            'Sign-in is on. Open Turnkeel at http://localhost:4400 (TURNKEEL_PUBLIC_URL). Sign-in works only at that address.',
          );
          // A browser that opened the bound address could not sign in there.
          expect(logger.lines.join('\n')).not.toContain(`http://${server.host}:`);
        } finally {
          await server.stop();
        }
      } finally {
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    SLOW,
  );

  it(
    'counts sign-in requests under the address of the socket, and believes X-Forwarded-For only from a trusted proxy',
    async () => {
      const dataDir = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-start-limit-'));
      try {
        // No proxy is trusted: every request is this machine's, whatever it claims.
        const direct = await start(dataDir);
        try {
          const statuses: number[] = [];
          for (let request = 1; request <= 6; request += 1)
            statuses.push(await ask(direct, request));
          expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
        } finally {
          await direct.stop();
        }

        // This machine is a trusted proxy: the address it passes on is the client's.
        const proxied = await start(dataDir, { TURNKEEL_TRUSTED_PROXIES: '127.0.0.1,::1' });
        try {
          const statuses: number[] = [];
          for (let request = 11; request <= 17; request += 1) {
            statuses.push(await ask(proxied, request));
          }
          expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200]);
        } finally {
          await proxied.stop();
        }
      } finally {
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    SLOW,
  );
});

describe('startLocal on the IPv6 loopback address', () => {
  it(
    'hands out an address that the server answers at, with localhost as its name',
    async (context) => {
      if (!(await canListenOn('::1'))) return context.skip();
      const dataDir = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-start-v6-'));
      const logger = memoryLogger();
      const server = await startLocal({ port: 0, dataDir, host: '::1', ...quick, logger });
      try {
        expect(server.host).toBe('::1');
        expect(server.url).toBe(`http://localhost:${server.port}`);
        expect(server.oneTimeUrl).toMatch(
          new RegExp(`^http://localhost:${server.port}/api/v1/local/session\\?code=`),
        );
        // Over the socket it listens on, named the way the one-time URL names it.
        const opened = await rawGetOn('::1', server.port, urlPath(server.oneTimeUrl!), {
          host: `localhost:${server.port}`,
        });
        expect(opened.status).toBe(302);
        expect(opened.cookie).toContain('turnkeel_local=');
        const me = await rawGetOn('::1', server.port, '/api/v1/me', {
          host: `localhost:${server.port}`,
          cookie: opened.cookie,
        });
        expect(me.status).toBe(200);
        expect((JSON.parse(me.body) as Me).local).toBe(true);
        // The address as a URL writes it is still not one of the two names of R33.
        const bracketed = await rawGetOn('::1', server.port, '/healthz', {
          host: `[::1]:${server.port}`,
        });
        expect(bracketed.status).toBe(403);

        describeStart(server, logger);
        expect(logger.lines).toContain(`Turnkeel is listening at http://localhost:${server.port}`);
      } finally {
        await server.stop();
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    SLOW,
  );
});

describe('a second start on the same data folder', () => {
  it(
    'finds the data of the first, and the cookie of the first still works',
    async () => {
      const dataDir = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-data-'));
      try {
        const first = await startLocal({ port: 0, dataDir, demo: true, ...quick });
        const firstCookie = await exchange(first.oneTimeUrl ?? '');
        const unused = first.newOneTimeUrl();
        const created = await fetch(`${first.url}/api/v1/workspaces/demo/projects`, {
          method: 'POST',
          headers: { cookie: firstCookie, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Kept', key: 'KEPT', slug: 'kept' }),
        });
        expect(created.status).toBe(201);
        const keyFile = path.join(dataDir, LOCAL_SESSION_KEY_FILE);
        if (process.platform !== 'win32') expect(statSync(keyFile).mode & 0o777).toBe(0o600);
        await first.stop();
        // Stopped: nothing listens there any more.
        await expect(fetch(`${first.url}/healthz`)).rejects.toThrow();

        const second = await startLocal({ port: 0, dataDir, ...quick });
        try {
          const projects = (await (
            await fetch(`${second.url}/api/v1/workspaces/demo/projects`, {
              headers: { cookie: firstCookie },
            })
          ).json()) as Project[];
          expect(projects.map((project) => project.slug)).toContain('kept');
          expect(second.demoLoaded).toBe(false);
          // The one-time codes live in memory: a code of the first start is gone.
          const code = new URL(unused).search;
          const stale = await fetch(`${second.url}/api/v1/local/session${code}`, {
            redirect: 'manual',
          });
          expect(stale.status).toBe(401);
          // A new code of this start gives the same cookie.
          expect(await exchange(second.oneTimeUrl ?? '')).toBe(firstCookie);
        } finally {
          await second.stop();
        }

        // Removing the key file signs every browser out at the next start.
        rmSync(keyFile);
        const third = await startLocal({ port: 0, dataDir, ...quick });
        try {
          const old = await fetch(`${third.url}/api/v1/me`, { headers: { cookie: firstCookie } });
          expect(old.status).toBe(401);
          const cookie = await exchange(third.oneTimeUrl ?? '');
          expect(cookie).not.toBe(firstCookie);
          expect((await fetch(`${third.url}/api/v1/me`, { headers: { cookie } })).status).toBe(200);
        } finally {
          await third.stop();
        }
      } finally {
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    SLOW,
  );

  it.skipIf(process.platform === 'win32')(
    'replaces a key file that other accounts can read, which signs the browser out, and says so without the key',
    async () => {
      const dataDir = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-data-'));
      try {
        const first = await startLocal({ port: 0, dataDir, ...quick });
        const firstCookie = await exchange(first.oneTimeUrl ?? '');
        await first.stop();
        const keyFile = path.join(dataDir, LOCAL_SESSION_KEY_FILE);
        const before = readFileSync(keyFile);
        chmodSync(keyFile, 0o644);

        const logger = memoryLogger();
        const second = await startLocal({ port: 0, dataDir, ...quick, logger });
        try {
          expect(statSync(keyFile).mode & 0o777).toBe(0o600);
          expect(readFileSync(keyFile).equals(before)).toBe(false);
          const old = await fetch(`${second.url}/api/v1/me`, { headers: { cookie: firstCookie } });
          expect(old.status).toBe(401);
          const said = logger.lines.filter((line) => line.includes(LOCAL_SESSION_KEY_FILE));
          expect(said).toHaveLength(1);
          expect(said[0]).toContain('could be read by other accounts');
          const text = logger.lines.join('\n');
          for (const key of [before, readFileSync(keyFile)]) {
            expect(text).not.toContain(key.toString('base64'));
            expect(text).not.toContain(key.toString('base64url'));
            expect(text).not.toContain(key.toString('hex'));
          }
        } finally {
          await second.stop();
        }
      } finally {
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    SLOW,
  );
});

describe('the process entry', () => {
  function start(env: Record<string, string>, channel = true): ChildProcess {
    return spawn(
      process.execPath,
      ['--import', path.join(here, '..', 'scripts', 'ts-resolve.mjs'), path.join(here, 'index.ts')],
      {
        env: { PATH: process.env.PATH ?? '', HOME: os.homedir(), NODE_NO_WARNINGS: '1', ...env },
        stdio: channel ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
      },
    );
  }

  function finished(child: ChildProcess): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve) => {
      let output = '';
      child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.on('close', (code) => resolve({ code, output }));
    });
  }

  it(
    'starts local mode from the environment, tells its parent the one-time URL, and stops on SIGTERM',
    async () => {
      const dataDir = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-data-'));
      const port = await freePort();
      const child = start({
        TURNKEEL_PORT: String(port),
        TURNKEEL_DATA_DIR: dataDir,
        TURNKEEL_DEMO: 'true',
      });
      const done = finished(child);
      try {
        const ready = await new Promise<ReadyMessage>((resolve, reject) => {
          child.once('message', (message) => resolve(message as ReadyMessage));
          child.once('close', () => reject(new Error('The server stopped before it was ready.')));
        });
        expect(ready).toMatchObject({
          type: 'turnkeel.ready',
          mode: 'local',
          url: `http://127.0.0.1:${port}`,
        });
        expect(ready.oneTimeUrl).toContain(`http://127.0.0.1:${port}/api/v1/local/session?code=`);
        // This first run with --demo loaded the demo, and says so to the launcher once.
        expect(ready.demo).toBe(true);

        const cookie = await exchange(ready.oneTimeUrl ?? '');
        const me = (await (
          await fetch(`${ready.url}/api/v1/me`, { headers: { cookie } })
        ).json()) as Me;
        expect(me.local).toBe(true);

        // The parent can ask for another one-time URL.
        const another = new Promise<ReadyMessage>((resolve) => {
          child.once('message', (message) => resolve(message as ReadyMessage));
        });
        child.send({ type: 'turnkeel.one-time-url' });
        const second = await another;
        expect(second.oneTimeUrl).not.toBe(ready.oneTimeUrl);
        expect(second.demo).toBe(false);
        await exchange(second.oneTimeUrl ?? '');

        child.kill('SIGTERM');
        const { code, output } = await done;
        expect(code).toBe(0);
        expect(output).toContain(`Turnkeel is listening at http://127.0.0.1:${port}`);
        // The parent got the one-time URLs over the channel. None is printed, and the
        // demo's line is the launcher's to say.
        expect(output).not.toContain('/api/v1/local/session');
        expect(output).not.toContain(messages.log.loadedDemo);
        expect(output).toContain('Turnkeel has stopped.');
        expect(existsSync(path.join(dataDir, 'server.lock'))).toBe(false);
      } finally {
        child.kill('SIGKILL');
        await done;
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    SLOW,
  );

  it(
    'started by hand, with no parent on a channel, prints the one-time URL',
    async () => {
      const dataDir = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-data-'));
      const port = await freePort();
      const child = start(
        { TURNKEEL_PORT: String(port), TURNKEEL_DATA_DIR: dataDir, TURNKEEL_DEMO: 'true' },
        false,
      );
      const done = finished(child);
      try {
        const oneTimeUrl = await new Promise<string>((resolve, reject) => {
          let printed = '';
          child.stdout?.on('data', (chunk: Buffer) => {
            printed += chunk.toString();
            const found = /Open this address once to use Turnkeel in your browser: (\S+)/.exec(
              printed,
            );
            if (found?.[1] !== undefined) resolve(found[1]);
          });
          child.once('close', () => reject(new Error('The server stopped before it was ready.')));
        });
        expect(oneTimeUrl).toContain(`http://127.0.0.1:${port}/api/v1/local/session?code=`);
        const cookie = await exchange(oneTimeUrl);
        const me = (await (
          await fetch(`http://127.0.0.1:${port}/api/v1/me`, { headers: { cookie } })
        ).json()) as Me;
        expect(me.local).toBe(true);

        child.kill('SIGTERM');
        const { code, output } = await done;
        expect(code).toBe(0);
        // Started by hand on a first run, it says where the demo's token is, once.
        expect(output.split(messages.log.loadedDemo)).toHaveLength(2);
      } finally {
        child.kill('SIGKILL');
        await done;
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    SLOW,
  );

  it(
    'tells its parent it loaded no demo on a first run without TURNKEEL_DEMO',
    async () => {
      const dataDir = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-data-'));
      const port = await freePort();
      const child = start({ TURNKEEL_PORT: String(port), TURNKEEL_DATA_DIR: dataDir });
      const done = finished(child);
      try {
        const ready = await new Promise<ReadyMessage>((resolve, reject) => {
          child.once('message', (message) => resolve(message as ReadyMessage));
          child.once('close', () => reject(new Error('The server stopped before it was ready.')));
        });
        expect(ready).toMatchObject({ type: 'turnkeel.ready', mode: 'local', demo: false });
        child.kill('SIGTERM');
        expect((await done).code).toBe(0);
      } finally {
        child.kill('SIGKILL');
        await done;
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    SLOW,
  );

  it(
    'exits with 1 and names the variable when the configuration cannot be used',
    async () => {
      const child = start({ TURNKEEL_HOST: '0.0.0.0', GITHUB_CLIENT_ID: 'half' });
      const { code, output } = await finished(child);
      expect(code).toBe(1);
      expect(output).toContain('Turnkeel cannot start with this configuration.');
      expect(output).toContain(
        'TURNKEEL_HOST is not an address the server listens on without sign-in.',
      );
      // No value is repeated in a message.
      expect(output).not.toContain('0.0.0.0');
      expect(output).toContain(
        'GITHUB_CLIENT_ID is set and GITHUB_CLIENT_SECRET is not. Set both.',
      );
    },
    SLOW,
  );
});

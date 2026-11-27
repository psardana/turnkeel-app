import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { schema } from '@turnkeel/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bodyOf,
  createTestServer,
  errorOf,
  SERVER_URL,
  type Session,
  type TestServer,
} from '../testing/harness.js';
import { MAX_AUTH_BODY_BYTES, REQUEST_ID_HEADER, RESERVED_PREFIXES } from './app.js';

const NOT_FOUND = { code: 'not_found', message: 'There is nothing at this address.' };
const SHELL = '<!doctype html><title>Turnkeel</title><div id="root"></div>';

describe('routing and static files', () => {
  let t: TestServer;
  let owner: Session;
  let webDir: string;

  beforeAll(async () => {
    webDir = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-web-'));
    mkdirSync(path.join(webDir, 'assets'));
    writeFileSync(path.join(webDir, 'index.html'), SHELL);
    writeFileSync(path.join(webDir, 'assets', 'app-3f9a1c.js'), 'console.log("app")');
    writeFileSync(path.join(webDir, 'sw.js'), '// service worker');
    writeFileSync(path.join(webDir, 'manifest.webmanifest'), '{"name":"Turnkeel"}');
    // A file outside the build, which no path may reach.
    writeFileSync(path.join(webDir, '..', 'turnkeel-outside.txt'), 'outside');
    t = await createTestServer('pglite', { runtime: { webDir } });
    owner = await t.signIn('olive@example.com', 'Olive Owner');
    await t.post('/api/v1/workspaces', { name: 'Acme', slug: 'acme', handle: 'olive' }, owner);
  }, 60_000);
  afterAll(async () => {
    await t.stop();
    rmSync(webDir, { recursive: true, force: true });
    rmSync(path.join(webDir, '..', 'turnkeel-outside.txt'), { force: true });
  }, 60_000);

  describe('every answer', () => {
    it('carries a request id, a new one each time', async () => {
      const ids = new Set<string>();
      for (const [method, path_] of [
        ['GET', '/healthz'],
        ['GET', '/api/v1/me'],
        ['GET', '/api/v1/nothing'],
        ['GET', '/some/page'],
        ['GET', '/assets/app-3f9a1c.js'],
        ['POST', '/api/v1/workspaces'],
        ['GET', '/api/auth/get-session'],
      ] as const) {
        const response = await t.request(method, path_);
        const id = response.headers.get(REQUEST_ID_HEADER);
        expect([path_, id]).toEqual([path_, expect.stringMatching(/^[0-9a-f-]{36}$/)]);
        ids.add(id ?? '');
      }
      expect(ids.size).toBe(7);
    });

    it('does not take a request id from the client', async () => {
      const sent = '11111111-1111-4111-8111-111111111111';
      const response = await t.request('GET', '/healthz', { headers: { 'x-request-id': sent } });
      expect(response.headers.get(REQUEST_ID_HEADER)).not.toBe(sent);
    });

    it('says nosniff', async () => {
      for (const path_ of ['/healthz', '/', '/assets/app-3f9a1c.js', '/api/v1/server']) {
        expect((await t.get(path_)).headers.get('x-content-type-options')).toBe('nosniff');
      }
    });
  });

  describe('GET /healthz', () => {
    it('answers 200 without a session', async () => {
      const response = await t.get('/healthz');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok' });
    });
  });

  describe('errors', () => {
    it('are `{ error: { code, message } }` for an unknown route under /api, never the shell', async () => {
      for (const path_ of ['/api', '/api/nothing', '/api/v1/nothing', '/api/v2/me']) {
        const response = await t.get(path_, owner);
        expect([path_, response.status]).toEqual([path_, 404]);
        expect(await response.json()).toEqual({ error: NOT_FOUND });
      }
    });

    it('a body over the limit is refused with 413', async () => {
      const response = await t.request('POST', '/api/v1/workspaces', {
        as: owner,
        json: { name: 'x'.repeat(1024 * 1024 + 10), slug: 'big', handle: 'olive' },
      });
      expect(response.status).toBe(413);
      expect((await errorOf(response)).code).toBe('payload_too_large');
    });

    it('a method a route does not have is the one 404', async () => {
      const response = await t.request('PUT', '/api/v1/workspaces/acme', { as: owner, json: {} });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: NOT_FOUND });
    });

    it('a write from another site is refused with 403, also with a session', async () => {
      const response = await t.request('POST', '/api/v1/workspaces', {
        as: owner,
        json: { name: 'Evil', slug: 'evil', handle: 'olive' },
        headers: { origin: 'https://evil.example' },
      });
      expect(response.status).toBe(403);
      const same = await t.request('PATCH', '/api/v1/workspaces/acme', {
        as: owner,
        json: { name: 'Acme Inc' },
        headers: { origin: 'http://localhost:4400' },
      });
      expect(same.status).toBe(200);
    });
  });

  describe('no principal', () => {
    const id = '99999999-9999-4999-8999-999999999999';
    const endpoints: [string, string][] = [
      ['GET', '/api/v1/me'],
      ['GET', '/api/v1/workspaces'],
      ['POST', '/api/v1/workspaces'],
      ['GET', '/api/v1/workspaces/acme'],
      ['PATCH', '/api/v1/workspaces/acme'],
      ['DELETE', '/api/v1/workspaces/acme'],
      ['POST', '/api/v1/workspaces/acme/transfer'],
      ['GET', '/api/v1/workspaces/acme/members'],
      ['PATCH', `/api/v1/workspaces/acme/members/${id}`],
      ['DELETE', `/api/v1/workspaces/acme/members/${id}`],
      ['GET', `/api/v1/workspaces/acme/projects/app/members/${id}`],
      ['PUT', `/api/v1/workspaces/acme/projects/app/members/${id}`],
      ['DELETE', `/api/v1/workspaces/acme/projects/app/members/${id}`],
      ['GET', '/api/v1/workspaces/acme/invitations'],
      ['POST', '/api/v1/workspaces/acme/invitations'],
      ['DELETE', `/api/v1/invitations/${id}`],
      ['POST', '/api/v1/invitations/accept'],
      ['GET', '/api/v1/workspaces/acme/projects'],
      ['POST', '/api/v1/workspaces/acme/projects'],
      ['GET', '/api/v1/workspaces/acme/projects/app'],
      ['PATCH', '/api/v1/workspaces/acme/projects/app'],
      ['POST', '/api/v1/workspaces/acme/projects/app/archive'],
      ['GET', '/api/v1/workspaces/acme/events'],
      ['GET', '/api/v1/workspaces/acme/events/export'],
      ['GET', '/api/v1/workspaces/acme/stream'],
    ];

    it.each(endpoints)('%s %s answers 401 without a session', async (method, path_) => {
      const response = await t.request(method, path_, method === 'GET' ? {} : { json: {} });
      expect(response.status).toBe(401);
      expect((await errorOf(response)).code).toBe('unauthorized');
    });

    it.each(endpoints)(
      '%s %s answers 401 to a bearer token, also next to a session cookie',
      async (method, path_) => {
        const response = await t.request(method, path_, {
          as: owner,
          headers: { authorization: 'Bearer tk_live_guess' },
          ...(method === 'GET' ? {} : { json: {} }),
        });
        expect(response.status).toBe(401);
      },
    );

    it('the three routes that need none say so by answering', async () => {
      expect((await t.get('/api/v1/server')).status).toBe(200);
      expect((await t.get('/healthz')).status).toBe(200);
      // A lookup with a token nobody knows is the one 404, not 401.
      expect((await t.post('/api/v1/invitations/lookup', { token: 'unknown' })).status).toBe(404);
    });
  });

  describe('the prefixes kept for later steps', () => {
    it.each(RESERVED_PREFIXES.filter((prefix) => prefix !== '/api' && prefix !== '/mcp'))(
      '%s answers the one 404, for every method, and never the shell',
      async (prefix) => {
        for (const [method, path_] of [
          ['GET', prefix],
          ['POST', prefix],
          ['GET', `${prefix}/anything`],
          ['POST', `${prefix}/anything/deeper`],
          ['DELETE', prefix],
        ] as const) {
          const response = await t.request(method, path_, { as: owner });
          expect([method, path_, response.status]).toEqual([method, path_, 404]);
          expect(await response.json()).toEqual({ error: NOT_FOUND });
        }
      },
    );

    it('/mcp takes POST with an agent token only: 401 without, 405 for GET and DELETE, and 404 below it', async () => {
      expect((await t.request('POST', '/mcp', { as: owner, json: {} })).status).toBe(401);
      expect((await t.request('GET', '/mcp', { as: owner })).status).toBe(405);
      expect((await t.request('DELETE', '/mcp', { as: owner })).status).toBe(405);
      for (const [method, path_] of [
        ['GET', '/mcp/anything'],
        ['POST', '/mcp/anything/deeper'],
      ] as const) {
        const response = await t.request(method, path_, { as: owner });
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: NOT_FOUND });
      }
    });

    it('a path that only starts like a prefix is an ordinary page', async () => {
      for (const path_ of ['/apiary', '/hooksville', '/changelogs/1']) {
        const response = await t.get(path_);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(SHELL);
      }
    });
  });

  describe('the web build', () => {
    it('serves a file of the build with its type, and a hashed asset as immutable', async () => {
      const asset = await t.get('/assets/app-3f9a1c.js');
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(await asset.text()).toBe('console.log("app")');

      const worker = await t.get('/sw.js');
      expect(worker.status).toBe(200);
      expect(worker.headers.get('cache-control')).toBe('no-cache');
      const manifest = await t.get('/manifest.webmanifest');
      expect(manifest.headers.get('content-type')).toBe('application/manifest+json; charset=utf-8');
    });

    it('answers every other path with the app shell, which is never cached and has a Content-Security-Policy', async () => {
      for (const path_ of [
        '/',
        '/index.html',
        '/acme/app/board',
        '/invitations/accept?token=abc',
      ]) {
        const response = await t.get(path_);
        expect([path_, response.status]).toEqual([path_, 200]);
        expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(response.headers.get('cache-control')).toBe('no-cache');
        expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
        expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
        // Images and media from the server and its file store, never any https: address.
        const policy = response.headers.get('content-security-policy') ?? '';
        const imgSrc = policy.split('; ').find((part) => part.startsWith('img-src')) ?? '';
        expect(imgSrc).toMatch(/^img-src 'self' data: blob:( https?:\/\/[^ ;]+)*$/);
        expect(imgSrc).not.toMatch(/ https:( |$)/);
        expect(policy).not.toMatch(/media-src[^;]* https:( |;|$)/);
        expect(await response.text()).toBe(SHELL);
      }
    });

    it('answers HEAD without a body', async () => {
      const response = await t.request('HEAD', '/acme');
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
    });

    it('gives the shell, and no file, to a path that tries to leave the build', async () => {
      for (const path_ of [
        '/../turnkeel-outside.txt',
        '/assets/../../turnkeel-outside.txt',
        '/%2e%2e/turnkeel-outside.txt',
        '/assets/%2e%2e%2f%2e%2e%2fturnkeel-outside.txt',
        '/..%2fturnkeel-outside.txt',
      ]) {
        const response = await t.runtime.app.request(`http://localhost:4400${path_}`);
        expect(await response.text()).not.toContain('outside');
      }
    });

    it('a write to a page is the one 404, not the shell', async () => {
      const response = await t.request('POST', '/acme/app/board', { json: {} });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: NOT_FOUND });
    });
  });

  describe('sign-in routes', () => {
    it('are Better Auth’s, under /api/auth, and reach it before anything else', async () => {
      const none = await t.get('/api/auth/get-session');
      expect(none.status).toBe(200);
      expect(await none.json()).toBeNull();
      const mine = await bodyOf<{ user: { email: string } }>(
        await t.get('/api/auth/get-session', owner),
      );
      expect(mine.user.email).toBe('olive@example.com');
    });

    it('refuse a body over their limit with 413, and store nothing of it', async () => {
      const rows = async () => (await t.test.db.select().from(schema.verification)).length;
      const before = await rows();
      const ask = (name: string, headers: Record<string, string> = {}) =>
        t.request('POST', '/api/auth/sign-in/magic-link', {
          json: { email: 'nobody@example.com', callbackURL: '/', name },
          headers: { origin: SERVER_URL, ...headers },
        });

      const big = 'x'.repeat(MAX_AUTH_BODY_BYTES);
      // Once as a client that says how long its body is, and once as one that does not.
      const declared = await ask(big, { 'content-length': String(big.length + 80) });
      expect(declared.status).toBe(413);
      expect((await errorOf(declared)).code).toBe('payload_too_large');
      const streamed = await ask(big);
      expect(streamed.status).toBe(413);
      expect((await errorOf(streamed)).code).toBe('payload_too_large');
      expect(await rows()).toBe(before);

      // A request of ordinary size is Better Auth's to answer.
      const ordinary = await ask('Nobody');
      expect(ordinary.status).toBe(200);
      expect(await ordinary.json()).toEqual({ status: true });
    });
  });
});

describe('without a web build', () => {
  it('says so on every page and still serves the API', async () => {
    const t = await createTestServer('pglite', { runtime: { webDir: null } });
    try {
      const page = await t.get('/');
      expect(page.status).toBe(503);
      expect(await page.text()).toBe('The web app is not built yet. Run pnpm build.');
      expect((await t.get('/healthz')).status).toBe(200);
      expect((await t.get('/api/v1/server')).status).toBe(200);
    } finally {
      await t.stop();
    }
  }, 60_000);
});

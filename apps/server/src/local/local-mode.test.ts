import { mkdtempSync, rmSync } from 'node:fs';
import { countUsers, countWorkspaces } from '@turnkeel/db';
import { testEngines } from '@turnkeel/db/testing';
import type { Me, Project, ServerInfo, StreamMessage, Workspace } from '@turnkeel/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCAL_SESSION_COOKIE } from '../auth/local-session.js';
import {
  bodyOf,
  createTestServer,
  errorOf,
  eventsOf,
  openStream,
  type Session,
  type TestServer,
} from '../testing/harness.js';
import { prepareLocalInstall } from './bootstrap.js';

describe.each(testEngines)('local mode on %s', (engine) => {
  let t: TestServer;
  let owner: Session;

  beforeAll(async () => {
    t = await createTestServer(engine, { mode: 'local' });
    owner = await t.localSession();
  }, 60_000);
  afterAll(async () => {
    await t.stop();
  }, 60_000);

  describe('the first start without --demo', () => {
    it('makes no workspace: the app asks the local owner for a name, and they may create one', async () => {
      const bare = await createTestServer(engine, { mode: 'local', firstRun: 'none' });
      try {
        const session = await bare.localSession();
        const mine = await bodyOf<Me>(await bare.get('/api/v1/me', session));
        expect(mine.local).toBe(true);
        expect(mine.canCreateWorkspace).toBe(true);
        expect(mine.workspaces).toEqual([]);
        expect(await countWorkspaces(bare.test.db, { includeDeleted: true })).toBe(0);
        expect(await countUsers(bare.test.db)).toBe(1);
      } finally {
        await bare.stop();
      }
    });

    it('the workspace the local owner makes is theirs, with the handle they picked', async () => {
      const me = await bodyOf<Me>(await t.get('/api/v1/me', owner));
      expect(me.workspaces).toHaveLength(1);
      expect(me.workspaces[0]).toMatchObject({
        workspace: { name: 'My workspace', slug: 'my-workspace', demo: false },
        role: 'owner',
        handle: 'owner',
      });
      const projects = await bodyOf<Project[]>(
        await t.get('/api/v1/workspaces/my-workspace/projects', owner),
      );
      expect(projects).toEqual([]);
    });

    it('does nothing at the next start: the same owner, no second workspace', async () => {
      const again = await prepareLocalInstall(t.test.db);
      const me = await bodyOf<Me>(await t.get('/api/v1/me', owner));
      expect(again.id).toBe(me.user.id);
      expect(await countUsers(t.test.db)).toBe(1);
      expect(await countWorkspaces(t.test.db)).toBe(1);
    });
  });

  describe('the local session (R29)', () => {
    it('the one-time URL sets an HTTP-only, SameSite=Strict cookie and sends the browser to the app', async () => {
      const url = new URL(t.runtime.newOneTimeUrl());
      expect(url.origin).toBe('http://127.0.0.1:4400');
      expect(url.pathname).toBe('/api/v1/local/session');
      const response = await t.get(`${url.pathname}${url.search}`);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/');
      const cookie = response.headers.getSetCookie()[0] ?? '';
      expect(cookie.startsWith(`${LOCAL_SESSION_COOKIE}=`)).toBe(true);
      expect(cookie).toMatch(/; HttpOnly/);
      expect(cookie).toMatch(/; SameSite=Strict/);
      expect(cookie).toMatch(/; Path=\//);
      // The code is not the cookie: holding the URL gives nothing once it was used.
      expect(cookie).not.toContain(url.searchParams.get('code'));
    });

    it('the one-time URL works once', async () => {
      const url = new URL(t.runtime.newOneTimeUrl());
      expect((await t.get(`${url.pathname}${url.search}`)).status).toBe(302);
      const again = await t.get(`${url.pathname}${url.search}`);
      expect(again.status).toBe(401);
      const refused = await errorOf(again);
      expect(refused.code).toBe('unauthorized');
      // The launcher prints no address when it opens the browser itself, and gives a
      // new one on Enter, so the sentence names that and not a line that was never printed.
      expect(refused.message).toBe(
        'This address was already used or is not valid. It works once. Press Enter in the terminal where turnkeel runs for a new one, or start turnkeel again.',
      );
      expect(again.headers.getSetCookie()).toEqual([]);
    });

    it('a request without the local session is told how to get one', async () => {
      const response = await t.get('/api/v1/me');
      expect(response.status).toBe(401);
      expect((await errorOf(response)).message).toBe(
        'This request has no local session. Press Enter in the terminal where turnkeel runs to get a one-time address and open it, or send an agent token. If turnkeel was started without a terminal, start it again.',
      );
    });

    it('a code nobody issued, or no code, sets no cookie', async () => {
      for (const path of ['/api/v1/local/session?code=made-up', '/api/v1/local/session']) {
        const response = await t.get(path);
        expect(response.status).toBe(401);
        expect(response.headers.getSetCookie()).toEqual([]);
      }
    });

    it('a request without the cookie is not the local owner: 401', async () => {
      for (const path of [
        '/api/v1/me',
        '/api/v1/workspaces',
        '/api/v1/workspaces/my-workspace',
        '/api/v1/workspaces/my-workspace/projects',
        '/api/v1/workspaces/my-workspace/events',
        '/api/v1/workspaces/my-workspace/events/export',
        '/api/v1/workspaces/my-workspace/stream',
      ]) {
        const response = await t.get(path);
        expect([path, response.status]).toEqual([path, 401]);
        expect((await errorOf(response)).code).toBe('unauthorized');
      }
      const write = await t.post('/api/v1/workspaces/my-workspace/projects', {
        name: 'No',
        key: 'NO',
        slug: 'no',
      });
      expect(write.status).toBe(401);
    });

    it('a cookie with another value is not the local owner', async () => {
      const response = await t.get('/api/v1/me', {
        cookie: `${LOCAL_SESSION_COOKIE}=${'a'.repeat(43)}`,
        email: '',
      });
      expect(response.status).toBe(401);
    });

    it('a bearer token is checked as an agent token, and none exists yet: 401, even with the cookie', async () => {
      const response = await t.request('GET', '/api/v1/me', {
        as: owner,
        headers: { authorization: 'Bearer tk_local_guess' },
      });
      expect(response.status).toBe(401);
    });

    it('a server with another key file has another secret: the cookie of one does not work on the other', async () => {
      const other = await createTestServer(engine, { mode: 'local' });
      try {
        expect((await other.get('/api/v1/me', owner)).status).toBe(401);
        const theirs = await other.localSession();
        expect((await other.get('/api/v1/me', theirs)).status).toBe(200);
        expect((await t.get('/api/v1/me', theirs)).status).toBe(401);
      } finally {
        await other.stop();
      }
    }, 60_000);

    it('a second start on the same key file takes the cookie of the first; codes of the first are gone', async () => {
      const keys = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-keys-'));
      try {
        const first = await createTestServer(engine, {
          mode: 'local',
          runtime: { secretsDir: keys },
        });
        let cookie: Session;
        let unused: URL;
        try {
          cookie = await first.localSession();
          unused = new URL(first.runtime.newOneTimeUrl());
        } finally {
          await first.stop();
        }
        const second = await createTestServer(engine, {
          mode: 'local',
          runtime: { secretsDir: keys },
        });
        try {
          expect((await second.get('/api/v1/me', cookie)).status).toBe(200);
          expect((await second.get(`${unused.pathname}${unused.search}`)).status).toBe(401);
        } finally {
          await second.stop();
        }
      } finally {
        rmSync(keys, { recursive: true, force: true });
      }
    }, 60_000);
  });

  describe('the Host check (R33)', () => {
    it('answers at 127.0.0.1, at localhost and at names under .localhost, on its own port', async () => {
      for (const host of [
        '127.0.0.1:4400',
        'localhost:4400',
        'LOCALHOST:4400',
        'turnkeel.localhost:4400',
        'Turnkeel.LocalHost:4400',
        'my-app.turnkeel.localhost:4400',
        'xn--bcher-kva.localhost:4400',
      ]) {
        const response = await t.runtime.app.request(`http://${host}/healthz`, {
          headers: { host },
        });
        expect([host, response.status]).toEqual([host, 200]);
      }
    });

    it.each([
      'evil.example',
      'evil.example:4400',
      '127.0.0.1:9999',
      'localhost',
      '127.0.0.1.evil.example:4400',
      '192.168.1.20:4400',
      '[::1]:4400',
      'evil.com',
      'localhost.evil.com:4400',
      'turnkeel.localhost',
      'turnkeel.localhost:9999',
      'turnkeel.localhost:04400',
      'a_b.localhost:4400',
      '.localhost:4400',
      'a..localhost:4400',
      '-a.localhost:4400',
      'a-.localhost:4400',
      'turnkeel.localhost.:4400',
      'turnkeel.localhost.evil.com:4400',
      'evil.com.localhost.:4400',
      'user@turnkeel.localhost:4400',
      `${'a'.repeat(64)}.localhost:4400`,
    ])('rejects a request whose Host is %s, whatever it asks for', async (host) => {
      for (const path of [
        '/healthz',
        '/api/v1/me',
        '/api/v1/server',
        '/',
        '/api/v1/local/session',
      ]) {
        const response = await t.runtime.app.request(`http://127.0.0.1:4400${path}`, {
          headers: { host, cookie: owner.cookie },
        });
        expect([path, response.status]).toEqual([path, 403]);
        expect(await errorOf(response)).toMatchObject({ code: 'forbidden', rule: 'R33' });
      }
    });

    it('rejects a request whose address names another host, even when the Host header is missing', async () => {
      const response = await t.runtime.app.request('http://evil.example:4400/api/v1/me', {
        headers: { cookie: owner.cookie },
      });
      expect(response.status).toBe(403);
    });
  });

  describe('writes from a browser', () => {
    const project = { name: 'From elsewhere', key: 'ELSE', slug: 'elsewhere' };

    it('refuses a write that comes from another site, even with the cookie', async () => {
      const fromElsewhere: Record<string, string>[] = [
        { origin: 'https://evil.example' },
        { origin: 'http://127.0.0.1:9999' },
        { origin: 'http://evil.com' },
        { origin: 'http://localhost.evil.com:4400' },
        { origin: 'http://turnkeel.localhost:9999' },
        { origin: 'http://turnkeel.localhost' },
        { origin: 'http://a_b.localhost:4400' },
        { origin: 'https://turnkeel.localhost:4400' },
        { origin: 'http://turnkeel.localhost:4400/' },
        { origin: 'null' },
        { 'sec-fetch-site': 'cross-site' },
      ];
      for (const headers of fromElsewhere) {
        const response = await t.request('POST', '/api/v1/workspaces/my-workspace/projects', {
          as: owner,
          json: project,
          headers,
        });
        expect(response.status).toBe(403);
        expect((await errorOf(response)).code).toBe('forbidden');
      }
      expect(
        (await t.get('/api/v1/workspaces/my-workspace/projects/elsewhere', owner)).status,
      ).toBe(404);
    });

    it('takes a write from its own pages', async () => {
      const response = await t.request('POST', '/api/v1/workspaces/my-workspace/projects', {
        as: owner,
        json: project,
        headers: { origin: 'http://localhost:4400', 'sec-fetch-site': 'same-origin' },
      });
      expect(response.status).toBe(201);
    });

    it('takes a write from its own pages opened under a name of .localhost', async () => {
      for (const [key, origin] of [
        ['NAMA', 'http://turnkeel.localhost:4400'],
        ['NAMB', 'http://127.0.0.1:4400'],
        ['NAMC', 'HTTP://Turnkeel.Localhost:4400'],
      ] as const) {
        const response = await t.request('POST', '/api/v1/workspaces/my-workspace/projects', {
          as: owner,
          json: { name: `Named ${key}`, key, slug: key.toLowerCase() },
          headers: { host: 'turnkeel.localhost:4400', origin, 'sec-fetch-site': 'same-origin' },
        });
        expect([origin, response.status]).toEqual([origin, 201]);
      }
    });
  });

  describe('what the local owner can do', () => {
    it('says that it runs in local mode, with no sign-in method', async () => {
      // `mail` is left out: the test server has a mailer of its own.
      expect(await bodyOf<ServerInfo>(await t.get('/api/v1/server'))).toMatchObject({
        mode: 'local',
        signIn: { magicLink: false, github: false, google: false, passkey: false },
        openSignup: false,
      });
    });

    it('has no sign-in routes', async () => {
      const response = await t.request('POST', '/api/auth/sign-in/magic-link', {
        json: { email: 'someone@example.com' },
      });
      expect(response.status).toBe(404);
    });

    it('creates a project and sees its event on the stream, as via web', async () => {
      const stream = await openStream(t, 'my-workspace', owner);
      try {
        expect((await stream.next()).comment).toBe('connected');
        const created = await t.post(
          '/api/v1/workspaces/my-workspace/projects',
          { name: 'Local app', key: 'LOC', slug: 'local-app' },
          owner,
        );
        expect(created.status).toBe(201);
        const project = await bodyOf<Project>(created);
        const message = JSON.parse((await stream.nextMessage()).data ?? '') as StreamMessage;
        expect(message).toMatchObject({
          type: 'project.created',
          subject: { type: 'project', id: project.id },
        });
        expect((await eventsOf(t, 'my-workspace')).at(-1)).toMatchObject({
          type: 'project.created',
          via: 'web',
          actor: { kind: 'user', name: 'Owner' },
        });
      } finally {
        await stream.close();
      }
    });

    it('may always create a workspace, and is its Owner', async () => {
      const response = await t.post(
        '/api/v1/workspaces',
        { name: 'Second', slug: 'second', handle: 'owner' },
        owner,
      );
      expect(response.status).toBe(201);
      const list = await bodyOf<Workspace[]>(await t.get('/api/v1/workspaces', owner));
      expect(list.map((workspace) => workspace.slug)).toEqual(['my-workspace', 'second']);
    });

    it('changes their own handle', async () => {
      const me = await bodyOf<Me>(await t.get('/api/v1/me', owner));
      const response = await t.patch(
        `/api/v1/workspaces/second/members/${me.user.id}`,
        { handle: 'me' },
        owner,
      );
      expect(response.status).toBe(200);
    });

    it('cannot invite anyone, because nobody can sign in', async () => {
      const response = await t.post(
        '/api/v1/workspaces/my-workspace/invitations',
        { email: 'friend@example.com', role: 'member' },
        owner,
      );
      expect(response.status).toBe(409);
      expect((await errorOf(response)).message).toContain('local mode');
    });

    it('exports the event log with the local session', async () => {
      const response = await t.get('/api/v1/workspaces/my-workspace/events/export', owner);
      expect(response.status).toBe(200);
      expect((await response.text()).trimEnd().split('\n').length).toBe(
        (await eventsOf(t, 'my-workspace')).length,
      );
    });
  });
});

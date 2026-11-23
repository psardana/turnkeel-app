import { countUsers, findUserByEmail, schema } from '@turnkeel/db';
import { testEngines } from '@turnkeel/db/testing';
import type { Me, ServerInfo } from '@turnkeel/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bodyOf,
  createTestServer,
  errorOf,
  linkIn,
  tokenIn,
  type TestServer,
} from '../testing/harness.js';
import { createSignUpGate } from './auth.js';

describe.each(testEngines)('sign-in on %s', (engine) => {
  let t: TestServer;

  beforeAll(async () => {
    t = await createTestServer(engine);
  }, 60_000);
  afterAll(async () => {
    await t.stop();
  }, 60_000);

  it('GET /server says which sign-in methods are offered, without a session', async () => {
    const response = await t.get('/api/v1/server');
    expect(response.status).toBe(200);
    expect(await bodyOf<ServerInfo>(response)).toEqual({
      mode: 'server',
      signIn: { magicLink: true, github: false, google: false, passkey: true },
      mail: 'smtp',
      openSignup: false,
    });
  });

  it('the first sign-in on an install with no accounts makes an account, with a UUID as its id', async () => {
    expect(await countUsers(t.test.db)).toBe(0);
    const owner = await t.signIn('First@Example.com', 'Fay First');
    const user = await findUserByEmail(t.test.db, 'first@example.com');
    expect(user).toMatchObject({
      email: 'first@example.com',
      name: 'Fay First',
      emailVerified: true,
    });
    expect(user?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const me = await bodyOf<Me>(await t.get('/api/v1/me', owner));
    expect(me).toMatchObject({ local: false, workspaces: [], canCreateWorkspace: true });
    expect(me.user.id).toBe(user?.id);
  });

  it('the sign-in mail is plain text with one link, which works once', async () => {
    const asked = await t.askForLink('first@example.com');
    expect(asked.response.status).toBe(200);
    expect(asked.mail?.subject).toBe('Your sign-in link for Turnkeel');
    expect(asked.mail?.text).toContain('The link works once, for 10 minutes.');
    const link = new URL(linkIn(asked.mail!));
    expect(link.origin).toBe('http://localhost:4400');
    expect(link.pathname).toBe('/api/auth/magic-link/verify');

    const first = await t.get(`${link.pathname}${link.search}`);
    expect(first.status).toBe(302);
    expect(first.headers.getSetCookie().join(';')).toContain('turnkeel.session_token=');
    const second = await t.get(`${link.pathname}${link.search}`);
    expect(second.status).toBe(302);
    expect(second.headers.get('location')).toContain('error=INVALID_TOKEN');
    expect(second.headers.getSetCookie().join(';')).not.toContain('session_token=');
  });

  it('the session cookie is HTTP-only, and only the hash of a sign-in token is stored', async () => {
    const asked = await t.askForLink('first@example.com');
    const token = tokenIn(asked.mail!);
    const stored = await t.test.db.select().from(schema.verification);
    expect(stored.length).toBeGreaterThan(0);
    expect(JSON.stringify(stored)).not.toContain(token);

    const link = new URL(linkIn(asked.mail!));
    const opened = await t.get(`${link.pathname}${link.search}`);
    const cookie = opened.headers.getSetCookie().find((line) => line.includes('session_token'));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('the first person creates the first workspace and is its Owner', async () => {
    const owner = await t.signIn('first@example.com');
    const created = await t.post(
      '/api/v1/workspaces',
      { name: 'First Co', slug: 'first-co', handle: 'fay' },
      owner,
    );
    expect(created.status).toBe(201);
    const me = await bodyOf<Me>(await t.get('/api/v1/me', owner));
    expect(me.workspaces.map((entry) => [entry.workspace.slug, entry.role, entry.handle])).toEqual([
      ['first-co', 'owner', 'fay'],
    ]);
    // An Owner on the server may create further workspaces.
    expect(me.canCreateWorkspace).toBe(true);
  });

  it('after that, a link asked for an unknown address gets the same answer and nothing is sent', async () => {
    const known = await t.askForLink('first@example.com');
    const unknown = await t.askForLink('nobody@example.com');
    expect(unknown.response.status).toBe(known.response.status);
    expect(await unknown.response.json()).toEqual(await known.response.json());
    expect(known.mail).toBeDefined();
    expect(unknown.mail).toBeUndefined();
    expect(await countUsers(t.test.db)).toBe(1);
  });

  it('an open invitation to the address lets the sign-in create the account', async () => {
    const owner = await t.signIn('first@example.com');
    const invited = await t.post(
      '/api/v1/workspaces/first-co/invitations',
      { email: 'guest@example.com', role: 'viewer' },
      owner,
    );
    expect(invited.status).toBe(201);
    const guest = await t.signIn('guest@example.com', 'Gil Guest');
    expect(await countUsers(t.test.db)).toBe(2);
    // An account, and nothing else until the invitation is accepted.
    const me = await bodyOf<Me>(await t.get('/api/v1/me', guest));
    expect(me).toMatchObject({ workspaces: [], canCreateWorkspace: false });
    const create = await t.post(
      '/api/v1/workspaces',
      { name: 'Guest Co', slug: 'guest-co', handle: 'gil' },
      guest,
    );
    expect(create.status).toBe(403);
    expect(await errorOf(create)).toMatchObject({ rule: 'R44' });
  });

  it('a revoked invitation no longer lets a sign-in create an account', async () => {
    const owner = await t.signIn('first@example.com');
    const invited = await t.post(
      '/api/v1/workspaces/first-co/invitations',
      { email: 'unlucky@example.com', role: 'viewer' },
      owner,
    );
    const { invitation } = await bodyOf<{ invitation: { id: string } }>(invited);
    expect((await t.delete(`/api/v1/invitations/${invitation.id}`, owner)).status).toBe(200);
    const asked = await t.askForLink('unlucky@example.com');
    expect(asked.response.status).toBe(200);
    expect(asked.mail).toBeUndefined();
  });

  it('a link that was sent while an invitation was open creates no account once it is revoked', async () => {
    const owner = await t.signIn('first@example.com');
    const invited = await t.post(
      '/api/v1/workspaces/first-co/invitations',
      { email: 'race@example.com', role: 'viewer' },
      owner,
    );
    const { invitation } = await bodyOf<{ invitation: { id: string } }>(invited);
    const asked = await t.askForLink('race@example.com');
    expect(asked.mail).toBeDefined();
    expect((await t.delete(`/api/v1/invitations/${invitation.id}`, owner)).status).toBe(200);

    const before = await countUsers(t.test.db);
    const link = new URL(linkIn(asked.mail!));
    const opened = await t.get(`${link.pathname}${link.search}`);
    expect(opened.status).toBe(302);
    const location = new URL(opened.headers.get('location') ?? '', 'http://localhost:4400');
    expect(location.searchParams.get('error')).toBe('signup_by_invitation');
    expect(location.searchParams.get('error_description')).toBe(
      'This server takes new accounts by invitation only.',
    );
    expect(opened.headers.getSetCookie().join(';')).not.toContain('session_token=');
    expect(await countUsers(t.test.db)).toBe(before);
  });

  it('a provider sign-in creates an account only for an address it has proven', async () => {
    const owner = await t.signIn('first@example.com');
    await t.post(
      '/api/v1/workspaces/first-co/invitations',
      { email: 'oauth@example.com', role: 'viewer' },
      owner,
    );
    const gate = createSignUpGate(t.test.db, false);
    expect(await gate({ email: 'oauth@example.com', proven: true })).toBe(true);
    expect(await gate({ email: 'OAuth@Example.com', proven: true })).toBe(true);
    // The provider did not say the address is verified: the invitation does not count.
    expect(await gate({ email: 'oauth@example.com', proven: false })).toBe(false);
    expect(await gate({ email: 'someone-else@example.com', proven: true })).toBe(false);
  });

  it('a passkey is added by a signed-in person, and cannot be the first way in', async () => {
    const options = '/api/auth/passkey/generate-register-options';
    // Without a session there is nobody to add a passkey to.
    expect((await t.get(options)).status).toBe(401);
    expect((await t.get('/api/auth/passkey/list-user-passkeys')).status).toBe(401);

    const session = await t.signIn('first@example.com');
    const registration = await t.get(options, session);
    expect(registration.status).toBe(200);
    const body = await bodyOf<{ rp: { id: string; name: string }; user: { name: string } }>(
      registration,
    );
    expect(body.rp).toEqual({ id: 'localhost', name: 'Turnkeel' });
    expect(body.user.name).toBe('first@example.com');
    const mine = await t.get('/api/auth/passkey/list-user-passkeys', session);
    expect(mine.status).toBe(200);
    expect(await mine.json()).toEqual([]);
  });

  it('has no local session: the one-time URL of local mode is the one 404 here', async () => {
    const response = await t.get('/api/v1/local/session?code=anything');
    expect(response.status).toBe(404);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('there is no way to sign in with a password', async () => {
    const response = await t.request('POST', '/api/auth/sign-up/email', {
      json: { email: 'pw@example.com', password: 'correct horse battery', name: 'Pw' },
      headers: { origin: 'http://localhost:4400' },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await findUserByEmail(t.test.db, 'pw@example.com')).toBeNull();
  });

  it('a session that was signed out is no longer a principal', async () => {
    const session = await t.signIn('first@example.com');
    expect((await t.get('/api/v1/me', session)).status).toBe(200);
    const out = await t.request('POST', '/api/auth/sign-out', {
      as: session,
      json: {},
      headers: { origin: 'http://localhost:4400' },
    });
    expect(out.status).toBe(200);
    expect((await t.get('/api/v1/me', session)).status).toBe(401);
  });

  it('a cookie that nobody issued is no principal', async () => {
    const response = await t.get('/api/v1/me', {
      cookie: 'turnkeel.session_token=made-up.signature',
      email: '',
    });
    expect(response.status).toBe(401);
  });
});

describe.each(testEngines)('open sign-up on %s (R44)', (engine) => {
  let t: TestServer;

  beforeAll(async () => {
    t = await createTestServer(engine, { env: { TURNKEEL_OPEN_SIGNUP: 'true' } });
  }, 60_000);
  afterAll(async () => {
    await t.stop();
  }, 60_000);

  it('anyone who can reach the server creates an account and a workspace', async () => {
    const first = await t.signIn('one@example.com', 'One');
    await t.post('/api/v1/workspaces', { name: 'One', slug: 'one', handle: 'one' }, first);

    const second = await t.signIn('two@example.com', 'Two');
    const me = await bodyOf<Me>(await t.get('/api/v1/me', second));
    expect(me).toMatchObject({ workspaces: [], canCreateWorkspace: true });
    const created = await t.post(
      '/api/v1/workspaces',
      { name: 'Two', slug: 'two', handle: 'two' },
      second,
    );
    expect(created.status).toBe(201);
    // Each sees their own workspace only.
    expect((await t.get('/api/v1/workspaces/one', second)).status).toBe(404);
    expect((await bodyOf<ServerInfo>(await t.get('/api/v1/server'))).openSignup).toBe(true);
  });
});

describe('sign-in methods that need configuration', () => {
  it('offers GitHub and Google only when their client id and secret are set', async () => {
    const t = await createTestServer('pglite', {
      env: { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' },
    });
    try {
      const info = await bodyOf<ServerInfo>(await t.get('/api/v1/server'));
      expect(info.signIn).toEqual({ magicLink: true, github: true, google: false, passkey: true });

      // GitHub answers with the address to send the browser to; Google is not there.
      const github = await t.request('POST', '/api/auth/sign-in/social', {
        json: { provider: 'github', callbackURL: '/' },
        headers: { origin: 'http://localhost:4400' },
      });
      expect(github.status).toBe(200);
      const { url } = await bodyOf<{ url: string }>(github);
      expect(new URL(url).hostname).toBe('github.com');
      expect(new URL(url).searchParams.get('redirect_uri')).toBe(
        'http://localhost:4400/api/auth/callback/github',
      );
      const google = await t.request('POST', '/api/auth/sign-in/social', {
        json: { provider: 'google', callbackURL: '/' },
        headers: { origin: 'http://localhost:4400' },
      });
      expect(google.status).toBe(404);
    } finally {
      await t.stop();
    }
  }, 60_000);

  it('says that mail goes to the log when SMTP is not configured, and writes the link there', async () => {
    const t = await createTestServer('pglite', { runtime: { mailer: undefined } });
    try {
      // Without a mailer of the test's own, the runtime makes the configured one: the log.
      expect((await bodyOf<ServerInfo>(await t.get('/api/v1/server'))).mail).toBe('log');
      const response = await t.request('POST', '/api/auth/sign-in/magic-link', {
        json: { email: 'log@example.com', callbackURL: '/' },
        headers: { origin: 'http://localhost:4400' },
      });
      expect(response.status).toBe(200);
      const line = t.log.find((entry) => entry.includes('Mail is not configured'));
      expect(line).toContain('To: log@example.com.');
      expect(line).toMatch(/http:\/\/localhost:4400\/api\/auth\/magic-link\/verify\?token=\S+/);
    } finally {
      await t.stop();
    }
  }, 60_000);
});

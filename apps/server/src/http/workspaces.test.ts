import { testEngines } from '@turnkeel/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bodyOf,
  buildWorld,
  createTestServer,
  errorOf,
  eventsOf,
  type TestServer,
  type World,
} from '../testing/harness.js';
import { REQUEST_ID_HEADER } from './app.js';
import { REPLAYED_HEADER } from './idempotency.js';

const NOT_FOUND = { code: 'not_found', message: 'There is nothing at this address.' };

describe.each(testEngines)('workspaces on %s', (engine) => {
  let t: TestServer;
  let w: World;

  beforeAll(async () => {
    t = await createTestServer(engine);
    w = await buildWorld(t);
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  }, 60_000);

  describe('GET /me', () => {
    it('says who the caller is and what they hold', async () => {
      const response = await t.get('/api/v1/me', w.admin);
      expect(response.status).toBe(200);
      const me = await bodyOf<Me>(response);
      expect(me.user).toMatchObject({ email: 'adam@example.com', name: 'Adam Admin' });
      expect(me.local).toBe(false);
      expect(
        me.workspaces.map((entry) => [entry.workspace.slug, entry.role, entry.handle]),
      ).toEqual([['acme', 'admin', 'adam-admin']]);
      expect(me.canCreateWorkspace).toBe(false);
    });

    it('shows a person with only a project role their workspace, without a role or a handle', async () => {
      const me = await bodyOf<Me>(await t.get('/api/v1/me', w.tester));
      expect(me.workspaces).toHaveLength(1);
      expect(me.workspaces[0]).toMatchObject({
        role: null,
        handle: null,
        projectRoles: { [w.app.id]: 'tester' },
      });
    });

    it('answers 401 without a session, in the shape of every error', async () => {
      const response = await t.get('/api/v1/me');
      expect(response.status).toBe(401);
      expect((await errorOf(response)).code).toBe('unauthorized');
    });

    it('answers 401 to a bearer token, which no step has built yet, even next to a good cookie', async () => {
      const response = await t.request('GET', '/api/v1/me', {
        as: w.owner,
        headers: { authorization: 'Bearer tk_not_a_token' },
      });
      expect(response.status).toBe(401);
    });
  });

  describe('GET /workspaces and GET /workspaces/:ws', () => {
    it('lists the workspaces the caller is in, and no others', async () => {
      const mine = await bodyOf<Workspace[]>(await t.get('/api/v1/workspaces', w.owner));
      expect(mine.map((workspace) => workspace.slug)).toEqual(['acme', 'globex']);
      const theirs = await bodyOf<Workspace[]>(await t.get('/api/v1/workspaces', w.stranger));
      expect(theirs.map((workspace) => workspace.slug)).toEqual(['globex']);
    });

    it('reads a workspace, by its slug in any case', async () => {
      const response = await t.get('/api/v1/workspaces/ACME', w.viewer);
      expect(response.status).toBe(200);
      expect(await bodyOf<Workspace>(response)).toMatchObject({ slug: 'acme', name: 'Acme' });
    });

    it('a workspace the caller is not in answers exactly like one that does not exist', async () => {
      const outside = await t.get('/api/v1/workspaces/acme', w.stranger);
      const missing = await t.get('/api/v1/workspaces/no-such-workspace', w.stranger);
      expect(outside.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await outside.json()).toEqual({ error: NOT_FOUND });
      expect(await missing.json()).toEqual({ error: NOT_FOUND });
    });

    it('the same 404 for every way into a workspace the caller is not in', async () => {
      const attempts: [string, string, unknown?][] = [
        ['GET', '/api/v1/workspaces/acme/members'],
        ['GET', '/api/v1/workspaces/acme/invitations'],
        ['GET', '/api/v1/workspaces/acme/projects'],
        ['GET', '/api/v1/workspaces/acme/projects/app'],
        ['GET', '/api/v1/workspaces/acme/events'],
        ['GET', '/api/v1/workspaces/acme/events/export'],
        ['GET', '/api/v1/workspaces/acme/stream'],
        ['PATCH', '/api/v1/workspaces/acme', { name: 'Taken' }],
        ['DELETE', '/api/v1/workspaces/acme'],
        ['POST', '/api/v1/workspaces/acme/transfer', { userId: w.ids.stranger }],
        ['POST', '/api/v1/workspaces/acme/projects', { name: 'X', key: 'XX', slug: 'xx' }],
        ['POST', '/api/v1/workspaces/acme/projects/app/archive', {}],
        ['PATCH', '/api/v1/workspaces/acme/projects/app', { name: 'X' }],
        ['POST', '/api/v1/workspaces/acme/invitations', { email: 'x@example.com', role: 'viewer' }],
        ['PATCH', `/api/v1/workspaces/acme/members/${w.ids.member}`, { role: 'viewer' }],
        ['DELETE', `/api/v1/workspaces/acme/members/${w.ids.member}`],
        ['PUT', `/api/v1/workspaces/acme/projects/app/members/${w.ids.member}`, { role: 'viewer' }],
      ];
      for (const [method, path, json] of attempts) {
        const response = await t.request(method, path, { as: w.stranger, json });
        expect([method, path, response.status]).toEqual([method, path, 404]);
        expect(await response.json()).toEqual({ error: NOT_FOUND });
      }
    });
  });

  describe('POST /workspaces (R44)', () => {
    it('an Owner on the server creates a further workspace and is its Owner', async () => {
      const response = await t.post(
        '/api/v1/workspaces',
        { name: 'Initech', slug: 'initech', handle: 'boss', baseCurrency: 'EUR' },
        w.owner,
      );
      expect(response.status).toBe(201);
      const workspace = await bodyOf<Workspace>(response);
      expect(workspace).toMatchObject({ slug: 'initech', baseCurrency: 'EUR', demo: false });
      const me = await bodyOf<Me>(await t.get('/api/v1/me', w.owner));
      expect(me.workspaces.find((entry) => entry.workspace.slug === 'initech')).toMatchObject({
        role: 'owner',
        handle: 'boss',
      });
    });

    it('writes workspace.created and member.joined with the request id of the answer', async () => {
      const response = await t.post(
        '/api/v1/workspaces',
        { name: 'Hooli', slug: 'hooli', handle: 'olive' },
        w.owner,
      );
      expect(response.status).toBe(201);
      const requestId = response.headers.get(REQUEST_ID_HEADER);
      const events = await eventsOf(t, 'hooli');
      expect(events.map((event) => event.type)).toEqual(['workspace.created', 'member.joined']);
      for (const event of events) {
        expect(event.requestId).toBe(requestId);
        expect(event.actor).toEqual({ kind: 'user', id: w.ids.owner, name: 'Olive Owner' });
        expect(event.via).toBe('web');
        expect(event.tokenId).toBeNull();
      }
      expect(events[0]?.data).toEqual({
        name: 'Hooli',
        slug: 'hooli',
        baseCurrency: 'EUR',
        demo: false,
        // The tabs it starts with off, none without a kind, and the switches.
        tabsOff: [],
        planning: planningAtStart,
      });
    });

    it.each(['admin', 'member', 'viewer', 'tester'] as const)(
      'a %s who is Owner nowhere may not create a workspace',
      async (who) => {
        const response = await t.post(
          '/api/v1/workspaces',
          { name: 'Mine', slug: `mine-${who}`, handle: 'me' },
          w[who],
        );
        expect(response.status).toBe(403);
        expect(await errorOf(response)).toMatchObject({ code: 'forbidden', rule: 'R44' });
      },
    );

    it('refuses a slug that is taken with 409, without regard to case', async () => {
      const response = await t.post(
        '/api/v1/workspaces',
        { name: 'Acme again', slug: 'acme', handle: 'olive' },
        w.owner,
      );
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe('slug_taken');
    });

    it('answers 400 to a body that does not match its schema', async () => {
      const response = await t.post('/api/v1/workspaces', { name: 'No slug' }, w.owner);
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe('bad_request');
      const notJson = await t.request('POST', '/api/v1/workspaces', {
        as: w.owner,
        headers: { 'content-type': 'application/json' },
      });
      expect(notJson.status).toBe(400);
    });
  });

  describe('Idempotency-Key (R50)', () => {
    it('a repeat with the same key and body returns the first result and writes nothing', async () => {
      const body = { name: 'Pied Piper', slug: 'pied-piper', handle: 'olive' };
      const headers = { 'Idempotency-Key': 'create-pied-piper' };
      const first = await t.post('/api/v1/workspaces', body, w.owner, headers);
      expect(first.status).toBe(201);
      expect(first.headers.get(REPLAYED_HEADER)).toBeNull();
      const created = await bodyOf<Workspace>(first);

      const second = await t.post('/api/v1/workspaces', body, w.owner, headers);
      expect(second.status).toBe(201);
      expect(second.headers.get(REPLAYED_HEADER)).toBe('true');
      expect(await second.json()).toEqual(created);
      // Without the key the same body is refused, which shows the repeat did not run.
      expect((await t.post('/api/v1/workspaces', body, w.owner)).status).toBe(409);
      expect(await eventsOf(t, 'pied-piper')).toHaveLength(2);
    });

    it('the same key with a different request is refused with 409', async () => {
      const headers = { 'Idempotency-Key': 'create-pied-piper' };
      const response = await t.post(
        '/api/v1/workspaces',
        { name: 'Other', slug: 'other-one', handle: 'olive' },
        w.owner,
        headers,
      );
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe('idempotency_key_reused');
      expect((await t.get('/api/v1/workspaces/other-one', w.owner)).status).toBe(404);
    });

    it('a key belongs to one principal and one path', async () => {
      const headers = { 'Idempotency-Key': 'shared-key' };
      const project = { name: 'Keyed', key: 'KEY', slug: 'keyed' };
      const first = await t.post('/api/v1/workspaces/acme/projects', project, w.owner, headers);
      expect(first.status).toBe(201);
      // The same key from another person runs as a request of its own (and is refused: the slug is taken).
      const other = await t.post('/api/v1/workspaces/acme/projects', project, w.admin, headers);
      expect(other.status).toBe(409);
      expect((await errorOf(other)).code).toBe('slug_taken');
      // The same key on another path runs as a request of its own.
      const elsewhere = await t.post(
        '/api/v1/workspaces/globex/projects',
        project,
        w.owner,
        headers,
      );
      expect(elsewhere.status).toBe(201);
      expect(elsewhere.headers.get(REPLAYED_HEADER)).toBeNull();
    });

    it('a request that failed kept nothing, so the key can be used again', async () => {
      const headers = { 'Idempotency-Key': 'retry-after-failure' };
      const taken = await t.post(
        '/api/v1/workspaces/acme/projects',
        { name: 'App again', key: 'APP', slug: 'app-again' },
        w.owner,
        headers,
      );
      expect(taken.status).toBe(409);
      const again = await t.post(
        '/api/v1/workspaces/acme/projects',
        { name: 'App again', key: 'APP', slug: 'app-again' },
        w.owner,
        headers,
      );
      expect(again.status).toBe(409);
      expect((await errorOf(again)).code).toBe('key_taken');
    });

    it('a kept answer is not given to a person removed since, who gets the one 404', async () => {
      const admin = await t.join(w.owner, 'acme', 'ria@example.com', 'admin', {
        name: 'Ria Admin',
      });
      const adminId = (await bodyOf<Me>(await t.get('/api/v1/me', admin))).user.id;
      const headers = { 'Idempotency-Key': 'before-removal' };
      const project = { name: 'Kept', key: 'KPT', slug: 'kept-for-ria' };
      const first = await t.post('/api/v1/workspaces/acme/projects', project, admin, headers);
      expect(first.status).toBe(201);
      const again = await t.post('/api/v1/workspaces/acme/projects', project, admin, headers);
      expect(again.headers.get(REPLAYED_HEADER)).toBe('true');

      expect((await t.delete(`/api/v1/workspaces/acme/members/${adminId}`, w.owner)).status).toBe(
        204,
      );
      const replay = await t.post('/api/v1/workspaces/acme/projects', project, admin, headers);
      expect(replay.status).toBe(404);
      expect(replay.headers.get(REPLAYED_HEADER)).toBeNull();
      expect(await errorOf(replay)).toEqual({
        code: 'not_found',
        message: 'There is nothing at this address.',
      });
      // Not even a different body tells that the key was used.
      const other = await t.post(
        '/api/v1/workspaces/acme/projects',
        { ...project, name: 'Other' },
        admin,
        headers,
      );
      expect(other.status).toBe(404);
    });

    it('a kept answer is not given to a person who may no longer do the write', async () => {
      const admin = await t.join(w.owner, 'acme', 'abe@example.com', 'admin', {
        name: 'Abe Admin',
      });
      const adminId = (await bodyOf<Me>(await t.get('/api/v1/me', admin))).user.id;
      const headers = { 'Idempotency-Key': 'before-lowering' };
      const project = { name: 'Lowered', key: 'LOW', slug: 'kept-for-abe' };
      expect(
        (await t.post('/api/v1/workspaces/acme/projects', project, admin, headers)).status,
      ).toBe(201);
      expect(
        (await t.patch(`/api/v1/workspaces/acme/members/${adminId}`, { role: 'member' }, w.owner))
          .status,
      ).toBe(200);
      const replay = await t.post('/api/v1/workspaces/acme/projects', project, admin, headers);
      expect(replay.status).toBe(403);
      expect((await errorOf(replay)).code).toBe('forbidden');
      expect(replay.headers.get(REPLAYED_HEADER)).toBeNull();
    });

    it('answers 400 to a key that is empty or too long', async () => {
      const response = await t.post(
        '/api/v1/workspaces/acme/projects',
        { name: 'Long', key: 'LONG', slug: 'long' },
        w.owner,
        { 'Idempotency-Key': 'k'.repeat(201) },
      );
      expect(response.status).toBe(400);
    });
  });

  describe('PATCH /workspaces/:ws', () => {
    it('lets an Admin change the name and writes workspace.updated with before and after', async () => {
      const response = await t.patch(
        '/api/v1/workspaces/globex',
        { name: 'Globex Corp' },
        w.stranger,
      );
      expect(response.status).toBe(200);
      expect((await bodyOf<Workspace>(response)).name).toBe('Globex Corp');
      const last = (await eventsOf(t, 'globex')).at(-1);
      expect(last).toMatchObject({
        type: 'workspace.updated',
        data: { name: ['Globex', 'Globex Corp'] },
        requestId: response.headers.get(REQUEST_ID_HEADER),
      });
    });

    it('writes nothing when the patch changes nothing', async () => {
      const before = (await eventsOf(t, 'globex')).length;
      const response = await t.patch(
        '/api/v1/workspaces/globex',
        { name: 'Globex Corp' },
        w.stranger,
      );
      expect(response.status).toBe(200);
      expect((await eventsOf(t, 'globex')).length).toBe(before);
    });

    it.each(['member', 'reviewer', 'viewer'] as const)('refuses a %s with 403', async (who) => {
      const response = await t.patch('/api/v1/workspaces/acme', { name: 'Mine now' }, w[who]);
      expect(response.status).toBe(403);
      expect((await errorOf(response)).code).toBe('forbidden');
    });

    it('refuses a person with only a project role with 403 and R30', async () => {
      const response = await t.patch('/api/v1/workspaces/acme', { name: 'Mine now' }, w.tester);
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ rule: 'R30' });
    });

    it('refuses a slug another workspace has with 409', async () => {
      const response = await t.patch('/api/v1/workspaces/globex', { slug: 'acme' }, w.owner);
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe('slug_taken');
    });
  });

  describe('POST /workspaces/:ws/transfer (R8)', () => {
    it('only an Owner transfers the workspace', async () => {
      const response = await t.post(
        '/api/v1/workspaces/acme/transfer',
        { userId: w.ids.admin },
        w.admin,
      );
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ rule: 'R8' });
    });

    it('answers 404 for someone who is not a member, and refuses a transfer to oneself', async () => {
      const outsider = await t.post(
        '/api/v1/workspaces/acme/transfer',
        { userId: w.ids.stranger },
        w.owner,
      );
      expect(outsider.status).toBe(404);
      const self = await t.post(
        '/api/v1/workspaces/acme/transfer',
        { userId: w.ids.owner },
        w.owner,
      );
      expect(self.status).toBe(422);
    });

    it('makes the member named Owner and the Owner who transfers Admin, with three events', async () => {
      const response = await t.post(
        '/api/v1/workspaces/globex/transfer',
        { userId: w.ids.stranger },
        w.owner,
      );
      expect(response.status).toBe(200);
      const requestId = response.headers.get(REQUEST_ID_HEADER);
      const events = (await eventsOf(t, 'globex')).filter((event) => event.requestId === requestId);
      expect(events.map((event) => event.type)).toEqual([
        'workspace.transferred',
        'member.role_changed',
        'member.role_changed',
      ]);
      expect(events[0]?.data).toEqual({ from: w.ids.owner, to: w.ids.stranger });
      const strangerMe = await bodyOf<Me>(await t.get('/api/v1/me', w.stranger));
      expect(strangerMe.workspaces[0]?.role).toBe('owner');
      const ownerMe = await bodyOf<Me>(await t.get('/api/v1/me', w.owner));
      expect(ownerMe.workspaces.find((entry) => entry.workspace.slug === 'globex')?.role).toBe(
        'admin',
      );
    });
  });

  describe('DELETE /workspaces/:ws (R8, R26)', () => {
    it('an Admin cannot delete the workspace', async () => {
      const response = await t.delete('/api/v1/workspaces/acme', w.admin);
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ rule: 'R8' });
    });

    it('deleting sets deletedAt, appends workspace.deleted last, keeps the events, and stops all access', async () => {
      const before = await eventsOf(t, 'initech');
      const response = await t.delete('/api/v1/workspaces/initech', w.owner);
      expect(response.status).toBe(200);
      expect((await bodyOf<Workspace>(response)).deletedAt).not.toBeNull();

      const after = await eventsOf(t, 'initech');
      expect(after).toHaveLength(before.length + 1);
      expect(after.at(-1)).toMatchObject({
        type: 'workspace.deleted',
        requestId: response.headers.get(REQUEST_ID_HEADER),
      });

      const gone = await t.get('/api/v1/workspaces/initech', w.owner);
      expect(gone.status).toBe(404);
      expect(await gone.json()).toEqual({ error: NOT_FOUND });
      expect((await t.get('/api/v1/workspaces/initech/events', w.owner)).status).toBe(404);
      const mine = await bodyOf<Workspace[]>(await t.get('/api/v1/workspaces', w.owner));
      expect(mine.map((workspace) => workspace.slug)).not.toContain('initech');
    });

    it('does not give the slug of a deleted workspace out again', async () => {
      const response = await t.post(
        '/api/v1/workspaces',
        { name: 'Initech', slug: 'initech', handle: 'olive' },
        w.owner,
      );
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe('slug_taken');
    });
  });
});

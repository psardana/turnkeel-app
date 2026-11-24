import { countWorkspaces, schema } from '@turnkeel/db';
import { testEngines } from '@turnkeel/db/testing';
import type { Me, Project, Workspace } from '@turnkeel/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bodyOf,
  createTestServer,
  errorOf,
  eventsOf,
  linkIn,
  type TestServer,
} from '../testing/harness.js';
import { REPLAYED_HEADER } from './idempotency.js';

/**
 * Requests that arrive at the same moment. On Postgres they really run at once, each
 * on its own connection. PGlite runs one statement at a time, so there the same tests
 * only show that the answers are right in either order.
 */
describe.each(testEngines)('requests at the same moment on %s', (engine) => {
  describe('the first Owner (R44)', () => {
    let open: TestServer;
    let closed: TestServer;

    beforeAll(async () => {
      // Two accounts on an install with no workspace: made with open sign-up, then
      // served by a server without it, on the same database.
      open = await createTestServer(engine, { env: { TURNKEEL_OPEN_SIGNUP: 'true' } });
      closed = await createTestServer(engine, { sharing: open });
    }, 60_000);
    afterAll(async () => {
      await closed.stop();
      await open.stop();
    }, 60_000);

    it('two first workspaces at the same moment give one workspace and one Owner', async () => {
      const first = await open.signIn('one@example.com', 'One');
      const second = await open.signIn('two@example.com', 'Two');
      for (const session of [first, second]) {
        const me = await bodyOf<Me>(await closed.get('/api/v1/me', session));
        expect(me).toMatchObject({ workspaces: [], canCreateWorkspace: true });
      }

      const answers = await Promise.all([
        closed.post('/api/v1/workspaces', { name: 'One', slug: 'one', handle: 'one' }, first),
        closed.post('/api/v1/workspaces', { name: 'Two', slug: 'two', handle: 'two' }, second),
      ]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([201, 403]);
      const refused = answers.find((answer) => answer.status === 403);
      expect(await errorOf(refused!)).toMatchObject({ code: 'forbidden', rule: 'R44' });
      expect(await countWorkspaces(closed.test.db, { includeDeleted: true })).toBe(1);
      const owners = await closed.test.db.select().from(schema.members);
      expect(owners.map((member) => member.role)).toEqual(['owner']);

      // The one who was refused holds nothing and may not try again.
      const states = await Promise.all(
        [first, second].map(async (session) => bodyOf<Me>(await closed.get('/api/v1/me', session))),
      );
      expect(states.map((me) => me.workspaces.length).sort()).toEqual([0, 1]);
      expect(states.find((me) => me.workspaces.length === 0)?.canCreateWorkspace).toBe(false);
    });
  });

  describe('two first sign-ins (R44)', () => {
    it('of two links sent on an empty install, the second to be opened makes no account', async () => {
      const t = await createTestServer(engine);
      try {
        const one = await t.askForLink('one@example.com', 'One');
        const two = await t.askForLink('two@example.com', 'Two');
        expect(one.mail).toBeDefined();
        expect(two.mail).toBeDefined();
        const open = async (link: string) => {
          const url = new URL(link);
          return t.get(`${url.pathname}${url.search}`);
        };
        const first = await open(linkIn(one.mail!));
        expect(first.headers.getSetCookie().join(';')).toContain('session_token=');
        const second = await open(linkIn(two.mail!));
        expect(second.headers.get('location')).toContain('error=signup_by_invitation');
        expect(second.headers.getSetCookie().join(';')).not.toContain('session_token=');
        expect(await t.test.db.select().from(schema.user)).toHaveLength(1);
      } finally {
        await t.stop();
      }
    }, 60_000);
  });

  describe('in one workspace', () => {
    let t: TestServer;
    let owner: Awaited<ReturnType<TestServer['signIn']>>;
    let second: Awaited<ReturnType<TestServer['signIn']>>;
    let ids: { owner: string; second: string };

    beforeAll(async () => {
      t = await createTestServer(engine);
      owner = await t.signIn('olive@example.com', 'Olive Owner');
      await t.post('/api/v1/workspaces', { name: 'Acme', slug: 'acme', handle: 'olive' }, owner);
      second = await t.join(owner, 'acme', 'otto@example.com', 'owner', { name: 'Otto Owner' });
      ids = {
        owner: (await bodyOf<Me>(await t.get('/api/v1/me', owner))).user.id,
        second: (await bodyOf<Me>(await t.get('/api/v1/me', second))).user.id,
      };
    }, 60_000);
    afterAll(async () => {
      await t.stop();
    }, 60_000);

    it('the same key twice at once writes once, and both get the same answer', async () => {
      const body = { name: 'Once', key: 'ONCE', slug: 'once' };
      const headers = { 'Idempotency-Key': 'at-the-same-moment' };
      const answers = await Promise.all(
        Array.from({ length: 6 }, () =>
          t.post('/api/v1/workspaces/acme/projects', body, owner, headers),
        ),
      );
      expect(answers.map((answer) => answer.status)).toEqual([201, 201, 201, 201, 201, 201]);
      const projects = await Promise.all(answers.map((answer) => bodyOf<Project>(answer)));
      expect(new Set(projects.map((project) => project.id)).size).toBe(1);
      expect(
        answers.filter((answer) => answer.headers.get(REPLAYED_HEADER) === 'true'),
      ).toHaveLength(5);
      const created = (await eventsOf(t, 'acme')).filter(
        (event) => event.type === 'project.created',
      );
      expect(created).toHaveLength(1);
    });

    it('two projects with the same slug at once: one is made, the other is refused with 409', async () => {
      const answers = await Promise.all([
        t.post('/api/v1/workspaces/acme/projects', { name: 'A', key: 'AAA', slug: 'same' }, owner),
        t.post('/api/v1/workspaces/acme/projects', { name: 'B', key: 'BBB', slug: 'same' }, second),
      ]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
    });

    it('two Owners who lower each other at the same moment leave one Owner', async () => {
      const answers = await Promise.all([
        t.patch(`/api/v1/workspaces/acme/members/${ids.second}`, { role: 'admin' }, owner),
        t.patch(`/api/v1/workspaces/acme/members/${ids.owner}`, { role: 'admin' }, second),
      ]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 403]);
      const refused = answers.find((answer) => answer.status === 403);
      expect((await errorOf(refused!)).rule).toMatch(/^R(9|31)$/);
      const members = await t.test.db.select().from(schema.members);
      expect(members.filter((member) => member.role === 'owner')).toHaveLength(1);
    });

    it('events of requests at the same moment get seq without a gap, in the order they committed', async () => {
      const before = (await eventsOf(t, 'acme')).length;
      const remaining = (await bodyOf<Me>(await t.get('/api/v1/me', owner))).workspaces[0]?.role;
      const admin = remaining === 'owner' ? owner : second;
      const answers = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          t.post(
            '/api/v1/workspaces/acme/projects',
            { name: `P${index}`, key: `P${String.fromCharCode(65 + index)}`, slug: `p-${index}` },
            admin,
          ),
        ),
      );
      expect(answers.every((answer) => answer.status === 201)).toBe(true);
      const events = await eventsOf(t, 'acme');
      expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
      expect(events.length).toBe(before + 12);
      const workspace = await bodyOf<Workspace>(await t.get('/api/v1/workspaces/acme', admin));
      expect(workspace.slug).toBe('acme');
    });
  });
});

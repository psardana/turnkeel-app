import { testEngines } from '@turnkeel/db/testing';
import type { Me, Member, ProjectMember, WorkspacePerson } from '@turnkeel/protocol';
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

describe.each(testEngines)('members on %s', (engine) => {
  let t: TestServer;
  let w: World;

  beforeAll(async () => {
    t = await createTestServer(engine);
    w = await buildWorld(t);
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  }, 60_000);

  const member = (userId: string) => `/api/v1/workspaces/acme/members/${userId}`;
  const projectMember = (userId: string, project = 'app') =>
    `/api/v1/workspaces/acme/projects/${project}/members/${userId}`;
  const lastEvents = async (response: Response) =>
    (await eventsOf(t, 'acme')).filter(
      (event) => event.requestId === response.headers.get(REQUEST_ID_HEADER),
    );

  describe('GET /workspaces/:ws/members', () => {
    it('shows an Admin everyone with their email, role, handle and project roles', async () => {
      const response = await t.get('/api/v1/workspaces/acme/members', w.admin);
      expect(response.status).toBe(200);
      const people = await bodyOf<WorkspacePerson[]>(response);
      const rows = people.map((person) => [
        person.user.email,
        person.member?.role ?? null,
        person.member?.handle ?? null,
        person.projectMembers.map((entry) => entry.role),
      ]);
      expect(rows).toEqual(
        expect.arrayContaining([
          ['olive@example.com', 'owner', 'olive', []],
          ['adam@example.com', 'admin', 'adam-admin', []],
          ['mia@example.com', 'member', 'mia-member', []],
          ['tess@example.com', null, null, ['tester']],
        ]),
      );
      expect(people).toHaveLength(6);
    });

    it.each(['member', 'reviewer', 'viewer', 'tester'] as const)(
      'refuses a %s, who has no member.read, with 403',
      async (who) => {
        const response = await t.get('/api/v1/workspaces/acme/members', w[who]);
        expect(response.status).toBe(403);
        expect((await errorOf(response)).code).toBe('forbidden');
      },
    );
  });

  describe('PATCH /workspaces/:ws/members/:userId', () => {
    it('lets an Admin change a role and writes member.role_changed', async () => {
      const response = await t.patch(member(w.ids.viewer), { role: 'reviewer' }, w.admin);
      expect(response.status).toBe(200);
      expect((await bodyOf<Member>(response)).role).toBe('reviewer');
      const events = await lastEvents(response);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'member.role_changed',
        subject: { type: 'member' },
        data: { userId: w.ids.viewer, role: ['viewer', 'reviewer'] },
      });
      // Back, for the tests that follow.
      expect((await t.patch(member(w.ids.viewer), { role: 'viewer' }, w.admin)).status).toBe(200);
    });

    it('a Member cannot change a role', async () => {
      const response = await t.patch(member(w.ids.viewer), { role: 'admin' }, w.member);
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ rule: 'R7' });
    });

    it('an Admin cannot give the Owner role, and cannot change an Owner', async () => {
      const give = await t.patch(member(w.ids.member), { role: 'owner' }, w.admin);
      expect(give.status).toBe(403);
      expect(await errorOf(give)).toMatchObject({ rule: 'R31' });
      const lower = await t.patch(member(w.ids.owner), { role: 'viewer' }, w.admin);
      expect(lower.status).toBe(403);
      expect(await errorOf(lower)).toMatchObject({ rule: 'R31' });
    });

    it('the last Owner cannot be lowered', async () => {
      const response = await t.patch(member(w.ids.owner), { role: 'admin' }, w.owner);
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ rule: 'R9' });
    });

    it('Tester is refused as a workspace role, by the schema', async () => {
      const response = await t.patch(member(w.ids.member), { role: 'tester' }, w.owner);
      expect(response.status).toBe(400);
    });

    it('answers 404 for a person who is not a member, and for an id that is not one', async () => {
      expect((await t.patch(member(w.ids.stranger), { role: 'viewer' }, w.owner)).status).toBe(404);
      expect((await t.patch(member('not-an-id'), { role: 'viewer' }, w.owner)).status).toBe(404);
    });

    it('lets a person change their own handle, without member.manage, and writes member.handle_changed', async () => {
      const response = await t.patch(member(w.ids.viewer), { handle: 'vic' }, w.viewer);
      expect(response.status).toBe(200);
      expect((await bodyOf<Member>(response)).handle).toBe('vic');
      const events = await lastEvents(response);
      expect(events.map((event) => [event.type, event.data])).toEqual([
        ['member.handle_changed', { userId: w.ids.viewer, handle: ['vic-viewer', 'vic'] }],
      ]);
    });

    it('refuses a change of someone else’s handle, also from an Owner', async () => {
      const response = await t.patch(member(w.ids.viewer), { handle: 'renamed' }, w.owner);
      expect(response.status).toBe(403);
    });

    it('refuses a handle someone else has with 409, without regard to case', async () => {
      const response = await t.patch(member(w.ids.member), { handle: 'olive' }, w.member);
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe('handle_taken');
    });
  });

  describe('project members', () => {
    it('gives a person who is in the workspace a role in one project (R2) and writes member.joined', async () => {
      const response = await t.put(projectMember(w.ids.viewer), { role: 'member' }, w.admin);
      expect(response.status).toBe(200);
      expect(await bodyOf<ProjectMember>(response)).toMatchObject({
        projectId: w.app.id,
        userId: w.ids.viewer,
        role: 'member',
      });
      const events = await lastEvents(response);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'member.joined',
        projectId: w.app.id,
        subject: { type: 'project_member' },
        data: { userId: w.ids.viewer, role: 'member', projectId: w.app.id },
      });
      const me = await bodyOf<Me>(await t.get('/api/v1/me', w.viewer));
      expect(me.workspaces[0]?.projectRoles).toEqual({ [w.app.id]: 'member' });
    });

    it('changes the role with member.role_changed, and writes nothing when it is the same', async () => {
      const changed = await t.put(projectMember(w.ids.viewer), { role: 'reviewer' }, w.admin);
      expect((await lastEvents(changed)).map((event) => [event.type, event.data.role])).toEqual([
        ['member.role_changed', ['member', 'reviewer']],
      ]);
      const same = await t.put(projectMember(w.ids.viewer), { role: 'reviewer' }, w.admin);
      expect(same.status).toBe(200);
      expect(await lastEvents(same)).toHaveLength(0);
    });

    it('reads one project member under member.read', async () => {
      const response = await t.get(projectMember(w.ids.viewer), w.admin);
      expect(response.status).toBe(200);
      expect((await bodyOf<ProjectMember>(response)).role).toBe('reviewer');
      expect((await t.get(projectMember(w.ids.viewer), w.member)).status).toBe(403);
      expect((await t.get(projectMember(w.ids.member), w.admin)).status).toBe(404);
    });

    it('Owner and Admin are not project roles', async () => {
      const response = await t.put(projectMember(w.ids.viewer), { role: 'admin' }, w.owner);
      expect(response.status).toBe(400);
    });

    it('refuses a Member, and answers 404 for a person who is not in the workspace', async () => {
      const denied = await t.put(projectMember(w.ids.viewer), { role: 'viewer' }, w.member);
      expect(denied.status).toBe(403);
      const outsider = await t.put(projectMember(w.ids.stranger), { role: 'viewer' }, w.owner);
      expect(outsider.status).toBe(404);
    });

    it('takes a project role away and writes member.removed with the project', async () => {
      const response = await t.delete(projectMember(w.ids.viewer), w.admin);
      expect(response.status).toBe(204);
      const events = await lastEvents(response);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'member.removed',
        projectId: w.app.id,
        data: { userId: w.ids.viewer, role: 'reviewer', projectId: w.app.id },
      });
      expect((await t.delete(projectMember(w.ids.viewer), w.admin)).status).toBe(404);
    });

    it('only an Owner gives or takes away the project role of an Owner', async () => {
      const set = await t.put(projectMember(w.ids.owner, 'web'), { role: 'viewer' }, w.admin);
      expect(set.status).toBe(403);
      expect(await errorOf(set)).toMatchObject({ code: 'forbidden', rule: 'R31' });
      expect(await lastEvents(set)).toEqual([]);

      // A second Owner gives the first one a project role, and the Admin cannot take it away.
      const second = await t.join(w.owner, 'acme', 'otto@example.com', 'owner', {
        name: 'Otto Owner',
      });
      const given = await t.put(projectMember(w.ids.owner, 'web'), { role: 'viewer' }, second);
      expect(given.status).toBe(200);
      const removed = await t.delete(projectMember(w.ids.owner, 'web'), w.admin);
      expect(removed.status).toBe(403);
      expect(await errorOf(removed)).toMatchObject({ rule: 'R31' });
      expect((await t.delete(projectMember(w.ids.owner, 'web'), second)).status).toBe(204);

      // The tests of R9 below need one Owner again.
      const secondId = (await bodyOf<Me>(await t.get('/api/v1/me', second))).user.id;
      expect((await t.delete(member(secondId), w.owner)).status).toBe(204);
    });

    it('nobody gives or takes away their own project role, not even an Owner', async () => {
      const set = await t.put(projectMember(w.ids.admin, 'web'), { role: 'member' }, w.admin);
      expect(set.status).toBe(403);
      expect((await errorOf(set)).code).toBe('forbidden');
      const own = await t.put(projectMember(w.ids.owner, 'web'), { role: 'member' }, w.owner);
      expect(own.status).toBe(403);

      expect(
        (await t.put(projectMember(w.ids.admin, 'web'), { role: 'member' }, w.owner)).status,
      ).toBe(200);
      const take = await t.delete(projectMember(w.ids.admin, 'web'), w.admin);
      expect(take.status).toBe(403);
      expect(await lastEvents(take)).toEqual([]);
      expect((await t.delete(projectMember(w.ids.admin, 'web'), w.owner)).status).toBe(204);
    });
  });

  describe('DELETE /workspaces/:ws/members/:userId', () => {
    it('a Member cannot remove anyone', async () => {
      const response = await t.delete(member(w.ids.viewer), w.member);
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ rule: 'R7' });
    });

    it('an Admin cannot remove an Owner', async () => {
      const response = await t.delete(member(w.ids.owner), w.admin);
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ rule: 'R31' });
    });

    it('the last Owner cannot be removed', async () => {
      const response = await t.delete(member(w.ids.owner), w.owner);
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ rule: 'R9' });
    });

    it('removes everything the person holds in the workspace, with an event for each, and ends their access', async () => {
      // The reviewer also gets a role in the project `web`.
      expect(
        (await t.put(projectMember(w.ids.reviewer, 'web'), { role: 'viewer' }, w.owner)).status,
      ).toBe(200);
      expect((await t.get('/api/v1/workspaces/acme', w.reviewer)).status).toBe(200);

      const response = await t.delete(member(w.ids.reviewer), w.admin);
      expect(response.status).toBe(204);
      const events = await lastEvents(response);
      expect(events.map((event) => [event.type, event.subject.type, event.projectId])).toEqual([
        ['member.removed', 'member', null],
        ['member.removed', 'project_member', w.web.id],
      ]);
      expect((await t.get('/api/v1/workspaces/acme', w.reviewer)).status).toBe(404);
      expect((await t.delete(member(w.ids.reviewer), w.admin)).status).toBe(404);
    });

    it('removes a person who holds only a project role', async () => {
      const response = await t.delete(member(w.ids.tester), w.admin);
      expect(response.status).toBe(204);
      expect((await t.get('/api/v1/workspaces/acme', w.tester)).status).toBe(404);
    });
  });
});

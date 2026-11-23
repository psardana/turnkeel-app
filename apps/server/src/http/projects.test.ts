import { testEngines } from '@turnkeel/db/testing';
import type { Project } from '@turnkeel/protocol';
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

const NOT_FOUND = { code: 'not_found', message: 'There is nothing at this address.' };

describe.each(testEngines)('projects on %s', (engine) => {
  let t: TestServer;
  let w: World;

  beforeAll(async () => {
    t = await createTestServer(engine);
    w = await buildWorld(t);
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  }, 60_000);

  const projects = '/api/v1/workspaces/acme/projects';

  describe('GET /workspaces/:ws/projects and GET .../projects/:p', () => {
    it('shows a person with a workspace role every project', async () => {
      const list = await bodyOf<Project[]>(await t.get(projects, w.viewer));
      expect(list.map((project) => project.slug)).toEqual(['app', 'web']);
    });

    it('shows a person with only a project role that project and no other', async () => {
      const list = await bodyOf<Project[]>(await t.get(projects, w.tester));
      expect(list.map((project) => project.slug)).toEqual(['app']);
    });

    it('reads a project by its slug or by its key, in any case', async () => {
      for (const address of ['app', 'APP', 'App']) {
        const response = await t.get(`${projects}/${address}`, w.member);
        expect(response.status).toBe(200);
        expect((await bodyOf<Project>(response)).id).toBe(w.app.id);
      }
    });

    it('a project the caller has no role in answers exactly like one that does not exist', async () => {
      const outside = await t.get(`${projects}/web`, w.tester);
      const missing = await t.get(`${projects}/nothing`, w.tester);
      expect(outside.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await outside.json()).toEqual({ error: NOT_FOUND });
      expect(await missing.json()).toEqual({ error: NOT_FOUND });
      const patch = await t.patch(`${projects}/web`, { name: 'Mine' }, w.tester);
      expect(patch.status).toBe(404);
      expect(await patch.json()).toEqual({ error: NOT_FOUND });
    });
  });

  describe('POST /workspaces/:ws/projects', () => {
    it('lets an Admin create a project, stores the key in upper case, and writes project.created', async () => {
      const response = await t.post(
        projects,
        { name: 'Docs site', key: 'docs', slug: 'docs', kind: 'web', locales: ['en', 'pt-BR'] },
        w.admin,
      );
      expect(response.status).toBe(201);
      const project = await bodyOf<Project>(response);
      expect(project).toMatchObject({
        name: 'Docs site',
        key: 'DOCS',
        slug: 'docs',
        kind: 'web',
        locales: ['en', 'pt-BR'],
        launchDate: null,
        changelogPublic: false,
        archivedAt: null,
        createdBy: { kind: 'user', id: w.ids.admin },
      });
      const events = (await eventsOf(t, 'acme')).filter(
        (event) => event.requestId === response.headers.get(REQUEST_ID_HEADER),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'project.created',
        projectId: project.id,
        subject: { type: 'project', id: project.id },
        actor: { kind: 'user', id: w.ids.admin, name: 'Adam Admin' },
        via: 'web',
        data: { name: 'Docs site', key: 'DOCS', slug: 'docs', kind: 'web' },
      });
    });

    it.each(['member', 'reviewer', 'viewer', 'tester'] as const)(
      'refuses a %s with 403 and writes nothing',
      async (who) => {
        const before = (await eventsOf(t, 'acme')).length;
        const response = await t.post(projects, { name: 'No', key: 'NO', slug: 'no' }, w[who]);
        expect(response.status).toBe(403);
        expect((await errorOf(response)).code).toBe('forbidden');
        expect((await eventsOf(t, 'acme')).length).toBe(before);
      },
    );

    it('refuses a slug or a key that is taken with 409, also when a slug equals another project’s key', async () => {
      const slug = await t.post(projects, { name: 'A', key: 'AAA', slug: 'APP' }, w.owner);
      expect(slug.status).toBe(400); // A slug is lower case.
      const sameSlug = await t.post(projects, { name: 'A', key: 'AAA', slug: 'app' }, w.owner);
      expect(sameSlug.status).toBe(409);
      expect((await errorOf(sameSlug)).code).toBe('slug_taken');
      const sameKey = await t.post(projects, { name: 'A', key: 'app', slug: 'aaa' }, w.owner);
      expect(sameKey.status).toBe(409);
      expect((await errorOf(sameKey)).code).toBe('key_taken');
      const slugIsKey = await t.post(projects, { name: 'A', key: 'AAA', slug: 'web' }, w.owner);
      expect(slugIsKey.status).toBe(409);
      const keyIsSlug = await t.post(projects, { name: 'A', key: 'docs', slug: 'aaa' }, w.owner);
      expect(keyIsSlug.status).toBe(409);
    });

    it('answers 400 to a key that is not 2 to 6 letters', async () => {
      const response = await t.post(
        projects,
        { name: 'Bad', key: 'TOOLONGKEY', slug: 'bad' },
        w.owner,
      );
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe('bad_request');
    });
  });

  describe('PATCH /workspaces/:ws/projects/:p', () => {
    it('lets an Owner change a project and writes project.updated with before and after', async () => {
      const response = await t.patch(
        `${projects}/docs`,
        { name: 'Documentation', launchDate: '2026-12-01', repoUrl: 'https://example.com/repo' },
        w.owner,
      );
      expect(response.status).toBe(200);
      expect(await bodyOf<Project>(response)).toMatchObject({
        name: 'Documentation',
        launchDate: '2026-12-01',
        updatedBy: { kind: 'user', id: w.ids.owner },
      });
      expect((await eventsOf(t, 'acme')).at(-1)).toMatchObject({
        type: 'project.updated',
        requestId: response.headers.get(REQUEST_ID_HEADER),
        data: {
          name: ['Docs site', 'Documentation'],
          launchDate: [null, '2026-12-01'],
          repoUrl: [null, 'https://example.com/repo'],
        },
      });
    });

    it('refuses a repository address with a user name or a password in it, so no token reaches the event log', async () => {
      const repoUrl = 'https://user:ghp_secret@github.com/org/repo.git';
      const before = (await eventsOf(t, 'acme')).length;
      const patched = await t.patch(`${projects}/docs`, { repoUrl }, w.owner);
      expect(patched.status).toBe(400);
      expect((await errorOf(patched)).code).toBe('bad_request');
      const created = await t.post(
        projects,
        { name: 'With a token', key: 'TOK', slug: 'with-a-token', repoUrl },
        w.owner,
      );
      expect(created.status).toBe(400);
      expect(await eventsOf(t, 'acme')).toHaveLength(before);
      expect(JSON.stringify(await eventsOf(t, 'acme'))).not.toContain('ghp_secret');
      expect((await t.get(`${projects}/with-a-token`, w.owner)).status).toBe(404);
    });

    it('writes nothing when nothing changes', async () => {
      const before = (await eventsOf(t, 'acme')).length;
      const response = await t.patch(`${projects}/docs`, { name: 'Documentation' }, w.owner);
      expect(response.status).toBe(200);
      expect((await eventsOf(t, 'acme')).length).toBe(before);
    });

    it('refuses a Member with 403', async () => {
      const response = await t.patch(`${projects}/docs`, { name: 'Mine' }, w.member);
      expect(response.status).toBe(403);
    });

    it('a project role replaces the workspace role, so an Admin lowered to Viewer in one project cannot change it', async () => {
      const lowered = await t.put(
        `${projects}/docs/members/${w.ids.admin}`,
        { role: 'viewer' },
        w.owner,
      );
      expect(lowered.status).toBe(200);
      const response = await t.patch(`${projects}/docs`, { name: 'Admin was here' }, w.admin);
      expect(response.status).toBe(403);
      // In the other projects the Admin is still an Admin.
      expect((await t.patch(`${projects}/web`, { name: 'Website' }, w.admin)).status).toBe(200);
      expect((await t.delete(`${projects}/docs/members/${w.ids.admin}`, w.owner)).status).toBe(204);
    });

    it('refuses a new slug that another project has as its key with 409', async () => {
      const response = await t.patch(`${projects}/docs`, { slug: 'app' }, w.owner);
      expect(response.status).toBe(409);
    });
  });

  describe('POST /workspaces/:ws/projects/:p/archive', () => {
    it('refuses a Member with 403', async () => {
      expect((await t.post(`${projects}/docs/archive`, {}, w.member)).status).toBe(403);
    });

    it('archives a project, writes project.archived, and takes it off the list', async () => {
      const response = await t.post(`${projects}/docs/archive`, {}, w.admin);
      expect(response.status).toBe(200);
      const project = await bodyOf<Project>(response);
      expect(project.archivedAt).not.toBeNull();
      expect((await eventsOf(t, 'acme')).at(-1)).toMatchObject({
        type: 'project.archived',
        projectId: project.id,
        requestId: response.headers.get(REQUEST_ID_HEADER),
        data: { archivedAt: [null, project.archivedAt] },
      });
      const listed = await bodyOf<Project[]>(await t.get(projects, w.owner));
      expect(listed.map((entry) => entry.slug)).toEqual(['app', 'web']);
      const all = await bodyOf<Project[]>(await t.get(`${projects}?archived=true`, w.owner));
      expect(all.map((entry) => entry.slug)).toContain('docs');
      // It can still be read.
      expect((await t.get(`${projects}/docs`, w.viewer)).status).toBe(200);
    });

    it('refuses every write to an archived project with 409', async () => {
      const patch = await t.patch(`${projects}/docs`, { name: 'Too late' }, w.owner);
      expect(patch.status).toBe(409);
      expect((await errorOf(patch)).code).toBe('project_archived');
      const again = await t.post(`${projects}/docs/archive`, {}, w.owner);
      expect(again.status).toBe(409);
      const role = await t.put(
        `${projects}/docs/members/${w.ids.member}`,
        { role: 'viewer' },
        w.owner,
      );
      expect(role.status).toBe(409);
      const docs = await bodyOf<Project>(await t.get(`${projects}/docs`, w.owner));
      const invitation = await t.post(
        '/api/v1/workspaces/acme/invitations',
        { email: 'late@example.com', role: 'viewer', projectId: docs.id },
        w.owner,
      );
      expect(invitation.status).toBe(409);
    });
  });
});

import { testEngines } from '@turnkeel/db/testing';
import { eventSchema, type Event, type EventPage } from '@turnkeel/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bodyOf,
  buildWorld,
  createTestServer,
  errorOf,
  eventsOf,
  linkIn,
  type Session,
  type TestServer,
  type World,
} from '../testing/harness.js';

describe.each(testEngines)('events on %s', (engine) => {
  let t: TestServer;
  let w: World;
  /** Holds the Member role in the project `app` and nothing else. */
  let projectOnly: Session;

  beforeAll(async () => {
    t = await createTestServer(engine);
    w = await buildWorld(t);
    projectOnly = await t.join(w.owner, 'acme', 'pam@example.com', 'member', {
      name: 'Pam Project',
      projectId: w.app.id,
    });
    await t.patch('/api/v1/workspaces/acme/projects/web', { name: 'Website' }, w.admin);
    await t.patch('/api/v1/workspaces/acme', { name: 'Acme Inc' }, w.owner);
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  }, 60_000);

  const events = '/api/v1/workspaces/acme/events';
  const list = async (as: Session, query = '') =>
    bodyOf<EventPage>(await t.get(`${events}${query}`, as));

  describe('GET /workspaces/:ws/events', () => {
    it('lists the log newest first, as events of the protocol', async () => {
      const page = await list(w.owner, '?limit=200');
      const all = await eventsOf(t, 'acme');
      expect(page.items.map((event) => event.seq)).toEqual(all.map((event) => event.seq).reverse());
      expect(page.nextBefore).toBeNull();
      for (const event of page.items) expect(eventSchema.safeParse(event).success).toBe(true);
    });

    it('pages by seq: nextBefore of one page starts the next, without a gap or a repeat', async () => {
      const total = (await eventsOf(t, 'acme')).length;
      const seen: number[] = [];
      let query = '?limit=4';
      for (let pages = 0; pages < 20; pages += 1) {
        const page = await list(w.owner, query);
        expect(page.items.length).toBeLessThanOrEqual(4);
        seen.push(...page.items.map((event) => event.seq));
        if (page.nextBefore === null) break;
        expect(page.nextBefore).toBe(page.items.at(-1)?.seq);
        query = `?limit=4&before=${page.nextBefore}`;
      }
      expect(seen).toEqual(Array.from({ length: total }, (_, index) => total - index));
    });

    it('filters by project, area, actor, subject and time', async () => {
      const byProject = await list(w.owner, `?project=${w.web.id}&limit=200`);
      expect(byProject.items.length).toBeGreaterThan(0);
      expect(byProject.items.every((event) => event.projectId === w.web.id)).toBe(true);

      const people = await list(w.owner, '?area=people&limit=200');
      expect(people.items.length).toBeGreaterThan(0);
      expect(people.items.every((event) => event.type.startsWith('member.'))).toBe(true);
      const workspace = await list(w.owner, '?area=workspace&limit=200');
      expect(workspace.items.some((event) => event.type === 'project.created')).toBe(true);
      expect(workspace.items.every((event) => !event.type.startsWith('member.'))).toBe(true);

      const byActor = await list(w.owner, `?actor=${w.ids.admin}&limit=200`);
      // The Admin changed a project, and joined by accepting their invitation.
      expect(byActor.items.map((event) => event.type)).toEqual([
        'project.updated',
        'member.joined',
      ]);

      const bySubject = await list(w.owner, `?subject=${w.web.id}&limit=200`);
      expect(bySubject.items.map((event) => event.type)).toEqual([
        'project.updated',
        'project.created',
      ]);

      const first = (await eventsOf(t, 'acme'))[0] as Event;
      const upTo = await list(w.owner, `?to=${encodeURIComponent(first.at)}&limit=200`);
      expect(upTo.items.map((event) => event.seq)).toEqual([1]);
      const future = await list(w.owner, '?from=2999-01-01T00:00:00.000Z');
      expect(future.items).toEqual([]);
    });

    it('answers 400 to a query that does not match its schema', async () => {
      const response = await t.get(`${events}?limit=0`, w.owner);
      expect(response.status).toBe(400);
      expect((await t.get(`${events}?area=nonsense`, w.owner)).status).toBe(400);
      expect((await t.get(`${events}?unknown=1`, w.owner)).status).toBe(400);
    });

    it('a Member, who has no member.read, gets no event about members or invitations', async () => {
      const mine = await list(w.member, '?limit=200');
      expect(mine.items.length).toBeGreaterThan(0);
      expect(mine.items.some((event) => event.type.startsWith('member.'))).toBe(false);
      expect(mine.items.map((event) => event.type)).toEqual(
        expect.arrayContaining(['workspace.created', 'project.created', 'workspace.updated']),
      );
      // Asking for the area by name gives nothing, not an error.
      expect((await list(w.member, '?area=people')).items).toEqual([]);
      // An Admin has member.read and gets them.
      expect((await list(w.admin, '?area=people')).items.length).toBeGreaterThan(0);
    });

    it('paging still fills a page when many events in a row are not the caller’s to read', async () => {
      const readable = (await list(w.member, '?limit=200')).items.map((event) => event.seq);
      const seen: number[] = [];
      let query = '?limit=2';
      for (let pages = 0; pages < 50; pages += 1) {
        const page = await list(w.member, query);
        seen.push(...page.items.map((event) => event.seq));
        if (page.nextBefore === null) break;
        query = `?limit=2&before=${page.nextBefore}`;
      }
      expect(seen).toEqual(readable);
    });

    it('a person with a role in one project reads that project’s events and no others', async () => {
      const mine = await list(projectOnly, `?project=${w.app.id}&limit=200`);
      expect(mine.items.map((event) => event.type)).toEqual(['project.created']);
      // The project's own member events need member.read, which a project role never gives.
      expect(mine.items.every((event) => event.projectId === w.app.id)).toBe(true);

      const other = await t.get(`${events}?project=${w.web.id}`, projectOnly);
      expect(other.status).toBe(404);
      const whole = await t.get(events, projectOnly);
      expect(whole.status).toBe(403);
      expect(await errorOf(whole)).toMatchObject({ rule: 'R30' });
    });

    it('refuses a Tester, who has no events.read, with 403', async () => {
      const response = await t.get(`${events}?project=${w.app.id}`, w.tester);
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ rule: 'R3' });
    });

    it('answers 401 without a session', async () => {
      expect((await t.get(events)).status).toBe(401);
    });
  });

  describe('GET /workspaces/:ws/events/export', () => {
    it('gives an Admin the whole log as NDJSON, oldest first, as a download', async () => {
      const response = await t.get(`${events}/export`, w.admin);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
      expect(response.headers.get('content-disposition')).toBe(
        'attachment; filename="acme-events.ndjson"',
      );
      const text = await response.text();
      expect(text.endsWith('\n')).toBe(true);
      const lines = text
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as Event);
      expect(lines).toEqual(await eventsOf(t, 'acme'));
    });

    it.each(['member', 'reviewer', 'viewer'] as const)('refuses a %s with 403', async (who) => {
      const response = await t.get(`${events}/export`, w[who]);
      expect(response.status).toBe(403);
      expect((await errorOf(response)).code).toBe('forbidden');
    });

    it('answers 401 to a bearer token: the export is for a person’s session only', async () => {
      const response = await t.request('GET', `${events}/export`, {
        headers: { authorization: 'Bearer tk_anything' },
      });
      expect(response.status).toBe(401);
    });
  });

  describe('what the log holds (R24, R48)', () => {
    it('every event names its actor, its channel and a request id, and seq has no gap', async () => {
      const all = await eventsOf(t, 'acme');
      expect(all.map((event) => event.seq)).toEqual(all.map((_, index) => index + 1));
      for (const event of all) {
        expect(event.actor.kind).toBe('user');
        expect(event.actor.name.length).toBeGreaterThan(0);
        expect(event.via).toBe('web');
        expect(event.requestId).toMatch(/^[0-9a-f-]{36}$/);
      }
    });

    it('no event holds an invitation token, its hash, a sign-in link or a session', async () => {
      const text = JSON.stringify(await eventsOf(t, 'acme'));
      const links = t.mail.map(linkIn);
      expect(links.length).toBeGreaterThan(5);
      for (const link of links) {
        const token = new URL(link).searchParams.get('token');
        expect(token).not.toBeNull();
        expect(text).not.toContain(token);
      }
      for (const session of [w.owner, w.admin, w.member]) {
        const value = session.cookie.split('=')[1]?.split('.')[0] ?? '';
        expect(value.length).toBeGreaterThan(10);
        expect(text).not.toContain(value);
      }
      expect(text).not.toMatch(/tokenHash|token_hash|password|secret/i);
    });
  });
});

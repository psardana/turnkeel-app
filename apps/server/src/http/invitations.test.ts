import { schema } from '@turnkeel/db';
import type {
  AcceptInvitationResponse,
  CreateInvitationResponse,
  Invitation,
  InvitationLookup,
  Me,
} from '@turnkeel/protocol';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bodyOf,
  buildWorld,
  createTestServer,
  errorOf,
  eventsOf,
  linkIn,
  tokenIn,
  type Session,
  type TestServer,
  type World,
} from '../testing/harness.js';
import { hashInvitationToken } from '../services/invitations.js';
import { REQUEST_ID_HEADER } from './app.js';
import { REPLAYED_HEADER } from './idempotency.js';

const NOT_FOUND = { code: 'not_found', message: 'There is nothing at this address.' };

describe.each(testEngines)('invitations on %s', (engine) => {
  let t: TestServer;
  let w: World;

  beforeAll(async () => {
    t = await createTestServer(engine);
    w = await buildWorld(t);
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  }, 60_000);

  const invite = (as: Session, json: unknown, headers?: Record<string, string>) =>
    t.post('/api/v1/workspaces/acme/invitations', json, as, headers);
  const lastMailTo = (email: string) => {
    const mail = t.mail.findLast((message) => message.to === email);
    if (!mail) throw new Error(`No mail to ${email}.`);
    return mail;
  };
  const accept = (as: Session, token: string, handle?: string) =>
    t.post('/api/v1/invitations/accept', { token, ...(handle ? { handle } : {}) }, as);

  describe('POST /workspaces/:ws/invitations', () => {
    it('makes an invitation, mails the link, and answers without the token (R45)', async () => {
      const response = await invite(w.admin, { email: 'New.Person@Example.com', role: 'member' });
      expect(response.status).toBe(201);
      const body = await bodyOf<CreateInvitationResponse>(response);
      expect(body.mail).toBe('sent');
      expect(body.invitation).toMatchObject({
        email: 'new.person@example.com',
        role: 'member',
        projectId: null,
        invitedBy: w.ids.admin,
        acceptedAt: null,
        revokedAt: null,
      });
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      expect(Date.parse(body.invitation.expiresAt) - Date.now()).toBeGreaterThan(
        sevenDays - 60_000,
      );
      expect(Date.parse(body.invitation.expiresAt) - Date.now()).toBeLessThanOrEqual(sevenDays);

      const mail = lastMailTo('new.person@example.com');
      expect(mail.subject).toBe('Adam Admin invited you to Acme on Turnkeel');
      expect(mail.text).toContain('Adam Admin invited you to the workspace Acme as Member.');
      const link = new URL(linkIn(mail));
      expect(`${link.origin}${link.pathname}`).toBe('http://localhost:4400/invitations/accept');
      const token = tokenIn(mail);

      // R45: neither the token nor its hash is in the answer.
      const text = JSON.stringify(body);
      expect(text).not.toContain(token);
      expect(text).not.toContain(hashInvitationToken(token));
    });

    it('the member.invited event carries the address, the role and who invited, and no token or hash', async () => {
      const response = await invite(w.owner, { email: 'event@example.com', role: 'viewer' });
      const token = tokenIn(lastMailTo('event@example.com'));
      const events = (await eventsOf(t, 'acme')).filter(
        (event) => event.requestId === response.headers.get(REQUEST_ID_HEADER),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'member.invited',
        subject: { type: 'invitation' },
        data: {
          email: 'event@example.com',
          role: 'viewer',
          projectId: null,
          invitedBy: w.ids.owner,
        },
      });
      const everything = JSON.stringify(await eventsOf(t, 'acme'));
      expect(everything).not.toContain(token);
      expect(everything).not.toContain(hashInvitationToken(token));
    });

    it('names the project in the mail and in the event of an invitation to a project', async () => {
      const response = await invite(w.admin, {
        email: 'pat@example.com',
        role: 'tester',
        projectId: w.app.id,
      });
      expect(response.status).toBe(201);
      expect((await bodyOf<CreateInvitationResponse>(response)).invitation.projectId).toBe(
        w.app.id,
      );
      expect(lastMailTo('pat@example.com').text).toContain(
        'Adam Admin invited you to the project App in the workspace Acme as Tester.',
      );
      expect((await eventsOf(t, 'acme')).at(-1)).toMatchObject({
        type: 'member.invited',
        projectId: w.app.id,
      });
    });

    it.each(['member', 'reviewer', 'viewer', 'tester'] as const)(
      'refuses a %s, who does not manage members, with 403',
      async (who) => {
        const response = await invite(w[who], { email: 'nobody@example.com', role: 'viewer' });
        expect(response.status).toBe(403);
      },
    );

    it('an Admin cannot invite an Owner, and an Owner can', async () => {
      const denied = await invite(w.admin, { email: 'boss@example.com', role: 'owner' });
      expect(denied.status).toBe(403);
      expect(await errorOf(denied)).toMatchObject({ rule: 'R31' });
      expect((await invite(w.owner, { email: 'boss@example.com', role: 'owner' })).status).toBe(
        201,
      );
    });

    it('a Tester invitation must name a project', async () => {
      const response = await invite(w.owner, { email: 'tester@example.com', role: 'tester' });
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ rule: 'R32' });
    });

    it('an invitation to a project cannot give Owner or Admin', async () => {
      const response = await invite(w.owner, {
        email: 'x@example.com',
        role: 'admin',
        projectId: w.app.id,
      });
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ rule: 'R30' });
    });

    it('refuses a project the workspace does not have with 422', async () => {
      const response = await invite(w.owner, {
        email: 'x@example.com',
        role: 'viewer',
        projectId: '99999999-9999-4999-8999-999999999999',
      });
      expect(response.status).toBe(422);
    });

    it('refuses someone who is in the workspace already with 409', async () => {
      const response = await invite(w.owner, { email: 'mia@example.com', role: 'viewer' });
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe('conflict');
    });

    it('refuses an invitation to a project for someone who is in the workspace already with 409', async () => {
      const mails = t.mail.length;
      // A Member of the workspace, and a person whose only role is in another project.
      for (const email of ['mia@example.com', 'Tess@Example.com']) {
        const response = await invite(w.owner, { email, role: 'viewer', projectId: w.web.id });
        expect(response.status, email).toBe(409);
        const error = await errorOf(response);
        expect(error.code).toBe('conflict');
        expect(error.message).toBe(
          'This person is already in the workspace. Give them a role in the project on the Members page.',
        );
      }
      expect(t.mail).toHaveLength(mails);

      // The project role is given without an invitation.
      const given = await t.put(
        `/api/v1/workspaces/acme/projects/web/members/${w.ids.tester}`,
        { role: 'viewer' },
        w.owner,
      );
      expect(given.status).toBe(200);
      expect(
        (await t.delete(`/api/v1/workspaces/acme/projects/web/members/${w.ids.tester}`, w.owner))
          .status,
      ).toBe(204);
    });

    it('takes an invitation to the workspace for someone who holds only a project role', async () => {
      // An invitation is the only way to give such a person a workspace role.
      const response = await invite(w.owner, { email: 'tess@example.com', role: 'viewer' });
      expect(response.status).toBe(201);
      const { invitation } = await bodyOf<CreateInvitationResponse>(response);
      expect((await t.delete(`/api/v1/invitations/${invitation.id}`, w.owner)).status).toBe(200);
    });

    it('a second invitation to the same address replaces the first, which stops working', async () => {
      expect((await invite(w.owner, { email: 'twice@example.com', role: 'viewer' })).status).toBe(
        201,
      );
      const firstToken = tokenIn(lastMailTo('twice@example.com'));
      const second = await invite(w.owner, { email: 'twice@example.com', role: 'member' });
      expect(second.status).toBe(201);
      const secondToken = tokenIn(lastMailTo('twice@example.com'));
      expect(secondToken).not.toBe(firstToken);

      const events = (await eventsOf(t, 'acme')).filter(
        (event) => event.requestId === second.headers.get(REQUEST_ID_HEADER),
      );
      expect(events.map((event) => [event.type, event.data.reason])).toEqual([
        ['member.invite_revoked', 'replaced'],
        ['member.invited', undefined],
      ]);

      const twice = await t.signIn('twice@example.com', 'Twice');
      const old = await accept(twice, firstToken);
      expect(old.status).toBe(404);
      expect(await old.json()).toEqual({ error: NOT_FOUND });
      expect((await accept(twice, secondToken)).status).toBe(200);
    });

    it('a repeat with the same key answers the same and sends no second mail', async () => {
      const headers = { 'Idempotency-Key': 'invite-once' };
      const body = { email: 'once@example.com', role: 'viewer' };
      const first = await invite(w.owner, body, headers);
      expect(first.status).toBe(201);
      const mails = t.mail.filter((message) => message.to === 'once@example.com').length;
      const second = await invite(w.owner, body, headers);
      expect(second.status).toBe(201);
      expect(second.headers.get(REPLAYED_HEADER)).toBe('true');
      expect(await second.json()).toEqual(await first.json());
      expect(t.mail.filter((message) => message.to === 'once@example.com')).toHaveLength(mails);
    });
  });

  describe('GET /workspaces/:ws/invitations and DELETE /invitations/:id', () => {
    it('lists the invitations for someone who manages members, without tokens or hashes', async () => {
      const response = await t.get('/api/v1/workspaces/acme/invitations', w.admin);
      expect(response.status).toBe(200);
      const list = await bodyOf<Invitation[]>(response);
      expect(list.length).toBeGreaterThan(5);
      for (const invitation of list) {
        expect(Object.keys(invitation)).not.toContain('tokenHash');
        expect(Object.keys(invitation)).not.toContain('token');
      }
      const rows = await t.test.db.select().from(schema.invitations);
      const text = JSON.stringify(list);
      for (const row of rows) expect(text).not.toContain(row.tokenHash);
    });

    it('refuses a Member with 403', async () => {
      expect((await t.get('/api/v1/workspaces/acme/invitations', w.member)).status).toBe(403);
    });

    it('revokes an invitation, writes member.invite_revoked, and the link stops working', async () => {
      const created = await bodyOf<CreateInvitationResponse>(
        await invite(w.owner, { email: 'revoked@example.com', role: 'viewer' }),
      );
      const token = tokenIn(lastMailTo('revoked@example.com'));
      const response = await t.delete(`/api/v1/invitations/${created.invitation.id}`, w.admin);
      expect(response.status).toBe(200);
      expect((await bodyOf<Invitation>(response)).revokedAt).not.toBeNull();
      expect((await eventsOf(t, 'acme')).at(-1)).toMatchObject({
        type: 'member.invite_revoked',
        subject: { type: 'invitation', id: created.invitation.id },
        data: { email: 'revoked@example.com', role: 'viewer', reason: 'revoked' },
        requestId: response.headers.get(REQUEST_ID_HEADER),
      });

      // R45: a revoked token gets the same 404 as one nobody knows.
      const lookedUp = await t.post('/api/v1/invitations/lookup', { token });
      expect(lookedUp.status).toBe(404);
      expect(await lookedUp.json()).toEqual({ error: NOT_FOUND });
      // Revoking it again finds nothing to revoke.
      expect((await t.delete(`/api/v1/invitations/${created.invitation.id}`, w.admin)).status).toBe(
        404,
      );
    });

    it('answers the same 404 to someone outside the workspace, and to a Member inside it', async () => {
      const created = await bodyOf<CreateInvitationResponse>(
        await invite(w.owner, { email: 'kept@example.com', role: 'viewer' }),
      );
      for (const who of [w.stranger, w.member]) {
        const response = await t.delete(`/api/v1/invitations/${created.invitation.id}`, who);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: NOT_FOUND });
      }
      const unknown = await t.delete(
        '/api/v1/invitations/99999999-9999-4999-8999-999999999999',
        w.owner,
      );
      expect(unknown.status).toBe(404);
    });

    it('an Admin cannot revoke an invitation that gives the Owner role', async () => {
      const list = await bodyOf<Invitation[]>(
        await t.get('/api/v1/workspaces/acme/invitations', w.owner),
      );
      const forOwner = list.find((invitation) => invitation.role === 'owner');
      expect(forOwner).toBeDefined();
      const response = await t.delete(`/api/v1/invitations/${forOwner?.id}`, w.admin);
      expect(response.status).toBe(403);
      expect(await errorOf(response)).toMatchObject({ rule: 'R31' });
    });

    it('an Admin cannot replace an invitation that gives the Owner role by inviting the address again', async () => {
      expect((await invite(w.owner, { email: 'heir@example.com', role: 'owner' })).status).toBe(
        201,
      );
      const ownerToken = tokenIn(lastMailTo('heir@example.com'));
      const eventsBefore = (await eventsOf(t, 'acme')).length;
      const mailsBefore = t.mail.length;

      const denied = await invite(w.admin, { email: 'Heir@Example.com', role: 'member' });
      expect(denied.status).toBe(403);
      expect(await errorOf(denied)).toMatchObject({ rule: 'R31' });
      // Nothing was written or sent, and the Owner's link still works.
      expect(await eventsOf(t, 'acme')).toHaveLength(eventsBefore);
      expect(t.mail).toHaveLength(mailsBefore);
      const lookup = await t.post('/api/v1/invitations/lookup', { token: ownerToken });
      expect(lookup.status).toBe(200);
      expect(await bodyOf<InvitationLookup>(lookup)).toMatchObject({ role: 'owner' });

      // An invitation to a project is another invitation and replaces nothing.
      expect(
        (await invite(w.admin, { email: 'heir@example.com', role: 'viewer', projectId: w.app.id }))
          .status,
      ).toBe(201);
      expect((await t.post('/api/v1/invitations/lookup', { token: ownerToken })).status).toBe(200);

      // An Owner may replace it.
      const replaced = await invite(w.owner, { email: 'heir@example.com', role: 'admin' });
      expect(replaced.status).toBe(201);
      expect((await t.post('/api/v1/invitations/lookup', { token: ownerToken })).status).toBe(404);
    });
  });

  describe('POST /invitations/lookup', () => {
    it('tells the invited person the workspace, the role, who invited and the address, and nothing else', async () => {
      await invite(w.admin, { email: 'look@example.com', role: 'reviewer' });
      const response = await t.post('/api/v1/invitations/lookup', {
        token: tokenIn(lastMailTo('look@example.com')),
      });
      expect(response.status).toBe(200);
      const body = await bodyOf<InvitationLookup>(response);
      expect(body).toEqual({
        email: 'look@example.com',
        role: 'reviewer',
        workspace: { name: 'Acme', slug: 'acme' },
        project: null,
        invitedBy: { name: 'Adam Admin' },
        expiresAt: body.expiresAt,
        suggestedHandle: null,
      });
    });

    it('suggests a free handle to the signed-in person', async () => {
      await invite(w.admin, { email: 'olive.two@example.com', role: 'viewer' });
      const token = tokenIn(lastMailTo('olive.two@example.com'));
      const person = await t.signIn('olive.two@example.com', 'Olive');
      const body = await bodyOf<InvitationLookup>(
        await t.post('/api/v1/invitations/lookup', { token }, person),
      );
      // `olive` is the Owner's handle.
      expect(body.suggestedHandle).toBe('olive-2');
    });

    it('answers the one 404 to a token nobody knows', async () => {
      const response = await t.post('/api/v1/invitations/lookup', { token: 'made-up' });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: NOT_FOUND });
    });
  });

  describe('POST /invitations/accept (R45)', () => {
    it('needs a signed-in person', async () => {
      await invite(w.owner, { email: 'anon@example.com', role: 'viewer' });
      const response = await t.post('/api/v1/invitations/accept', {
        token: tokenIn(lastMailTo('anon@example.com')),
      });
      expect(response.status).toBe(401);
    });

    it('makes a Member with the handle the person picks, writes member.joined, and works once', async () => {
      await invite(w.admin, { email: 'joiner@example.com', role: 'member' });
      const token = tokenIn(lastMailTo('joiner@example.com'));
      const joiner = await t.signIn('joiner@example.com', 'Jo Joiner');

      const response = await accept(joiner, token, 'jo');
      expect(response.status).toBe(200);
      const body = await bodyOf<AcceptInvitationResponse>(response);
      expect(body.workspace.slug).toBe('acme');
      expect(body.member).toMatchObject({ role: 'member', handle: 'jo' });
      expect(body.projectMember).toBeNull();

      const events = (await eventsOf(t, 'acme')).filter(
        (event) => event.requestId === response.headers.get(REQUEST_ID_HEADER),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'member.joined',
        subject: { type: 'member', id: body.member?.id },
        actor: { kind: 'user', name: 'Jo Joiner' },
        data: { role: 'member', handle: 'jo' },
      });
      expect(JSON.stringify(events)).not.toContain(token);

      // R45: used once. The same token again is the one 404.
      const again = await accept(joiner, token, 'jo-again');
      expect(again.status).toBe(404);
      expect(await again.json()).toEqual({ error: NOT_FOUND });
      const me = await bodyOf<Me>(await t.get('/api/v1/me', joiner));
      expect(me.workspaces.map((entry) => [entry.workspace.slug, entry.role])).toEqual([
        ['acme', 'member'],
      ]);
    });

    it('an invitation to a project makes only a ProjectMember, with no workspace role and no handle', async () => {
      await invite(w.admin, { email: 'pt@example.com', role: 'tester', projectId: w.web.id });
      const token = tokenIn(lastMailTo('pt@example.com'));
      const person = await t.signIn('pt@example.com', 'Pat Tester');
      const response = await accept(person, token);
      expect(response.status).toBe(200);
      const body = await bodyOf<AcceptInvitationResponse>(response);
      expect(body.member).toBeNull();
      expect(body.projectMember).toMatchObject({ projectId: w.web.id, role: 'tester' });
      expect((await eventsOf(t, 'acme')).at(-1)).toMatchObject({
        type: 'member.joined',
        projectId: w.web.id,
        subject: { type: 'project_member' },
      });
      const me = await bodyOf<Me>(await t.get('/api/v1/me', person));
      expect(me.workspaces[0]).toMatchObject({
        role: null,
        handle: null,
        projectRoles: { [w.web.id]: 'tester' },
      });
    });

    it('refuses a signed-in person whose address is not the one invited, and leaves the invitation open', async () => {
      await invite(w.owner, { email: 'right@example.com', role: 'viewer' });
      const token = tokenIn(lastMailTo('right@example.com'));
      const wrong = await accept(w.viewer, token, 'wrong');
      expect(wrong.status).toBe(403);
      expect(await errorOf(wrong)).toMatchObject({ code: 'forbidden', rule: 'R45' });

      const right = await t.signIn('right@example.com', 'Right Person');
      expect((await accept(right, token, 'right')).status).toBe(200);
    });

    it('compares the address without regard to case', async () => {
      await invite(w.owner, { email: 'MiXed@Example.com', role: 'viewer' });
      const token = tokenIn(lastMailTo('mixed@example.com'));
      const person = await t.signIn('mixed@EXAMPLE.com', 'Mixed Case');
      expect((await accept(person, token, 'mixed')).status).toBe(200);
    });

    it('an expired invitation gets the one 404, and cannot be looked up', async () => {
      const created = await bodyOf<CreateInvitationResponse>(
        await invite(w.owner, { email: 'late@example.com', role: 'viewer' }),
      );
      const token = tokenIn(lastMailTo('late@example.com'));
      const late = await t.signIn('late@example.com', 'Late Person');
      await t.test.db
        .update(schema.invitations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.invitations.id, created.invitation.id));

      const response = await accept(late, token, 'late');
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: NOT_FOUND });
      expect((await t.post('/api/v1/invitations/lookup', { token })).status).toBe(404);
      expect((await t.get('/api/v1/workspaces/acme', late)).status).toBe(404);
    });

    it('a token nobody knows gets the one 404', async () => {
      const response = await accept(w.viewer, 'no-such-token', 'someone');
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: NOT_FOUND });
    });

    it('refuses a handle that is taken with 409 and leaves the invitation open', async () => {
      await invite(w.owner, { email: 'clash@example.com', role: 'viewer' });
      const token = tokenIn(lastMailTo('clash@example.com'));
      const person = await t.signIn('clash@example.com', 'Clash');
      const taken = await accept(person, token, 'olive');
      expect(taken.status).toBe(409);
      expect((await errorOf(taken)).code).toBe('handle_taken');
      expect((await accept(person, token, 'clash')).status).toBe(200);
    });

    it('picks a free handle from the person’s name when none is sent', async () => {
      await invite(w.owner, { email: 'auto@example.com', role: 'viewer' });
      const token = tokenIn(lastMailTo('auto@example.com'));
      const person = await t.signIn('auto@example.com', 'Ünal Çelik');
      const response = await accept(person, token);
      expect(response.status).toBe(200);
      expect((await bodyOf<AcceptInvitationResponse>(response)).member?.handle).toBe('unal-celik');
    });
  });
});

describe('an invitation when the mail cannot be sent', () => {
  it('keeps the invitation and says that the mail failed', async () => {
    const sent: string[] = [];
    const t = await createTestServer('pglite', {
      mailer: {
        kind: 'smtp',
        send(message) {
          // Sign-in mail goes out; invitation mail does not.
          if (message.subject.includes('invited')) return Promise.reject(new Error('no route'));
          sent.push(message.text);
          t.mail.push(message);
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
      },
    });
    try {
      const owner = await t.signIn('olive@example.com', 'Olive Owner');
      await t.post('/api/v1/workspaces', { name: 'Acme', slug: 'acme', handle: 'olive' }, owner);
      const response = await t.post(
        '/api/v1/workspaces/acme/invitations',
        { email: 'lost@example.com', role: 'viewer' },
        owner,
      );
      expect(response.status).toBe(201);
      expect((await bodyOf<CreateInvitationResponse>(response)).mail).toBe('failed');
      expect(
        t.log.some((line) => line.includes('Mail to lost@example.com could not be sent.')),
      ).toBe(true);
    } finally {
      await t.stop();
    }
  }, 60_000);

  it('a repeat with the same key is told that the mail failed, and nothing is written or sent again', async () => {
    let attempts = 0;
    const t = await createTestServer('pglite', {
      mailer: {
        kind: 'smtp',
        send(message) {
          if (message.subject.includes('invited')) {
            attempts += 1;
            return Promise.reject(new Error('no route'));
          }
          t.mail.push(message);
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
      },
    });
    try {
      const owner = await t.signIn('olive@example.com', 'Olive Owner');
      await t.post('/api/v1/workspaces', { name: 'Acme', slug: 'acme', handle: 'olive' }, owner);
      const send = () =>
        t.post(
          '/api/v1/workspaces/acme/invitations',
          { email: 'lost@example.com', role: 'viewer' },
          owner,
          { 'Idempotency-Key': 'invite-lost' },
        );
      const first = await send();
      expect(first.status).toBe(201);
      const second = await send();
      expect(second.status).toBe(201);
      expect(second.headers.get(REPLAYED_HEADER)).toBe('true');
      const body = await bodyOf<CreateInvitationResponse>(second);
      expect(body.mail).toBe('failed');
      expect(body).toEqual(await first.json());
      expect(attempts).toBe(1);
      expect(
        (await eventsOf(t, 'acme')).filter((event) => event.type.startsWith('member.invite')),
      ).toHaveLength(1);
    } finally {
      await t.stop();
    }
  }, 60_000);
});

describe.each(testEngines)(
  'an invitation repeated while its mail is still going out, on %s',
  (engine) => {
    it('is written once and mailed once, and both answers name the same invitation', async () => {
      const entered = deferred();
      const held = deferred();
      let sends = 0;
      const t = await createTestServer(engine, {
        mailer: {
          kind: 'smtp',
          async send(message) {
            if (message.subject.includes('invited')) {
              sends += 1;
              // The first invitation mail stays with a slow mail server until the test lets it go.
              if (sends === 1) {
                entered.resolve();
                await held.promise;
              }
            }
            t.mail.push(message);
          },
          close: () => Promise.resolve(),
        },
      });
      try {
        const owner = await t.signIn('olive@example.com', 'Olive Owner');
        await t.post('/api/v1/workspaces', { name: 'Acme', slug: 'acme', handle: 'olive' }, owner);
        const send = () =>
          t.post(
            '/api/v1/workspaces/acme/invitations',
            { email: 'slow@example.com', role: 'viewer' },
            owner,
            { 'Idempotency-Key': 'invite-1' },
          );

        const first = send();
        await entered.promise;
        // The client gave up waiting and tries again, with the same key.
        const repeat = await send();
        expect(repeat.status).toBe(201);
        expect(repeat.headers.get(REPLAYED_HEADER)).toBe('true');
        const repeated = await bodyOf<CreateInvitationResponse>(repeat);

        held.resolve();
        const answered = await first;
        expect(answered.status).toBe(201);
        expect(answered.headers.get(REPLAYED_HEADER)).toBeNull();
        const original = await bodyOf<CreateInvitationResponse>(answered);
        expect(repeated.invitation.id).toBe(original.invitation.id);
        expect(repeated).toEqual(original);

        expect(sends).toBe(1);
        expect(
          (await eventsOf(t, 'acme'))
            .map((event) => event.type)
            .filter((type) => type.startsWith('member.invite')),
        ).toEqual(['member.invited']);
        // The one link that went out still works.
        const mail = t.mail.findLast((message) => message.to === 'slow@example.com');
        expect(mail).toBeDefined();
        const lookup = await t.post('/api/v1/invitations/lookup', { token: tokenIn(mail!) });
        expect(lookup.status).toBe(200);
      } finally {
        held.resolve();
        await t.stop();
      }
    }, 60_000);
  },
);

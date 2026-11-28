import { createHash } from 'node:crypto';
import { queryRows } from '@turnkeel/db';
import { testEngines } from '@turnkeel/db/testing';
import type {
  Agent,
  AgentToken,
  AgentWithTokens,
  CreateTokenResponse,
  EventPage,
  Project,
} from '@turnkeel/protocol';
import { sql } from 'drizzle-orm';
import {
  bodyOf,
  buildWorld,
  createTestServer,
  errorOf,
  eventsOf,
  openStream,
  type Session,
  type TestServer,
  type World,
} from '../testing/harness.js';
import { REQUEST_ID_HEADER } from './app.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe.each(testEngines)('agents and agent tokens on %s', (engine) => {
  let t: TestServer;
  let w: World;
  /** An agent of acme, owned by the Owner, with a token on the project `app`. */
  let bot: Agent;
  let botToken: CreateTokenResponse;

  beforeAll(async () => {
    t = await createTestServer(engine);
    w = await buildWorld(t);
    bot = await makeAgent(w.owner, 'board-keeper');
    botToken = await makeToken(w.owner, bot.id, { scopes: ['cards:read', 'cards:write'] });
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  }, 60_000);

  async function makeAgent(as: Session, name: string, extra: object = {}): Promise<Agent> {
    const response = await t.post(
      '/api/v1/workspaces/acme/agents',
      { name, kind: 'claude-code', ...extra },
      as,
    );
    expect(response.status).toBe(201);
    return bodyOf<Agent>(response);
  }

  async function makeToken(
    as: Session,
    agentId: string,
    body: {
      scopes?: string[];
      projectIds?: string[];
      workspaceWide?: boolean;
      expiresAt?: string;
    } = {},
  ): Promise<CreateTokenResponse> {
    const response = await t.post(
      `/api/v1/agents/${agentId}/tokens`,
      { name: 'CI', scopes: ['cards:read'], projectIds: [w.app.id], ...body },
      as,
    );
    expect(response.status).toBe(201);
    return bodyOf<CreateTokenResponse>(response);
  }

  /**
   * A token of its own for one test. `access.denied` is appended at most once a minute
   * for one token, action and rule, so a test that counts those events uses a
   * token that no other test has been refused with.
   */
  const freshToken = (scopes: string[] = ['cards:read', 'cards:write']) =>
    makeToken(w.owner, bot.id, { scopes });

  /** A request with a bearer token. */
  const bearer = (
    value: string,
    method: string,
    path: string,
    json?: unknown,
    headers: Record<string, string> = {},
  ) =>
    t.request(method, path, {
      headers: { authorization: `Bearer ${value}`, ...headers },
      ...(json === undefined ? {} : { json }),
    });

  const eventsOfRequest = async (response: Response) =>
    (await eventsOf(t, 'acme')).filter(
      (event) => event.requestId === response.headers.get(REQUEST_ID_HEADER),
    );

  describe('POST /workspaces/:ws/agents', () => {
    it('lets an Owner make an agent, owned by them, and writes agent.created', async () => {
      const response = await t.post(
        '/api/v1/workspaces/acme/agents',
        { name: 'release-notes', kind: 'script' },
        w.owner,
      );
      expect(response.status).toBe(201);
      const agent = await bodyOf<Agent>(response);
      expect(agent).toMatchObject({
        name: 'release-notes',
        kind: 'script',
        ownerUserId: w.ids.owner,
        disabledAt: null,
      });
      const events = await eventsOfRequest(response);
      expect(events.map((event) => event.type)).toEqual(['agent.created']);
      expect(events[0]).toMatchObject({
        subject: { type: 'agent', id: agent.id },
        data: { name: 'release-notes', kind: 'script', ownerUserId: w.ids.owner },
      });
    });

    it('lets an Admin make one for another member', async () => {
      const agent = await makeAgent(w.admin, 'codex-runner', { ownerUserId: w.ids.member });
      expect(agent.ownerUserId).toBe(w.ids.member);
    });

    it('refuses an owner who holds no role in the workspace with 422', async () => {
      for (const ownerUserId of [w.ids.tester, w.ids.stranger]) {
        const response = await t.post(
          '/api/v1/workspaces/acme/agents',
          { name: 'orphan', kind: 'other', ownerUserId },
          w.owner,
        );
        expect(response.status).toBe(422);
      }
    });

    it('refuses a name another agent has, without regard to case, with 409', async () => {
      await makeAgent(w.owner, 'twin');
      const response = await t.post(
        '/api/v1/workspaces/acme/agents',
        { name: 'twin', kind: 'other' },
        w.admin,
      );
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe('name_taken');
      // The schema keeps names lower case, so `Twin` is refused before it gets there.
      expect(
        (await t.post('/api/v1/workspaces/acme/agents', { name: 'Twin', kind: 'other' }, w.owner))
          .status,
      ).toBe(400);
    });

    it.each([
      ['member', 'R7'],
      ['reviewer', 'R6'],
      ['viewer', 'R5'],
      ['tester', 'R30'],
    ] as const)('refuses a %s with 403 naming %s', async (who, rule) => {
      const response = await t.post(
        '/api/v1/workspaces/acme/agents',
        { name: `by-${who}`, kind: 'other' },
        w[who],
      );
      expect(response.status).toBe(403);
      expect((await errorOf(response)).rule).toBe(rule);
    });

    it('a stranger gets the one 404', async () => {
      const response = await t.post(
        '/api/v1/workspaces/acme/agents',
        { name: 'nosy', kind: 'other' },
        w.stranger,
      );
      expect(response.status).toBe(404);
    });
  });

  describe('GET /workspaces/:ws/agents and GET /agents/:id/tokens', () => {
    it('shows an Admin each agent with its tokens, and never a token or its hash', async () => {
      const response = await t.get('/api/v1/workspaces/acme/agents', w.admin);
      expect(response.status).toBe(200);
      const list = await bodyOf<AgentWithTokens[]>(response);
      const entry = list.find((item) => item.agent.id === bot.id);
      expect(entry?.tokens.map((token) => token.id)).toContain(botToken.token.id);
      const text = JSON.stringify(list);
      expect(text).not.toContain(botToken.value);
      expect(text).not.toContain(sha256(botToken.value));

      const tokens = await bodyOf<AgentToken[]>(
        await t.get(`/api/v1/agents/${bot.id}/tokens`, w.owner),
      );
      expect(tokens[0]).toMatchObject({
        prefix: botToken.value.slice(0, 11),
        scopes: ['cards:read', 'cards:write'],
        projectIds: [w.app.id],
        workspaceWide: false,
      });
      expect(JSON.stringify(tokens)).not.toContain(botToken.value);
    });

    it.each(['member', 'reviewer', 'viewer'] as const)(
      'refuses a %s, who has no agent.read, with 403',
      async (who) => {
        expect((await t.get('/api/v1/workspaces/acme/agents', w[who])).status).toBe(403);
      },
    );

    it('an agent id outside the caller’s workspaces is the one 404', async () => {
      expect((await t.get(`/api/v1/agents/${bot.id}/tokens`, w.stranger)).status).toBe(404);
      expect((await t.get(`/api/v1/agents/${bot.id}/tokens`, w.member)).status).toBe(404);
      expect((await t.get('/api/v1/agents/not-an-id/tokens', w.owner)).status).toBe(404);
    });
  });

  describe('POST /agents/:id/tokens', () => {
    it('shows the token once and stores only its hash', async () => {
      const made = await makeToken(w.owner, bot.id);
      expect(made.value).toMatch(/^tk_[A-Za-z0-9_-]{43}$/);
      const rows = await queryRows<Record<string, unknown>>(
        t.test.db,
        sql`select * from agent_tokens where id = ${made.token.id}::uuid`,
      );
      expect(rows[0]?.hash).toBe(sha256(made.value));
      expect(Object.values(rows[0] ?? {})).not.toContain(made.value);
    });

    it('token.created names the prefix, the scopes and the projects, and never the token or its hash', async () => {
      const response = await t.post(
        `/api/v1/agents/${bot.id}/tokens`,
        { name: 'Board', scopes: ['cards:read'], projectIds: [w.app.id, w.web.id] },
        w.admin,
      );
      expect(response.status).toBe(201);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const made = await bodyOf<CreateTokenResponse>(response);
      const events = await eventsOfRequest(response);
      expect(events.map((event) => event.type)).toEqual(['token.created']);
      expect(events[0]?.data).toMatchObject({
        agentId: bot.id,
        prefix: made.token.prefix,
        scopes: ['cards:read'],
        projectIds: [w.app.id, w.web.id],
        workspaceWide: false,
      });
      const log = JSON.stringify(await eventsOf(t, 'acme'));
      expect(log).not.toContain(made.value);
      expect(log).not.toContain(sha256(made.value));
    });

    it('lets an Owner or Admin set workspaceWide', async () => {
      const made = await makeToken(w.admin, bot.id, { workspaceWide: true });
      expect(made.token.workspaceWide).toBe(true);
    });

    it('refuses a token with no project (400) or a project of another workspace (422)', async () => {
      const path = `/api/v1/agents/${bot.id}/tokens`;
      const base = { name: 'CI', scopes: ['cards:read'] };
      expect((await t.post(path, { ...base, projectIds: [] }, w.owner)).status).toBe(400);
      const globexProject = await bodyOf<Project>(
        await t.post(
          '/api/v1/workspaces/globex/projects',
          { name: 'Elsewhere', key: 'ELS', slug: 'elsewhere' },
          w.owner,
        ),
      );
      const response = await t.post(path, { ...base, projectIds: [globexProject.id] }, w.owner);
      expect(response.status).toBe(422);
    });

    it('refuses a scope that is not on the scope list, whoever asks', async () => {
      for (const scope of ['assets:approve', 'admin', 'members:manage']) {
        const response = await t.post(
          `/api/v1/agents/${bot.id}/tokens`,
          { name: 'CI', scopes: [scope], projectIds: [w.app.id] },
          w.owner,
        );
        expect(response.status).toBe(400);
      }
    });

    it('refuses a time to expire that has passed with 422', async () => {
      const response = await t.post(
        `/api/v1/agents/${bot.id}/tokens`,
        {
          name: 'CI',
          scopes: ['cards:read'],
          projectIds: [w.app.id],
          expiresAt: '2020-01-01T00:00:00.000Z',
        },
        w.owner,
      );
      expect(response.status).toBe(422);
    });

    it('takes no Idempotency-Key, because its answer is kept nowhere', async () => {
      const response = await t.request('POST', `/api/v1/agents/${bot.id}/tokens`, {
        as: w.owner,
        json: { name: 'CI', scopes: ['cards:read'], projectIds: [w.app.id] },
        headers: { 'idempotency-key': 'once' },
      });
      expect(response.status).toBe(400);
    });

    it('refuses a token for an archived project with 409, and for a disabled agent with 409', async () => {
      const project = await bodyOf<Project>(
        await t.post(
          '/api/v1/workspaces/acme/projects',
          { name: 'Old', key: 'OLD', slug: 'old' },
          w.owner,
        ),
      );
      expect(
        (await t.post(`/api/v1/workspaces/acme/projects/old/archive`, {}, w.owner)).status,
      ).toBe(200);
      const archived = await t.post(
        `/api/v1/agents/${bot.id}/tokens`,
        { name: 'CI', scopes: ['cards:read'], projectIds: [project.id] },
        w.owner,
      );
      expect(archived.status).toBe(409);

      const retired = await makeAgent(w.owner, 'retired');
      expect(
        (await t.patch(`/api/v1/agents/${retired.id}`, { disabled: true }, w.owner)).status,
      ).toBe(200);
      const refused = await t.post(
        `/api/v1/agents/${retired.id}/tokens`,
        { name: 'CI', scopes: ['cards:read'], projectIds: [w.app.id] },
        w.owner,
      );
      expect(refused.status).toBe(409);
    });
  });

  describe('PATCH /agents/:id', () => {
    it('renames an agent and changes its owner, with agent.updated', async () => {
      const agent = await makeAgent(w.owner, 'renamed-later');
      const response = await t.patch(
        `/api/v1/agents/${agent.id}`,
        { name: 'renamed-now', ownerUserId: w.ids.admin },
        w.admin,
      );
      expect(response.status).toBe(200);
      expect(await bodyOf<Agent>(response)).toMatchObject({
        name: 'renamed-now',
        ownerUserId: w.ids.admin,
      });
      const events = await eventsOfRequest(response);
      expect(events.map((event) => event.type)).toEqual(['agent.updated']);
      expect(events[0]?.data).toEqual({
        name: ['renamed-later', 'renamed-now'],
        ownerUserId: [w.ids.owner, w.ids.admin],
      });
    });

    it('refuses an empty patch with 400, and a Member with the one 404', async () => {
      expect((await t.patch(`/api/v1/agents/${bot.id}`, {}, w.owner)).status).toBe(400);
      expect((await t.patch(`/api/v1/agents/${bot.id}`, { name: 'x-y' }, w.member)).status).toBe(
        404,
      );
    });

    it('disabling an agent stops its tokens, and writes agent.disabled once', async () => {
      const agent = await makeAgent(w.owner, 'to-disable');
      const made = await makeToken(w.owner, agent.id);
      expect((await bearer(made.value, 'GET', '/api/v1/workspaces/acme/stream')).status).toBe(200);
      const response = await t.patch(`/api/v1/agents/${agent.id}`, { disabled: true }, w.owner);
      expect((await eventsOfRequest(response)).map((event) => event.type)).toEqual([
        'agent.disabled',
      ]);
      const again = await t.patch(`/api/v1/agents/${agent.id}`, { disabled: true }, w.owner);
      expect(await eventsOfRequest(again)).toEqual([]);
      expect((await bearer(made.value, 'GET', '/api/v1/workspaces/acme/stream')).status).toBe(401);
    });
  });

  describe('DELETE /tokens/:id', () => {
    it('a revoked token gets 401, and revoking twice is the one 404', async () => {
      const made = await makeToken(w.owner, bot.id);
      const response = await t.delete(`/api/v1/tokens/${made.token.id}`, w.admin);
      expect(response.status).toBe(200);
      expect((await bodyOf<AgentToken>(response)).revokedAt).not.toBeNull();
      expect((await eventsOfRequest(response)).map((event) => event.type)).toEqual([
        'token.revoked',
      ]);
      expect((await bearer(made.value, 'GET', '/api/v1/workspaces/acme/stream')).status).toBe(401);
      expect((await t.delete(`/api/v1/tokens/${made.token.id}`, w.admin)).status).toBe(404);
    });

    it('a token outside the caller’s workspaces is the one 404', async () => {
      expect((await t.delete(`/api/v1/tokens/${botToken.token.id}`, w.stranger)).status).toBe(404);
      expect((await t.delete(`/api/v1/tokens/${botToken.token.id}`, w.member)).status).toBe(404);
    });
  });

  describe('a request with an agent token', () => {
    it('is the agent, and records when the token was last used', async () => {
      const response = await bearer(botToken.value, 'GET', '/api/v1/workspaces/acme/stream');
      expect(response.status).toBe(200);
      await response.body?.cancel();
      const tokens = await bodyOf<AgentToken[]>(
        await t.get(`/api/v1/agents/${bot.id}/tokens`, w.owner),
      );
      expect(tokens.find((token) => token.id === botToken.token.id)?.lastUsedAt).not.toBeNull();
    });

    it('an unknown, a malformed or a missing token gets 401', async () => {
      for (const value of ['tk_' + 'a'.repeat(43), 'tk_short', 'not a token']) {
        const response = await bearer(value, 'GET', '/api/v1/workspaces/acme/stream');
        expect(response.status).toBe(401);
        expect((await errorOf(response)).code).toBe('unauthorized');
      }
    });

    it('an expired token gets 401', async () => {
      const made = await makeToken(w.owner, bot.id, {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect((await bearer(made.value, 'GET', '/api/v1/workspaces/acme/stream')).status).toBe(200);
      await queryRows(
        t.test.db,
        sql`update agent_tokens set expires_at = now() - interval '1 second' where id = ${made.token.id}::uuid returning id`,
      );
      expect((await bearer(made.value, 'GET', '/api/v1/workspaces/acme/stream')).status).toBe(401);
    });

    it('a token of one workspace finds nothing in another', async () => {
      const response = await bearer(botToken.value, 'GET', '/api/v1/workspaces/globex/stream');
      expect(response.status).toBe(404);
      expect(await errorOf(response)).toEqual({
        code: 'not_found',
        message: 'There is nothing at this address.',
      });
    });

    it('a project that is not on the token is the one 404, also for a write, which is recorded', async () => {
      const token = await freshToken();
      const onWeb = await bearer(
        token.value,
        'PUT',
        `/api/v1/workspaces/acme/projects/web/members/${w.ids.viewer}`,
        { role: 'member' },
      );
      expect(onWeb.status).toBe(404);
      expect(await errorOf(onWeb)).toEqual({
        code: 'not_found',
        message: 'There is nothing at this address.',
      });
      const recorded = await eventsOfRequest(onWeb);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        type: 'access.denied',
        projectId: w.web.id,
        tokenId: token.token.id,
        subject: { type: 'token', id: token.token.id },
        data: { action: 'member.manage', rule: 'R11', answer: 'not_found' },
      });
      // A read out of reach is the same 404 and is not recorded (R25 is about writes).
      const read = await bearer(
        token.value,
        'GET',
        `/api/v1/workspaces/acme/projects/web/members/${w.ids.viewer}`,
      );
      expect(read.status).toBe(404);
      expect(await eventsOfRequest(read)).toEqual([]);
      // An address no project has is the same 404, and there is nothing to record.
      const nowhere = await bearer(
        token.value,
        'PATCH',
        '/api/v1/workspaces/acme/projects/zz-nothing',
        {
          name: 'X',
        },
      );
      expect(nowhere.status).toBe(404);
      expect(await eventsOfRequest(nowhere)).toEqual([]);

      const onApp = await bearer(
        token.value,
        'PUT',
        `/api/v1/workspaces/acme/projects/app/members/${w.ids.viewer}`,
        { role: 'member' },
      );
      expect(onApp.status).toBe(403);
      expect((await errorOf(onApp)).rule).toBe('R20');
    });

    it('no scope reads the workspace or its projects', async () => {
      for (const path of [
        '/api/v1/workspaces/acme',
        '/api/v1/workspaces/acme/projects',
        '/api/v1/workspaces/acme/projects/app',
      ]) {
        const response = await bearer(botToken.value, 'GET', path);
        expect(response.status).toBe(403);
        expect((await errorOf(response)).rule).toBe('R12');
      }
      // The account routes are a person's.
      expect((await bearer(botToken.value, 'GET', '/api/v1/me')).status).toBe(403);
      expect((await bearer(botToken.value, 'GET', '/api/v1/workspaces')).status).toBe(403);
    });

    it.each([
      ['/api/v1/workspaces/acme/members', 'R13'],
      ['/api/v1/workspaces/acme/events', 'R13'],
      ['/api/v1/workspaces/acme/events/export', 'R13'],
      ['/api/v1/workspaces/acme/agents', 'R13'],
      ['/api/v1/workspaces/acme/invitations', 'R20'],
    ])('a read only a person may do, GET %s, is refused naming %s', async (path, rule) => {
      const response = await bearer(botToken.value, 'GET', path);
      expect(response.status).toBe(403);
      expect((await errorOf(response)).rule).toBe(rule);
      // A read that is refused writes nothing (R25 is about writes).
      expect(await eventsOfRequest(response)).toEqual([]);
    });

    const writes = (): [string, string, string, unknown, string][] => [
      [
        'POST',
        '/api/v1/workspaces',
        'workspace.create',
        { name: 'Mine', slug: 'mine', handle: 'me' },
        'R44',
      ],
      ['PATCH', '/api/v1/workspaces/acme', 'workspace.update', { name: 'Taken' }, 'R13'],
      ['DELETE', '/api/v1/workspaces/acme', 'workspace.delete', undefined, 'R13'],
      [
        'POST',
        '/api/v1/workspaces/acme/transfer',
        'workspace.transfer',
        { userId: w.ids.admin },
        'R13',
      ],
      [
        'POST',
        '/api/v1/workspaces/acme/projects',
        'project.create',
        { name: 'X', key: 'XX', slug: 'xx' },
        'R13',
      ],
      ['PATCH', '/api/v1/workspaces/acme/projects/app', 'project.update', { name: 'Y' }, 'R13'],
      ['POST', '/api/v1/workspaces/acme/projects/app/archive', 'project.archive', {}, 'R13'],
      [
        'PATCH',
        `/api/v1/workspaces/acme/members/${w.ids.viewer}`,
        'member.manage',
        { role: 'admin' },
        'R20',
      ],
      [
        'DELETE',
        `/api/v1/workspaces/acme/members/${w.ids.viewer}`,
        'member.manage',
        undefined,
        'R20',
      ],
      [
        'POST',
        '/api/v1/workspaces/acme/invitations',
        'member.manage',
        { email: 'x@example.com', role: 'viewer' },
        'R20',
      ],
      [
        'POST',
        '/api/v1/workspaces/acme/agents',
        'agent.manage',
        { name: 'spawned', kind: 'other' },
        'R20',
      ],
      ['PATCH', `/api/v1/agents/${bot.id}`, 'agent.manage', { name: 'renamed' }, 'R20'],
      [
        'POST',
        `/api/v1/agents/${bot.id}/tokens`,
        'agent.manage',
        { name: 'More', scopes: ['cards:read'], projectIds: [w.app.id] },
        'R20',
      ],
      ['DELETE', `/api/v1/tokens/${botToken.token.id}`, 'agent.manage', undefined, 'R20'],
    ];

    it('every write it may not do is refused with 403, and access.denied names the action and the rule', async () => {
      for (const [method, path, action, json, rule] of writes()) {
        const token = await freshToken();
        const response = await bearer(token.value, method, path, json);
        expect(response.status, `${method} ${path}`).toBe(403);
        expect((await errorOf(response)).rule, `${method} ${path}`).toBe(rule);
        const events = await eventsOfRequest(response);
        expect(events, `${method} ${path}`).toHaveLength(1);
        expect(events[0]).toMatchObject({
          type: 'access.denied',
          actor: { kind: 'agent', id: bot.id, name: bot.name },
          via: 'rest',
          tokenId: token.token.id,
          subject: { type: 'token', id: token.token.id },
          data: { action, rule, answer: 'forbidden', repeats: 0 },
        });
      }
    });

    it('accepting an invitation is a person’s, and an agent that tries is recorded', async () => {
      const token = await freshToken();
      const response = await bearer(token.value, 'POST', '/api/v1/invitations/accept', {
        token: 'a'.repeat(43),
      });
      expect(response.status).toBe(403);
      expect((await errorOf(response)).rule).toBe('R13');
      const events = await eventsOfRequest(response);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'access.denied',
        projectId: null,
        subject: { type: 'token', id: token.token.id },
        data: { action: 'invitation.accept', rule: 'R13', answer: 'forbidden' },
      });
    });

    it('an agent cannot revoke its own token, which goes on working', async () => {
      const response = await bearer(
        botToken.value,
        'DELETE',
        `/api/v1/tokens/${botToken.token.id}`,
      );
      expect(response.status).toBe(403);
      expect((await bearer(botToken.value, 'GET', '/api/v1/workspaces/acme/stream')).status).toBe(
        200,
      );
    });

    it('a refused write by an agent through the CLI is recorded as via cli', async () => {
      const token = await freshToken();
      const response = await bearer(
        token.value,
        'POST',
        '/api/v1/workspaces/acme/projects',
        { name: 'Z', key: 'ZZ', slug: 'zz' },
        { 'user-agent': 'turnkeel/0.0.0' },
      );
      expect(response.status).toBe(403);
      expect((await eventsOfRequest(response))[0]?.via).toBe('cli');
    });

    it('is never read as a person, whatever cookie it also carries', async () => {
      const response = await t.request('GET', '/api/v1/workspaces/acme/members', {
        as: w.owner,
        headers: { authorization: `Bearer ${botToken.value}` },
      });
      expect(response.status).toBe(403);
      expect((await errorOf(response)).rule).toBe('R13');
    });

    it('a token of a deleted workspace gets 401', async () => {
      const response = await t.post(
        '/api/v1/workspaces',
        { name: 'Short Lived', slug: 'short-lived', handle: 'olive' },
        w.owner,
      );
      expect(response.status).toBe(201);
      const projectResponse = await t.post(
        '/api/v1/workspaces/short-lived/projects',
        { name: 'P', key: 'PP', slug: 'pp' },
        w.owner,
      );
      const project = await bodyOf<Project>(projectResponse);
      const agentResponse = await t.post(
        '/api/v1/workspaces/short-lived/agents',
        { name: 'brief', kind: 'other' },
        w.owner,
      );
      const agent = await bodyOf<Agent>(agentResponse);
      const made = await bodyOf<CreateTokenResponse>(
        await t.post(
          `/api/v1/agents/${agent.id}/tokens`,
          { name: 'CI', scopes: ['cards:read'], projectIds: [project.id] },
          w.owner,
        ),
      );
      expect(
        (await bearer(made.value, 'GET', '/api/v1/workspaces/short-lived/stream')).status,
      ).toBe(200);
      expect((await t.delete('/api/v1/workspaces/short-lived', w.owner)).status).toBe(200);
      expect(
        (await bearer(made.value, 'GET', '/api/v1/workspaces/short-lived/stream')).status,
      ).toBe(401);
    });
  });

  describe('who reads the events of agents and tokens', () => {
    it('the event list shows them to an Admin and to nobody without agent.read', async () => {
      const page = await bodyOf<EventPage>(
        await t.get('/api/v1/workspaces/acme/events?area=agents&limit=200', w.admin),
      );
      const types = new Set(page.items.map((event) => event.type));
      expect(types).toContain('agent.created');
      expect(types).toContain('token.created');
      expect(types).toContain('access.denied');

      for (const who of ['member', 'reviewer', 'viewer'] as const) {
        const all = await bodyOf<EventPage>(
          await t.get('/api/v1/workspaces/acme/events?limit=200', w[who]),
        );
        expect(all.items.filter((event) => event.type.startsWith('agent.'))).toEqual([]);
        expect(
          all.items.filter((event) => ['token.created', 'access.denied'].includes(event.type)),
        ).toEqual([]);
      }
    });

    it('an agent’s stream carries no event about people, agents or projects', async () => {
      const agentStream = await openAgentStream(botToken.value);
      try {
        await makeAgent(w.owner, 'unseen');
        await t.patch('/api/v1/workspaces/acme/projects/web', { name: 'Web two' }, w.owner);
        // Its own project too: no scope reads a project as such.
        await t.patch('/api/v1/workspaces/acme/projects/app', { name: 'App two' }, w.owner);
        expect(await agentStream.quiet(500)).toBe(true);
      } finally {
        await agentStream.close();
      }
    });

    it('a stream opened with a token ends when the token is revoked', async () => {
      const made = await makeToken(w.owner, bot.id);
      const agentStream = await openAgentStream(made.value);
      expect((await t.delete(`/api/v1/tokens/${made.token.id}`, w.owner)).status).toBe(200);
      await agentStream.ended();
    });

    it('a stream opened with a token ends at once when its agent is disabled', async () => {
      const agent = await makeAgent(w.owner, 'soon-disabled');
      const made = await makeToken(w.owner, agent.id);
      const agentStream = await openAgentStream(made.value);
      expect((await agentStream.next()).comment).toBe('connected');
      expect(
        (await t.patch(`/api/v1/agents/${agent.id}`, { disabled: true }, w.owner)).status,
      ).toBe(200);
      // Well within the minute between two looks at the token.
      await agentStream.ended(5000);
    });
  });

  describe('when the person who made a token leaves, or stops managing agents', () => {
    it('removing a person revokes the tokens they made and gives their agents to whoever removed them, in one request', async () => {
      const leaver = await t.join(w.owner, 'acme', 'lee@example.com', 'admin', {
        name: 'Lee Leaver',
      });
      const leaverId = (await bodyOf<{ user: { id: string } }>(await t.get('/api/v1/me', leaver)))
        .user.id;
      const theirs = await makeAgent(leaver, 'lees-agent');
      expect(theirs.ownerUserId).toBe(leaverId);
      const onTheirs = await makeToken(leaver, theirs.id);
      const onBot = await makeToken(leaver, bot.id);
      // A token someone else made on the leaver's agent stays.
      const byOwner = await makeToken(w.owner, theirs.id);
      for (const made of [onTheirs, onBot, byOwner]) {
        expect((await bearer(made.value, 'GET', '/api/v1/workspaces/acme/stream')).status).toBe(
          200,
        );
      }

      const response = await t.delete(`/api/v1/workspaces/acme/members/${leaverId}`, w.admin);
      expect(response.status).toBe(204);
      const events = await eventsOfRequest(response);
      expect(events.map((event) => event.type).sort()).toEqual([
        'agent.updated',
        'member.removed',
        'token.revoked',
        'token.revoked',
      ]);
      const revoked = events.filter((event) => event.type === 'token.revoked');
      expect(revoked.map((event) => event.subject.id).sort()).toEqual(
        [onTheirs.token.id, onBot.token.id].sort(),
      );
      for (const event of revoked) {
        expect(event.data).toMatchObject({ reason: 'member_removed' });
        expect(event.actor.id).toBe(w.ids.admin);
      }
      expect(events.find((event) => event.type === 'agent.updated')).toMatchObject({
        subject: { type: 'agent', id: theirs.id },
        data: { ownerUserId: [leaverId, w.ids.admin] },
      });

      expect((await bearer(onTheirs.value, 'GET', '/api/v1/workspaces/acme/stream')).status).toBe(
        401,
      );
      expect((await bearer(onBot.value, 'GET', '/api/v1/workspaces/acme/stream')).status).toBe(401);
      const kept = await bearer(byOwner.value, 'GET', '/api/v1/workspaces/acme/stream');
      expect(kept.status).toBe(200);
      await kept.body?.cancel();
      const list = await bodyOf<AgentWithTokens[]>(
        await t.get('/api/v1/workspaces/acme/agents', w.owner),
      );
      expect(list.find((entry) => entry.agent.id === theirs.id)?.agent.ownerUserId).toBe(
        w.ids.admin,
      );
    });

    it('a person who leaves by removing themselves hands their agents to an Owner', async () => {
      const leaver = await t.join(w.owner, 'acme', 'sol@example.com', 'admin', {
        name: 'Sol Self',
      });
      const leaverId = (await bodyOf<{ user: { id: string } }>(await t.get('/api/v1/me', leaver)))
        .user.id;
      const theirs = await makeAgent(leaver, 'sols-agent');
      const response = await t.delete(`/api/v1/workspaces/acme/members/${leaverId}`, leaver);
      expect(response.status).toBe(204);
      expect(
        (await eventsOfRequest(response)).find((event) => event.type === 'agent.updated'),
      ).toMatchObject({
        subject: { type: 'agent', id: theirs.id },
        data: { ownerUserId: [leaverId, w.ids.owner] },
      });
    });

    it('a role without agent.manage revokes the tokens the person made, and Owner or Admin keeps them', async () => {
      const keeper = await t.join(w.owner, 'acme', 'kim@example.com', 'admin', {
        name: 'Kim Keeper',
      });
      const keeperId = (await bodyOf<{ user: { id: string } }>(await t.get('/api/v1/me', keeper)))
        .user.id;
      const made = await makeToken(keeper, bot.id);

      // Admin to Owner: still manages agents, so the token stays.
      const raised = await t.patch(
        `/api/v1/workspaces/acme/members/${keeperId}`,
        { role: 'owner' },
        w.owner,
      );
      expect(raised.status).toBe(200);
      expect((await eventsOfRequest(raised)).map((event) => event.type)).toEqual([
        'member.role_changed',
      ]);

      const lowered = await t.patch(
        `/api/v1/workspaces/acme/members/${keeperId}`,
        { role: 'member' },
        w.owner,
      );
      expect(lowered.status).toBe(200);
      const events = await eventsOfRequest(lowered);
      expect(events.map((event) => event.type)).toEqual(['member.role_changed', 'token.revoked']);
      expect(events[1]).toMatchObject({
        subject: { type: 'token', id: made.token.id },
        data: { reason: 'role_changed', prefix: made.token.prefix },
      });
      expect((await bearer(made.value, 'GET', '/api/v1/workspaces/acme/stream')).status).toBe(401);
    });
  });

  /** The stream, opened with a bearer token. `openStream` takes the request from the harness. */
  async function openAgentStream(value: string, workspace = 'acme') {
    const withToken: TestServer['request'] = (method, path, options = {}) =>
      t.request(method, path, {
        ...options,
        headers: { ...options.headers, authorization: `Bearer ${value}` },
      });
    return openStream({ ...t, request: withToken }, workspace, undefined);
  }
});

describe.each(testEngines)('agent tokens in local mode on %s', (engine) => {
  let t: TestServer;
  let owner: Session;

  beforeAll(async () => {
    t = await createTestServer(engine, { mode: 'local' });
    owner = await t.localSession();
  }, 120_000);
  afterAll(async () => {
    await t.stop();
  }, 60_000);

  it('a request without the local cookie needs an agent token, and one works', async () => {
    const project = await bodyOf<Project>(
      await t.post(
        '/api/v1/workspaces/my-workspace/projects',
        { name: 'App', key: 'APP', slug: 'app' },
        owner,
      ),
    );
    const agent = await bodyOf<Agent>(
      await t.post(
        '/api/v1/workspaces/my-workspace/agents',
        { name: 'local', kind: 'cursor' },
        owner,
      ),
    );
    const made = await bodyOf<CreateTokenResponse>(
      await t.post(
        `/api/v1/agents/${agent.id}/tokens`,
        { name: 'CLI', scopes: ['cards:read'], projectIds: [project.id] },
        owner,
      ),
    );
    expect((await t.get('/api/v1/workspaces/my-workspace/stream')).status).toBe(401);
    const response = await t.request('GET', '/api/v1/workspaces/my-workspace/stream', {
      headers: { authorization: `Bearer ${made.value}` },
    });
    expect(response.status).toBe(200);
    await response.body?.cancel();
    // R13 holds in local mode as on a server.
    const refused = await t.request('GET', '/api/v1/workspaces/my-workspace/members', {
      headers: { authorization: `Bearer ${made.value}` },
    });
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).rule).toBe('R13');
  });
});

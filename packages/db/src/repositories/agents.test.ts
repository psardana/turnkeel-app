import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findAgentTokenByHash, findAgentTokenById } from '../directory.js';
import { ConflictError } from '../errors.js';
import { toAgent, toAgentToken } from '../rows.js';
import { workspaceScope } from '../scope.js';
import {
  createTestDatabase,
  createTestWorkspace,
  testEngines,
  type TestDatabase,
  type TestWorkspace,
} from '../testing/index.js';
import { repositories } from './index.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe.each(testEngines)('agents and their tokens on %s', (engine) => {
  let test: TestDatabase;
  let acme: TestWorkspace;
  let projectId: string;

  const reposOf = (workspaceId: string) => repositories(test.db, workspaceScope(workspaceId));

  beforeAll(async () => {
    test = await createTestDatabase(engine);
    acme = await createTestWorkspace(test.db);
    projectId = await test.db.transaction(
      async (tx) =>
        (
          await repositories(tx, workspaceScope(acme.workspace.id)).projects.create(
            { name: 'App', key: 'APP', slug: 'app', kind: 'app' },
            { by: acme.by },
          )
        ).id,
    );
  });

  afterAll(async () => {
    await test.destroy();
  });

  async function newAgent(name: string) {
    return reposOf(acme.workspace.id).agents.create(
      { name, kind: 'claude-code', ownerUserId: acme.owner.id },
      { by: acme.by },
    );
  }

  async function newToken(agentId: string, value: string, extra: { projectIds?: string[] } = {}) {
    return reposOf(acme.workspace.id).agentTokens.create(
      {
        agentId,
        name: 'CI',
        prefix: value.slice(0, 10),
        hash: hash(value),
        scopes: ['cards:read'],
        projectIds: extra.projectIds ?? [projectId],
        workspaceWide: false,
        expiresAt: null,
      },
      { by: acme.by },
    );
  }

  it('makes an agent, and reads it back in the shape of the protocol', async () => {
    const agent = await newAgent('board-keeper');
    expect(agentSchema.parse(toAgent(agent))).toMatchObject({
      name: 'board-keeper',
      kind: 'claude-code',
      ownerUserId: acme.owner.id,
      disabledAt: null,
    });
    expect((await reposOf(acme.workspace.id).agents.list()).map((row) => row.id)).toContain(
      agent.id,
    );
  });

  it('keeps agent names unique in the workspace without regard to case', async () => {
    await newAgent('release-bot');
    await expect(newAgent('Release-Bot')).rejects.toBeInstanceOf(ConflictError);
    const other = await createTestWorkspace(test.db);
    await expect(
      reposOf(other.workspace.id).agents.create(
        { name: 'release-bot', kind: 'script', ownerUserId: other.owner.id },
        { by: other.by },
      ),
    ).resolves.toMatchObject({ name: 'release-bot' });
  });

  it('stores the hash of a token and never the token, and finds it by the hash', async () => {
    const agent = await newAgent('hash-keeper');
    const value = `tk_${randomUUID()}`;
    const token = await newToken(agent.id, value);
    expect(Object.values(token)).not.toContain(value);
    const shown = agentTokenSchema.parse(toAgentToken(token));
    expect(shown).not.toHaveProperty('hash');
    expect(JSON.stringify(shown)).not.toContain(hash(value));

    const found = await findAgentTokenByHash(test.db, hash(value));
    expect(found?.token.id).toBe(token.id);
    expect(found?.agent.id).toBe(agent.id);
    expect(found?.workspace.id).toBe(acme.workspace.id);
    expect(await findAgentTokenByHash(test.db, hash('tk_nobody'))).toBeNull();
    expect((await findAgentTokenById(test.db, token.id))?.token.hash).toBe(hash(value));
  });

  it('refuses a token that names no project', async () => {
    const agent = await newAgent('no-projects');
    await expect(newToken(agent.id, `tk_${randomUUID()}`, { projectIds: [] })).rejects.toThrow();
  });

  it('revokes a token once, and disables an agent once', async () => {
    const agent = await newAgent('revoker');
    const token = await newToken(agent.id, `tk_${randomUUID()}`);
    const repos = reposOf(acme.workspace.id);
    expect((await repos.agentTokens.revoke(token.id, { by: acme.by }))?.revokedAt).not.toBeNull();
    expect(await repos.agentTokens.revoke(token.id, { by: acme.by })).toBeNull();
    expect((await repos.agents.disable(agent.id, { by: acme.by }))?.disabledAt).not.toBeNull();
    expect(await repos.agents.disable(agent.id, { by: acme.by })).toBeNull();
  });

  it('writes the last use at most once a minute, and moves nothing else', async () => {
    const agent = await newAgent('user-of-tokens');
    const token = await newToken(agent.id, `tk_${randomUUID()}`);
    const repos = reposOf(acme.workspace.id);
    const first = new Date('2026-11-11T10:00:00Z');
    await repos.agentTokens.markUsed(token.id, first);
    await repos.agentTokens.markUsed(token.id, new Date('2026-11-11T10:00:30Z'));
    let row = await repos.agentTokens.get(token.id);
    expect(row?.lastUsedAt?.toISOString()).toBe(first.toISOString());
    expect(row?.updatedAt.toISOString()).toBe(token.updatedAt.toISOString());
    await repos.agentTokens.markUsed(token.id, new Date('2026-11-11T10:02:00Z'));
    row = await repos.agentTokens.get(token.id);
    expect(row?.lastUsedAt?.toISOString()).toBe('2026-11-11T10:02:00.000Z');
  });

  it('a token of a deleted workspace is found nowhere', async () => {
    const gone = await createTestWorkspace(test.db);
    const repos = reposOf(gone.workspace.id);
    const project = await test.db.transaction((tx) =>
      repositories(tx, workspaceScope(gone.workspace.id)).projects.create(
        { name: 'Gone', key: 'GONE', slug: 'gone', kind: 'web' },
        { by: gone.by },
      ),
    );
    const agent = await repos.agents.create(
      { name: 'ghost', kind: 'other', ownerUserId: gone.owner.id },
      { by: gone.by },
    );
    const value = `tk_${randomUUID()}`;
    await repos.agentTokens.create(
      {
        agentId: agent.id,
        name: 'CI',
        prefix: value.slice(0, 10),
        hash: hash(value),
        scopes: ['cards:read'],
        projectIds: [project.id],
        workspaceWide: false,
        expiresAt: null,
      },
      { by: gone.by },
    );
    await test.db.transaction(async (tx) => {
      await repositories(tx, workspaceScope(gone.workspace.id)).workspace.markDeleted({
        by: gone.by,
      });
    });
    expect(await findAgentTokenByHash(test.db, hash(value))).toBeNull();
  });

  it('keeps one workspace’s tokens out of another’s lists', async () => {
    const other = await createTestWorkspace(test.db);
    const tokens = await reposOf(other.workspace.id).agentTokens.list();
    expect(tokens).toEqual([]);
    const agents = await reposOf(other.workspace.id).agents.list();
    expect(agents).toEqual([]);
  });

  it('lists the agents a person owns and the tokens a person made that still work', async () => {
    const repos = reposOf(acme.workspace.id);
    const agent = await newAgent('made-by-owner');
    const kept = await newToken(agent.id, `tk_${randomUUID()}`);
    const gone = await newToken(agent.id, `tk_${randomUUID()}`);
    await repos.agentTokens.revoke(gone.id, { by: acme.by });

    const made = (await repos.agentTokens.listActiveCreatedBy(acme.owner.id)).map((t) => t.id);
    expect(made).toContain(kept.id);
    expect(made).not.toContain(gone.id);
    expect(await repos.agentTokens.listActiveCreatedBy(randomUUID())).toEqual([]);
    expect((await repos.agents.listOwnedBy(acme.owner.id)).map((a) => a.id)).toContain(agent.id);
    expect(await repos.agents.listOwnedBy(randomUUID())).toEqual([]);
  });
});

import { can, tokenUsable } from '@turnkeel/core';
import { toAgent, toAgentToken, type AgentRow, type Repositories } from '@turnkeel/db';
import type {
  Agent,
  AgentToken,
  AgentWithTokens,
  CreateAgentRequest,
  CreateTokenRequest,
  CreateTokenResponse,
  UpdateAgentRequest,
  UpdateTokenRequest,
} from '@turnkeel/protocol';
import { newAgentToken } from '../auth/agent-tokens.js';
import { HttpError, notFound } from '../http/errors.js';
import { messages } from '../messages.js';
import { authorize, idOr404, openWorkspace, openWorkspaceById, reposOf } from './access.js';
import { liveWorkspace } from './workspaces.js';

/**
 * Agents and their tokens (section 8, "Agents"). Every action here is
 * `agent.read` or `agent.manage`, which only an Owner or an Admin holds and no agent
 * token can. A token is shown once, in the answer that made it; the database
 * keeps its hash, and no event holds either.
 */

/** `GET /workspaces/:ws/agents`, under `agent.read`: each agent with its tokens. */
export async function listAgents(ctx: ServiceContext, slug: string): Promise<AgentWithTokens[]> {
  const workspace = await openWorkspace(ctx, slug);
  await authorize(ctx, 'agent.read', { workspaceId: workspace.id });
  const repos = reposOf(ctx.db, workspace.id);
  const tokens = await repos.agentTokens.list();
  return (await repos.agents.list()).map((agent) => ({
    agent: toAgent(agent),
    tokens: tokens.filter((token) => token.agentId === agent.id).map(toAgentToken),
  }));
}

/** The owner of an agent is a member of the workspace: the person its sessions wait on. */
async function assertOwner(repos: Repositories, userId: string): Promise<void> {
  if (!(await repos.members.get(userId))) {
    throw new HttpError('unprocessable', messages.errors.agentOwnerNotMember);
  }
}

/**
 * `POST /workspaces/:ws/agents`, under `agent.manage`. The owner is the person who
 * creates the agent unless the request names another member.
 */
export async function createAgent(
  ctx: ServiceContext,
  slug: string,
  input: CreateAgentRequest,
): Promise<Agent> {
  const workspace = await openWorkspace(ctx, slug);
  await authorize(ctx, 'agent.manage', { workspaceId: workspace.id });
  const { user } = requirePerson(ctx);
  const ownerUserId = (input.ownerUserId ?? user.id).toLowerCase();

  return ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspace.id);
    await repos.workspace.lock();
    await liveWorkspace(await repos.workspace.get());
    await assertOwner(repos, ownerUserId);
    const agent = await repos.agents.create(
      { name: input.name, kind: input.kind, ownerUserId },
      stampOf(ctx),
    );
    await appendEvent(ctx, repos, {
      type: 'agent.created',
      subject: { type: 'agent', id: agent.id },
      data: { name: agent.name, kind: agent.kind, ownerUserId: agent.ownerUserId },
    });
    const body = toAgent(agent);
    await ctx.keyed?.save(tx, workspace.id, body);
    return body;
  });
}

/**
 * Finds an agent by its id, for a route that names it with no workspace. It is looked
 * for only in the workspaces where the caller holds `action`, so an id from anywhere
 * else is the one 404. An agent token is refused at once, in its own workspace.
 */
async function findAgent(
  ctx: ServiceContext,
  action: 'agent.read' | 'agent.manage',
  agentId: string,
): Promise<{ workspaceId: string; agent: AgentRow }> {
  const caller = ctx.caller.principal;
  if (caller.kind === 'agent') {
    await authorize(ctx, action, { workspaceId: caller.workspaceId });
  }
  const { principal } = requirePerson(ctx);
  for (const membership of principal.memberships) {
    const { workspaceId } = membership;
    if (!can(principal, action, { workspaceId }).allowed) continue;
    const agent = await reposOf(ctx.db, workspaceId).agents.get(agentId);
    if (agent) return { workspaceId, agent };
  }
  throw notFound();
}

/**
 * `PATCH /agents/:id`, under `agent.manage`: the name, the owner (an Owner or
 * an Admin changes it), or `disabled: true`, which stops every token of the agent.
 */
export async function updateAgent(
  ctx: ServiceContext,
  idParam: string,
  patch: UpdateAgentRequest,
): Promise<Agent> {
  const id = idOr404(idParam);
  const { workspaceId } = await findAgent(ctx, 'agent.manage', id);
  if (patch.name === undefined && patch.ownerUserId === undefined && patch.disabled === undefined) {
    throw new HttpError('bad_request', messages.errors.badBody(messages.errors.agentPatchEmpty));
  }

  return ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspaceId);
    await repos.workspace.lock();
    await liveWorkspace(await repos.workspace.get());
    let agent = await repos.agents.get(id);
    if (!agent) throw notFound();
    const stamp = stampOf(ctx);

    const ownerUserId = patch.ownerUserId?.toLowerCase();
    if (ownerUserId !== undefined && ownerUserId !== agent.ownerUserId) {
      await assertOwner(repos, ownerUserId);
    }
    const changes = changesOf(agent, { name: patch.name, ownerUserId });
    if (Object.keys(changes).length > 0) {
      agent =
        (await repos.agents.update(
          id,
          { name: patch.name, ownerUserId: ownerUserId ?? undefined },
          stamp,
        )) ?? agent;
      await appendEvent(ctx, repos, {
        type: 'agent.updated',
        subject: { type: 'agent', id },
        data: changes,
      });
    }

    if (patch.disabled === true && agent.disabledAt === null) {
      agent = (await repos.agents.disable(id, stamp)) ?? agent;
      await appendEvent(ctx, repos, {
        type: 'agent.disabled',
        subject: { type: 'agent', id },
        data: { name: agent.name },
      });
    }
    return toAgent(agent);
  });
}

/** `GET /agents/:id/tokens`, under `agent.read`: the agent's tokens, newest first, without their hashes. */
export async function listTokens(ctx: ServiceContext, idParam: string): Promise<AgentToken[]> {
  const id = idOr404(idParam);
  const { workspaceId } = await findAgent(ctx, 'agent.read', id);
  return (await reposOf(ctx.db, workspaceId).agentTokens.list(id)).map(toAgentToken);
}

/** Whether two lists of scopes hold the same scopes, in any order. */
function sameScopes(one: readonly AgentScope[], other: readonly AgentScope[]): boolean {
  return one.length === other.length && one.every((scope) => other.includes(scope));
}

/**
 * `POST /agents/:id/tokens`, under `agent.manage`. The token names at least one project
 * of the workspace and at least one scope; `workspaceWide` lets it reach objects that
 * have no project. An opt-in scope, such as `decisions:decide`, only an Owner gives.
 * With `preset` the token gets Reporter's or Builder's scopes and follows that
 * preset; without one it follows none. The answer carries the token itself, once.
 */
export async function createToken(
  ctx: ServiceContext,
  idParam: string,
  input: CreateTokenRequest,
): Promise<CreateTokenResponse> {
  const id = idOr404(idParam);
  const { workspaceId } = await findAgent(ctx, 'agent.manage', id);
  const scopes = scopesOfNewToken(input);
  if (scopes.length === 0) throw new HttpError('unprocessable', messages.errors.tokenNoScope);
  // R83: a scope that acts on a person's word is given only by an Owner, by name.
  if (scopes.some(isOptInScope)) {
    await authorize(ctx, 'agent.manage', { workspaceId, optInScopes: true });
  }
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt !== null && expiresAt.getTime() <= Date.now()) {
    throw new HttpError('unprocessable', messages.errors.tokenExpiryPast);
  }
  const projectIds = input.projectIds.map((projectId) => projectId.toLowerCase());

  // spend:commit only with a monthly cap, and a cap only with spend:commit.
  const spends = scopes.includes('spend:commit');
  if (spends && input.spendCap === undefined) {
    throw new HttpError('unprocessable', messages.errors.spendCapNeeded);
  }
  if (!spends && input.spendCap !== undefined) {
    throw new HttpError('unprocessable', messages.errors.spendCapWithoutScope);
  }

  return ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspaceId);
    await repos.workspace.lock();
    const workspace = await liveWorkspace(await repos.workspace.get());
    if (input.spendCap !== undefined && input.spendCap.currency !== workspace.baseCurrency) {
      throw new HttpError(
        'unprocessable',
        messages.errors.spendCapCurrency(workspace.baseCurrency),
      );
    }
    const agent = await repos.agents.get(id);
    if (!agent) throw notFound();
    if (agent.disabledAt !== null) throw new HttpError('conflict', messages.errors.agentDisabled);
    for (const projectId of projectIds) {
      const project = await repos.projects.get(projectId);
      if (!project) throw new HttpError('unprocessable', messages.errors.tokenProjectUnknown);
      if (project.archivedAt !== null) {
        throw new HttpError('project_archived', messages.errors.tokenProjectArchived);
      }
    }

    const minted = newAgentToken();
    const token = await repos.agentTokens.create(
      {
        agentId: id,
        name: input.name,
        prefix: minted.prefix,
        hash: minted.hash,
        scopes,
        projectIds,
        workspaceWide: input.workspaceWide ?? false,
        expiresAt,
        spendCap: input.spendCap ?? null,
        preset: input.preset ?? null,
      },
      stampOf(ctx),
    );
    // R48: the prefix, the scopes and the projects; never the token or its hash.
    await appendEvent(ctx, repos, {
      type: 'token.created',
      subject: { type: 'token', id: token.id },
      data: {
        agentId: id,
        name: token.name,
        prefix: token.prefix,
        scopes: token.scopes,
        projectIds: token.projectIds,
        workspaceWide: token.workspaceWide,
        expiresAt: token.expiresAt?.toISOString() ?? null,
        preset: token.preset,
        ...(input.spendCap === undefined ? {} : { spendCap: input.spendCap }),
      },
    });
    return { token: toAgentToken(token), value: minted.value };
  });
}

/**
 * `DELETE /tokens/:id`, under `agent.manage`. A revoked token stops working at once,
 * and an open stream with it ends. A token that is revoked already is the one 404.
 */
export async function revokeToken(ctx: ServiceContext, idParam: string): Promise<AgentToken> {
  const id = idOr404(idParam);
  const caller = ctx.caller.principal;
  if (caller.kind === 'agent') {
    // R20: not even its own token.
    await authorize(ctx, 'agent.manage', { workspaceId: caller.workspaceId });
  }
  const { principal } = requirePerson(ctx);

  for (const membership of principal.memberships) {
    const { workspaceId } = membership;
    if (!can(principal, 'agent.manage', { workspaceId }).allowed) continue;
    if (!(await reposOf(ctx.db, workspaceId).agentTokens.get(id))) continue;

    return ctx.db.transaction(async (tx) => {
      const repos = reposOf(tx, workspaceId);
      await repos.workspace.lock();
      await liveWorkspace(await repos.workspace.get());
      const revoked = await repos.agentTokens.revoke(id, stampOf(ctx));
      if (!revoked) throw notFound();
      await appendEvent(ctx, repos, {
        type: 'token.revoked',
        subject: { type: 'token', id },
        data: { agentId: revoked.agentId, name: revoked.name, prefix: revoked.prefix },
      });
      return toAgentToken(revoked);
    });
  }
  throw notFound();
}

/**
 * `PATCH /tokens/:id`: changes the token's standard scopes and turns its opt-in scopes on
 * and off. Only an Owner may (`agent.manage` with
 * `optInScopes`); an agent never, not even for its own token. The token's projects,
 * hash and value stay as made, so the agent keeps its token and its next call is checked
 * against the new scopes. A revoked or expired token is refused with 409, and so is one
 * whose agent is disabled. `preset` gives the token Reporter's or Builder's standard scopes
 * and makes it follow that preset; `scopes` without `preset` makes it follow none.
 * One `token.updated` event with the opt-in scopes before and after, and the standard
 * scopes and the preset before and after when they changed; none when nothing changes.
 */
export async function updateTokenScopes(
  ctx: ServiceContext,
  idParam: string,
  input: UpdateTokenRequest,
): Promise<AgentToken> {
  const id = idOr404(idParam);
  const caller = ctx.caller.principal;
  if (caller.kind === 'agent') {
    // R20: an agent changes no token, its own included.
    await authorize(ctx, 'agent.manage', { workspaceId: caller.workspaceId });
  }
  const { principal } = requirePerson(ctx);
  // With a preset, the standard scopes are the preset's.
  const wantedStandard =
    input.preset === undefined ? input.scopes : standardOfPreset(input.preset, input.scopes);

  for (const membership of principal.memberships) {
    const { workspaceId } = membership;
    if (!can(principal, 'agent.manage', { workspaceId }).allowed) continue;
    if (!(await reposOf(ctx.db, workspaceId).agentTokens.get(id))) continue;
    // R83: only an Owner turns an opt-in scope on or off.
    await authorize(ctx, 'agent.manage', { workspaceId, optInScopes: true });

    return ctx.db.transaction(async (tx) => {
      const repos = reposOf(tx, workspaceId);
      await repos.workspace.lock();
      const workspace = await liveWorkspace(await repos.workspace.get());
      const token = await repos.agentTokens.get(id);
      if (!token) throw notFound();
      const agent = await repos.agents.get(token.agentId);
      if (
        !agent ||
        !tokenUsable(
          { revokedAt: token.revokedAt, expiresAt: token.expiresAt },
          { disabledAt: agent.disabledAt },
          nowOf(ctx),
        )
      ) {
        throw new HttpError('conflict', messages.errors.tokenNotUsable);
      }
      const before = optInScopes.filter((scope) => token.scopes.includes(scope));
      const wanted = input.optInScopes;
      const after =
        wanted === undefined ? before : optInScopes.filter((scope) => wanted.includes(scope));
      const capBefore =
        token.spendCap === null || token.spendCapCurrency === null
          ? null
          : { amount: token.spendCap, currency: token.spendCapCurrency };
      const capAfter = input.spendCap ?? capBefore;
      // The cap is in the workspace's currency, and spend:commit needs one.
      if (input.spendCap !== undefined && input.spendCap.currency !== workspace.baseCurrency) {
        throw new HttpError(
          'unprocessable',
          messages.errors.spendCapCurrency(workspace.baseCurrency),
        );
      }
      // A cap goes with spend:commit only, as when a token is made: a token
      // that will not hold the scope gets no new cap. One it holds already is kept.
      if (input.spendCap !== undefined && !after.includes('spend:commit')) {
        throw new HttpError('unprocessable', messages.errors.spendCapWithoutScope);
      }
      const turnsOnSpend = after.includes('spend:commit') && !before.includes('spend:commit');
      if (after.includes('spend:commit') && capAfter === null) {
        throw new HttpError('unprocessable', messages.errors.spendCapNeeded);
      }
      if (turnsOnSpend && capAfter !== null && capAfter.currency !== workspace.baseCurrency) {
        throw new HttpError(
          'unprocessable',
          messages.errors.spendCapCurrency(workspace.baseCurrency),
        );
      }
      // The standard scopes, all of them from now on, when they are sent.
      const standardBefore = token.scopes.filter((scope) => !isOptInScope(scope));
      const standardAfter =
        wantedStandard === undefined
          ? standardBefore
          : standardScopes.filter((scope) => wantedStandard.includes(scope));
      const standardChanged =
        standardBefore.length !== standardAfter.length ||
        standardAfter.some((scope) => !standardBefore.includes(scope));
      const scopesChanged = JSON.stringify(before) !== JSON.stringify(after);
      const capChanged = JSON.stringify(capBefore) !== JSON.stringify(capAfter);
      // A preset makes the token follow it, a list of scopes alone follows none, and
      // a change of only the opt-in scopes or the cap keeps what the token follows.
      const presetBefore = presetOfRow(token.preset);
      const presetAfter = input.preset ?? (input.scopes === undefined ? presetBefore : null);
      const presetChanged = presetBefore !== presetAfter;
      if (!scopesChanged && !standardChanged && !capChanged && !presetChanged) {
        return toAgentToken(token);
      }
      const scopes = [...standardAfter, ...after];
      if (scopes.length === 0) throw new HttpError('unprocessable', messages.errors.tokenNoScope);
      const saved = await repos.agentTokens.setScopes(
        id,
        scopes,
        stampOf(ctx),
        capChanged && capAfter !== null ? capAfter : undefined,
        presetChanged ? presetAfter : undefined,
      );
      if (!saved) throw notFound();
      // R48: the names of scopes and the cap; never the token or its hash.
      await appendEvent(ctx, repos, {
        type: 'token.updated',
        subject: { type: 'token', id },
        data: {
          agentId: token.agentId,
          name: token.name,
          prefix: token.prefix,
          optInScopes: [before, after],
          ...(standardChanged ? { scopes: [standardBefore, standardAfter] } : {}),
          ...(presetChanged ? { preset: [presetBefore, presetAfter] } : {}),
          ...(capChanged ? { spendCap: [capBefore, capAfter] } : {}),
        },
      });
      return toAgentToken(saved);
    });
  }
  throw notFound();
}

/** Before the kept answer of `POST /workspaces/:ws/agents` is given again: `agent.manage` now. */
export async function checkKeptCreateAgent(
  ctx: ServiceContext,
  workspaceId: string,
): Promise<void> {
  const workspace = await openWorkspaceById(ctx, workspaceId);
  await authorize(ctx, 'agent.manage', { workspaceId: workspace.id });
}

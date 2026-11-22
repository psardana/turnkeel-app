import { can, canSignInWith, isKnownTimeZone, personPrincipal } from '@turnkeel/core';
import {
  countWorkspaces,
  createWorkspace,
  findUserById,
  listWorkspacesFor,
  membershipsOf,
  toWorkspace,
  type Transaction,
  type WorkspaceRow,
} from '@turnkeel/db';
import {
  inViewOrder,
  planningAtStart,
  tabsOffFor,
  type CreateWorkspaceRequest,
  type Me,
  type MyWorkspace,
  type TransferWorkspaceRequest,
  type UpdateWorkspaceRequest,
  type Workspace,
} from '@turnkeel/protocol';
import { sql } from 'drizzle-orm';
import { assertAllowed, HttpError, notFound } from '../http/errors.js';
import { messages } from '../messages.js';
import {
  afterValues,
  appendEvent,
  changesOf,
  requirePerson,
  stampOf,
  type ServiceContext,
} from './context.js';

/**
 * The lock under which a workspace is created: one for the whole server, held until
 * the transaction ends. It is what makes two first sign-ins at the same moment give
 * one Owner. The number is arbitrary and differs from the migration lock's.
 */
const WORKSPACE_CREATION_LOCK = 4_711_001;

export function lockWorkspaceCreation(tx: Transaction): Promise<unknown> {
  return tx.execute(sql`select pg_advisory_xact_lock(${WORKSPACE_CREATION_LOCK}::bigint)`);
}

/** `GET /me`: who the caller is and what they can open. */
export async function getMe(ctx: ServiceContext): Promise<Me> {
  const { principal, user } = requirePerson(ctx);
  const rows = await listWorkspacesFor(ctx.db, user.id);
  const workspaces: MyWorkspace[] = [];
  for (const row of rows) {
    const membership = principal.memberships.find((entry) => entry.workspaceId === row.id);
    const member = await reposOf(ctx.db, row.id).members.get(user.id);
    workspaces.push({
      workspace: toWorkspace(row),
      role: membership?.role ?? null,
      handle: member?.handle ?? null,
      projectRoles: { ...(membership?.projectRoles ?? {}) },
      // The person's own tabs, intros and Get started.
      view: await reposOf(ctx.db, row.id).personViews.get(user.id),
    });
  }
  const emptyInstall = (await countWorkspaces(ctx.db, { includeDeleted: true })) === 0;
  return {
    user,
    local: principal.local,
    workspaces,
    canCreateWorkspace: can(principal, 'workspace.create', {
      openSignup: ctx.settings.openSignup,
      emptyInstall,
    }).allowed,
  };
}

/** `GET /workspaces`: the workspaces the caller holds something in. */
export async function listWorkspaces(ctx: ServiceContext): Promise<Workspace[]> {
  const { user } = requirePerson(ctx);
  return (await listWorkspacesFor(ctx.db, user.id)).map(toWorkspace);
}

/**
 * `POST /workspaces`. Whoever creates a workspace is its Owner and
 * picks their handle in it. The check and the creation run under one lock.
 */
export async function createWorkspaceFor(
  ctx: ServiceContext,
  input: CreateWorkspaceRequest,
): Promise<Workspace> {
  // An agent never creates a workspace; its refusal is recorded like any other.
  if (ctx.caller.principal.kind === 'agent') {
    await authorize(ctx, 'workspace.create', { openSignup: ctx.settings.openSignup });
  }
  const { principal, user } = requirePerson(ctx);
  return ctx.db.transaction(async (tx) => {
    await lockWorkspaceCreation(tx);
    // Read again under the lock: what the person holds, and whether the install is empty.
    const current = personPrincipal({
      userId: principal.userId,
      local: principal.local,
      memberships: await membershipsOf(tx, principal.userId),
    });
    const emptyInstall = (await countWorkspaces(tx, { includeDeleted: true })) === 0;
    assertAllowed(
      can(current, 'workspace.create', { openSignup: ctx.settings.openSignup, emptyInstall }),
    );

    const stamp = stampOf(ctx);
    // A new workspace starts with the tabs its kind of product needs and
    // with the planning extras off until someone turns them on.
    const workspace = await createWorkspace(
      tx,
      {
        name: input.name,
        slug: input.slug,
        baseCurrency: input.baseCurrency,
        planning: planningAtStart,
        tabsOff: tabsOffFor(input.kind),
      },
      stamp,
    );
    const repos = reposOf(tx, workspace.id);
    const member = await repos.members.add(
      { userId: user.id, role: 'owner', handle: input.handle },
      stamp,
    );
    await appendEvent(ctx, repos, {
      type: 'workspace.created',
      subject: { type: 'workspace', id: workspace.id },
      data: {
        name: workspace.name,
        slug: workspace.slug,
        baseCurrency: workspace.baseCurrency,
        demo: workspace.demo,
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        // Made by the first run's one question, with this project.
        ...(input.project === undefined ? {} : { firstProject: input.project.key }),
        tabsOff: inViewOrder(workspace.tabsOff),
        planning: workspace.planning,
      },
    });
    await appendEvent(ctx, repos, {
      type: 'member.joined',
      subject: { type: 'member', id: member.id },
      data: { userId: member.userId, role: member.role, handle: member.handle },
    });
    // The first run's one question: the first project comes with the workspace, of its
    // kind, in the same write. The Owner just
    // made may create projects, so no other check is asked.
    if (input.project !== undefined && input.kind !== undefined) {
      await addProject(ctx, repos, {
        name: input.project.name,
        key: input.project.key,
        slug: input.project.slug,
        kind: input.kind,
        launchDate: null,
        locales: ['en'],
        repoUrl: null,
        shipsTo: input.kind === 'app' ? input.project.shipsTo : [],
      });
    }
    const body = toWorkspace(workspace);
    await ctx.keyed?.save(tx, workspace.id, body);
    return body;
  });
}

/**
 * `GET /workspaces/:ws`, under `workspace.read`. No scope reads a workspace, so an
 * agent token of the workspace is refused with R12 (core.can).
 */
export async function getWorkspace(ctx: ServiceContext, slug: string): Promise<Workspace> {
  const workspace = await openWorkspace(ctx, slug);
  await authorize(ctx, 'workspace.read', { workspaceId: workspace.id });
  return toWorkspace(workspace);
}

/** `PATCH /workspaces/:ws`, under `workspace.update`. A patch that changes nothing writes nothing. */
export async function updateWorkspace(
  ctx: ServiceContext,
  slug: string,
  patch: UpdateWorkspaceRequest,
): Promise<Workspace> {
  const workspace = await openWorkspace(ctx, slug);
  await authorize(ctx, 'workspace.update', { workspaceId: workspace.id });
  return ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspace.id);
    await repos.workspace.lock();
    const current = await liveWorkspace(await repos.workspace.get());
    // A time zone the server knows, and the switches merged into what they were.
    if (patch.timeZone !== undefined && !isKnownTimeZone(patch.timeZone)) {
      throw new HttpError('unprocessable', messages.planning.timeZoneUnknown);
    }
    const { planning, tabsOff, ...rest } = patch;
    const next = {
      ...rest,
      ...(planning === undefined ? {} : { planning: { ...current.planning, ...planning } }),
      // The tabs turned off, as a set in tab order.
      ...(tabsOff === undefined ? {} : { tabsOff: inViewOrder(tabsOff) }),
    };
    const changes = changesOf(current, next);
    if (Object.keys(changes).length === 0) return toWorkspace(current);
    const updated = await repos.workspace.update(afterValues(changes), stampOf(ctx));
    if (!updated) throw notFound();
    await appendEvent(ctx, repos, {
      type: 'workspace.updated',
      subject: { type: 'workspace', id: workspace.id },
      data: changes,
    });
    return toWorkspace(updated);
  });
}

/**
 * `DELETE /workspaces/:ws`, under `workspace.delete`: the soft delete of R26. It sets
 * `deletedAt`, appends `workspace.deleted` as the workspace's last event, and removes
 * nothing. From then on the workspace answers like one that does not exist.
 *
 * The demo workspace (Remove demo data) also has every token that still works
 * revoked first, each with `token.revoked` and `reason: demo_removed`, so no token of it,
 * the one with every scope included, waits in the data folder.
 */
export async function deleteWorkspace(ctx: ServiceContext, slug: string): Promise<Workspace> {
  const workspace = await openWorkspace(ctx, slug);
  await authorize(ctx, 'workspace.delete', { workspaceId: workspace.id });
  return ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspace.id);
    await repos.workspace.lock();
    const stamp = stampOf(ctx);
    const current = await liveWorkspace(await repos.workspace.get());
    if (current.demo) {
      for (const token of await repos.agentTokens.list()) {
        if (token.revokedAt !== null) continue;
        const revoked = await repos.agentTokens.revoke(token.id, stamp);
        if (!revoked) continue;
        await appendEvent(ctx, repos, {
          type: 'token.revoked',
          subject: { type: 'token', id: revoked.id },
          data: {
            agentId: revoked.agentId,
            name: revoked.name,
            prefix: revoked.prefix,
            reason: 'demo_removed',
          },
        });
      }
    }
    const deleted = await repos.workspace.markDeleted(stamp);
    if (!deleted) throw notFound();
    await appendEvent(ctx, repos, {
      type: 'workspace.deleted',
      subject: { type: 'workspace', id: workspace.id },
      data: { name: deleted.name, slug: deleted.slug },
      ...(stamp.at ? { at: stamp.at } : {}),
    });
    return toWorkspace(deleted);
  });
}

/**
 * `POST /workspaces/:ws/transfer`, under `workspace.transfer`. The member named
 * becomes Owner and the Owner who transfers becomes Admin.
 */
export async function transferWorkspace(
  ctx: ServiceContext,
  slug: string,
  input: TransferWorkspaceRequest,
): Promise<Workspace> {
  const workspace = await openWorkspace(ctx, slug);
  await authorize(ctx, 'workspace.transfer', { workspaceId: workspace.id });
  const { user } = requirePerson(ctx);
  return ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspace.id);
    await repos.workspace.lock();
    const current = await liveWorkspace(await repos.workspace.get());
    const from = await repos.members.get(user.id);
    const to = await repos.members.get(input.userId.toLowerCase());
    if (!from || from.role !== 'owner') throw notFound();
    if (!to) throw notFound();
    if (to.userId === from.userId) {
      throw new HttpError('unprocessable', messages.errors.transferToSelf);
    }
    if (to.role === 'owner') throw new HttpError('conflict', messages.errors.transferToOwner);
    // The new Owner must be someone who can sign in, or nobody could act as Owner again:
    // never a person at an address under `.invalid`, such as the demo's people or the
    // local owner of another install, so in local mode never anyone.
    const target = await findUserById(tx, to.userId);
    if (!target || !canSignInWith(target.email)) {
      throw new HttpError('unprocessable', messages.errors.transferNoSignIn);
    }

    const stamp = stampOf(ctx);
    await repos.members.setRole(to.userId, 'owner', stamp);
    await repos.members.setRole(from.userId, 'admin', stamp);
    await appendEvent(ctx, repos, {
      type: 'workspace.transferred',
      subject: { type: 'workspace', id: workspace.id },
      data: { from: from.userId, to: to.userId },
    });
    await appendEvent(ctx, repos, {
      type: 'member.role_changed',
      subject: { type: 'member', id: to.id },
      data: { userId: to.userId, role: [to.role, 'owner'] },
    });
    await appendEvent(ctx, repos, {
      type: 'member.role_changed',
      subject: { type: 'member', id: from.id },
      data: { userId: from.userId, role: ['owner', 'admin'] },
    });
    const body = toWorkspace(current);
    await ctx.keyed?.save(tx, workspace.id, body);
    return body;
  });
}

/** Inside a write: the workspace, unless it was deleted since the request began. */
export function liveWorkspace(row: WorkspaceRow | null): Promise<WorkspaceRow> {
  if (!row || row.deletedAt !== null) return Promise.reject(notFound());
  return Promise.resolve(row);
}

/**
 * Before the kept answer of `POST /workspaces`, `POST /workspaces/:ws/transfer` or
 * `POST /invitations/accept` is given again: the caller still reaches the
 * workspace. A transfer is not asked `workspace.transfer` again, because the transfer
 * itself made the caller an Admin; a person who has left the workspace since gets the
 * one 404.
 */
export async function checkKeptInWorkspace(
  ctx: ServiceContext,
  workspaceId: string,
): Promise<void> {
  await openWorkspaceById(ctx, workspaceId);
}

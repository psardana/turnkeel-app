import { can, roleTable } from '@turnkeel/core';
import { toMember, toProjectMember, toUser, type Repositories } from '@turnkeel/db';
import type {
  Member,
  ProjectMember,
  SetProjectMemberRequest,
  UpdateMemberRequest,
  WorkspacePerson,
  WorkspaceRole,
} from '@turnkeel/protocol';
import { assertAllowed, HttpError, notFound } from '../http/errors.js';
import { messages } from '../messages.js';
import { authorize, idOr404, openProject, openWorkspace, reposOf } from './access.js';
import { appendEvent, requirePerson, stampOf, type ServiceContext } from './context.js';
import { liveWorkspace } from './workspaces.js';

/**
 * `GET /workspaces/:ws/members`, under `member.read`: everyone who holds something in
 * the workspace, with their email, their workspace role and their project roles.
 */
export async function listMembers(ctx: ServiceContext, slug: string): Promise<WorkspacePerson[]> {
  const workspace = await openWorkspace(ctx, slug);
  await authorize(ctx, 'member.read', { workspaceId: workspace.id });
  const repos = reposOf(ctx.db, workspace.id);

  const people = new Map<string, WorkspacePerson>();
  for (const { member, user } of await repos.members.list()) {
    people.set(user.id, { user: toUser(user), member: toMember(member), projectMembers: [] });
  }
  for (const project of await repos.projects.list({ includeArchived: true })) {
    for (const { projectMember, user } of await repos.projectMembers.listForProject(project.id)) {
      let person = people.get(user.id);
      if (!person) {
        person = { user: toUser(user), member: null, projectMembers: [] };
        people.set(user.id, person);
      }
      person.projectMembers.push(toProjectMember(projectMember));
    }
  }
  return [...people.values()];
}

/**
 * `PATCH /workspaces/:ws/members/:userId`. A role change needs `member.manage` and is
 * limited by R9 and R31. A handle is changed by the person it belongs to, and by
 * nobody else.
 */
export async function updateMember(
  ctx: ServiceContext,
  slug: string,
  userIdParam: string,
  patch: UpdateMemberRequest,
): Promise<Member> {
  const workspace = await openWorkspace(ctx, slug);
  const userId = idOr404(userIdParam);
  const { principal } = ctx.caller;

  if (patch.role === undefined && patch.handle === undefined) {
    throw new HttpError('bad_request', messages.errors.badBody('role or handle is needed.'));
  }
  // Whether the caller may do this at all is settled before anything says whether
  // the person exists.
  if (patch.handle !== undefined) {
    await authorize(ctx, 'member.handle', { workspaceId: workspace.id, userId }, { write: true });
  }
  if (patch.role !== undefined) {
    await authorize(ctx, 'member.manage', { workspaceId: workspace.id });
  }

  return ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspace.id);
    await repos.workspace.lock();
    await liveWorkspace(await repos.workspace.get());
    let member = await repos.members.get(userId);
    if (!member) throw notFound();
    const stamp = stampOf(ctx);

    if (patch.role !== undefined && patch.role !== member.role) {
      assertAllowed(
        can(principal, 'member.manage', {
          workspaceId: workspace.id,
          change: {
            type: 'set_role',
            current: member.role,
            next: patch.role,
            ownerCount: await repos.members.countOwners(),
          },
        }),
      );
      const before = member.role;
      member = (await repos.members.setRole(userId, patch.role, stamp)) ?? member;
      await appendEvent(ctx, repos, {
        type: 'member.role_changed',
        subject: { type: 'member', id: member.id },
        data: { userId, role: [before, member.role] },
      });
      // A token works for as long as someone who may manage agents stands behind it.
      if (managesAgents(before) && !managesAgents(member.role)) {
        await revokeTokensMadeBy(ctx, repos, userId, 'role_changed');
      }
    }

    if (patch.handle !== undefined && patch.handle !== member.handle) {
      const before = member.handle;
      member = (await repos.members.setHandle(userId, patch.handle, stamp)) ?? member;
      await appendEvent(ctx, repos, {
        type: 'member.handle_changed',
        subject: { type: 'member', id: member.id },
        data: { userId, handle: [before, member.handle] },
      });
    }

    return toMember(member);
  });
}

/**
 * `DELETE /workspaces/:ws/members/:userId`, under `member.manage`. It takes
 * away everything the person holds in the workspace: the workspace role and every
 * project role, so that removing someone ends their access.
 */
export async function removeMember(
  ctx: ServiceContext,
  slug: string,
  userIdParam: string,
): Promise<void> {
  const workspace = await openWorkspace(ctx, slug);
  const userId = idOr404(userIdParam);
  const { principal } = ctx.caller;
  await authorize(ctx, 'member.manage', { workspaceId: workspace.id });

  await ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspace.id);
    await repos.workspace.lock();
    await liveWorkspace(await repos.workspace.get());
    const member = await repos.members.get(userId);
    const projectRoles = await repos.projectMembers.listForUser(userId);
    if (!member && projectRoles.length === 0) throw notFound();

    if (member) {
      // Removing a member takes their project roles with them, so this one check covers them.
      assertAllowed(
        can(principal, 'member.manage', {
          workspaceId: workspace.id,
          change: {
            type: 'remove',
            current: member.role,
            ownerCount: await repos.members.countOwners(),
          },
        }),
      );
    } else {
      for (const row of projectRoles) {
        assertAllowed(
          can(principal, 'member.manage', {
            workspaceId: workspace.id,
            change: {
              type: 'remove_project_role',
              projectId: row.projectId,
              userId,
              targetRole: null,
            },
          }),
        );
      }
    }

    if (member) {
      await repos.members.remove(userId);
      await appendEvent(ctx, repos, {
        type: 'member.removed',
        subject: { type: 'member', id: member.id },
        data: { userId, role: member.role, handle: member.handle },
      });
      // Nothing that person made or owns may outlast them: their tokens stop, and their
      // agents pass to whoever removed them.
      await revokeTokensMadeBy(ctx, repos, userId, 'member_removed');
      await handOverAgents(ctx, repos, userId);
    }
    for (const row of projectRoles) {
      await repos.projectMembers.remove(row.projectId, userId);
      await appendEvent(ctx, repos, {
        type: 'member.removed',
        subject: { type: 'project_member', id: row.id },
        projectId: row.projectId,
        data: { userId, role: row.role, projectId: row.projectId },
      });
    }
    // Their view of the workspace goes with them: invited again, they start afresh.
    await repos.personViews.remove(userId);
  });
}

/** `GET /workspaces/:ws/projects/:p/members/:userId`, under `member.read`. */
export async function getProjectMember(
  ctx: ServiceContext,
  slug: string,
  address: string,
  userIdParam: string,
): Promise<ProjectMember> {
  const workspace = await openWorkspace(ctx, slug);
  const project = await openProject(ctx, workspace, address, 'member.read');
  const userId = idOr404(userIdParam);
  await authorize(ctx, 'member.read', { workspaceId: workspace.id });
  const row = await reposOf(ctx.db, workspace.id).projectMembers.get(project.id, userId);
  if (!row) throw notFound();
  return toProjectMember(row);
}

/**
 * `PUT /workspaces/:ws/projects/:p/members/:userId`, under `member.manage`: a project
 * role for a person who is already in the workspace. Anyone else joins through an
 * invitation.
 */
export async function setProjectMember(
  ctx: ServiceContext,
  slug: string,
  address: string,
  userIdParam: string,
  input: SetProjectMemberRequest,
): Promise<ProjectMember> {
  const workspace = await openWorkspace(ctx, slug);
  const project = await openProject(ctx, workspace, address, 'member.manage');
  const userId = idOr404(userIdParam);
  await authorize(ctx, 'member.manage', { workspaceId: workspace.id });
  if (project.archivedAt !== null) {
    throw new HttpError('project_archived', messages.errors.projectArchived);
  }

  return ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspace.id);
    await repos.workspace.lock();
    await liveWorkspace(await repos.workspace.get());
    const member = await repos.members.get(userId);
    const inWorkspace =
      member !== null || (await repos.projectMembers.listForUser(userId)).length > 0;
    if (!inWorkspace) throw notFound();
    // R30, R31: the kind of role, and who may give it to whom. Nobody gives their own.
    assertAllowed(
      can(ctx.caller.principal, 'member.manage', {
        workspaceId: workspace.id,
        change: {
          type: 'set_project_role',
          projectId: project.id,
          role: input.role,
          userId,
          targetRole: member?.role ?? null,
        },
      }),
    );

    const result = await repos.projectMembers.set(
      { projectId: project.id, userId, role: input.role },
      stampOf(ctx),
    );
    if (!result) throw notFound();
    const { projectMember, previous } = result;
    if (previous === null) {
      await appendEvent(ctx, repos, {
        type: 'member.joined',
        subject: { type: 'project_member', id: projectMember.id },
        projectId: project.id,
        data: { userId, role: projectMember.role, projectId: project.id },
      });
    } else if (previous !== projectMember.role) {
      await appendEvent(ctx, repos, {
        type: 'member.role_changed',
        subject: { type: 'project_member', id: projectMember.id },
        projectId: project.id,
        data: { userId, role: [previous, projectMember.role], projectId: project.id },
      });
    }
    return toProjectMember(projectMember);
  });
}

/** `DELETE /workspaces/:ws/projects/:p/members/:userId`, under `member.manage`. */
export async function removeProjectMember(
  ctx: ServiceContext,
  slug: string,
  address: string,
  userIdParam: string,
): Promise<void> {
  const workspace = await openWorkspace(ctx, slug);
  const project = await openProject(ctx, workspace, address, 'member.manage');
  const userId = idOr404(userIdParam);
  await authorize(ctx, 'member.manage', { workspaceId: workspace.id });
  if (project.archivedAt !== null) {
    throw new HttpError('project_archived', messages.errors.projectArchived);
  }

  await ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspace.id);
    await repos.workspace.lock();
    await liveWorkspace(await repos.workspace.get());
    if (!(await repos.projectMembers.get(project.id, userId))) throw notFound();
    // R31: only an Owner takes away an Owner's project role. Nobody takes away their own.
    assertAllowed(
      can(ctx.caller.principal, 'member.manage', {
        workspaceId: workspace.id,
        change: {
          type: 'remove_project_role',
          projectId: project.id,
          userId,
          targetRole: (await repos.members.get(userId))?.role ?? null,
        },
      }),
    );
    const removed = await repos.projectMembers.remove(project.id, userId);
    if (!removed) throw notFound();
    await appendEvent(ctx, repos, {
      type: 'member.removed',
      subject: { type: 'project_member', id: removed.id },
      projectId: project.id,
      data: { userId, role: removed.role, projectId: project.id },
    });
    // The last place they held in the workspace: their view goes too.
    if (
      !(await repos.members.get(userId)) &&
      (await repos.projectMembers.listForUser(userId)).length === 0
    ) {
      await repos.personViews.remove(userId);
    }
  });
}

/** True when the workspace role holds `agent.manage`. */
const managesAgents = (role: WorkspaceRole) => roleTable['agent.manage'].roles.includes(role);

/**
 * Revokes every token a person made in the workspace that still works, with a
 * `token.revoked` for each that says why, in the transaction of the member change.
 * Called when the person is removed, or loses `agent.manage` by a change of role.
 */
async function revokeTokensMadeBy(
  ctx: ServiceContext,
  repos: Repositories,
  userId: string,
  reason: 'member_removed' | 'role_changed',
): Promise<void> {
  const stamp = stampOf(ctx);
  for (const token of await repos.agentTokens.listActiveCreatedBy(userId)) {
    const revoked = await repos.agentTokens.revoke(token.id, stamp);
    if (!revoked) continue;
    await appendEvent(ctx, repos, {
      type: 'token.revoked',
      subject: { type: 'token', id: revoked.id },
      data: { agentId: revoked.agentId, name: revoked.name, prefix: revoked.prefix, reason },
    });
  }
}

/**
 * Gives the agents a removed person owned to the person who removed them, with an
 * `agent.updated` for each. The owner of an agent holds a role in the workspace. A person
 * who removes themselves hands their agents to the Owner who has been
 * one longest; R9 keeps at least one.
 */
async function handOverAgents(
  ctx: ServiceContext,
  repos: Repositories,
  userId: string,
): Promise<void> {
  const owned = await repos.agents.listOwnedBy(userId);
  if (owned.length === 0) return;
  const { user } = requirePerson(ctx);
  let heir = user.id.toLowerCase();
  if (heir === userId.toLowerCase()) {
    const owners = (await repos.members.list())
      .map(({ member }) => member)
      .filter((member) => member.role === 'owner' && member.userId !== userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const first = owners[0];
    if (!first) return;
    heir = first.userId;
  }
  const stamp = stampOf(ctx);
  for (const agent of owned) {
    const updated = await repos.agents.update(agent.id, { ownerUserId: heir }, stamp);
    if (!updated) continue;
    await appendEvent(ctx, repos, {
      type: 'agent.updated',
      subject: { type: 'agent', id: agent.id },
      data: { ownerUserId: [agent.ownerUserId, updated.ownerUserId] },
    });
  }
}

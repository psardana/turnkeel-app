import { createHash, randomBytes } from 'node:crypto';
import { can, canAcceptInvitation, invitationExpiry } from '@turnkeel/core';
import {
  findInvitationByTokenHash,
  findUserByEmail,
  findUserById,
  toInvitation,
  toMember,
  toProjectMember,
  toWorkspace,
  type InvitationRow,
} from '@turnkeel/db';
import {
  workspaceRoleSchema,
  type AcceptInvitationRequest,
  type AcceptInvitationResponse,
  type CreateInvitationRequest,
  type CreateInvitationResponse,
  type Invitation,
  type InvitationLookup,
  type ProjectRole,
  type User,
} from '@turnkeel/protocol';
import { assertAllowed, HttpError, notFound } from '../http/errors.js';
import { messages } from '../messages.js';
import { appendEvent, requirePerson, stampOf, type ServiceContext } from './context.js';
import { suggestHandle } from './handles.js';
import { liveWorkspace } from './workspaces.js';

/** The path of the web app's page that accepts an invitation. The token travels in the query. */
export const INVITATION_PAGE_PATH = '/invitations/accept';

/** Only the hash of an invitation token is stored. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isOpen(invitation: InvitationRow, now: Date): boolean {
  return (
    invitation.acceptedAt === null &&
    invitation.revokedAt === null &&
    invitation.expiresAt.getTime() > now.getTime()
  );
}

/** `GET /workspaces/:ws/invitations`, under `member.manage`. No token and no hash. */
export async function listInvitations(ctx: ServiceContext, slug: string): Promise<Invitation[]> {
  const workspace = await openWorkspace(ctx, slug);
  await authorize(ctx, 'member.manage', { workspaceId: workspace.id }, { write: false });
  return (await reposOf(ctx.db, workspace.id).invitations.list()).map(toInvitation);
}

/**
 * `POST /workspaces/:ws/invitations`, under `member.manage`, limited by R31 and R32.
 * The token is made here, goes into the mail and nowhere else; the database gets its
 * hash. A second invitation to the same address replaces the first.
 */
export async function createInvitation(
  ctx: ServiceContext,
  slug: string,
  input: CreateInvitationRequest,
): Promise<CreateInvitationResponse> {
  const workspace = await openWorkspace(ctx, slug);
  const projectId = input.projectId?.toLowerCase() ?? null;
  await authorize(ctx, 'member.manage', {
    workspaceId: workspace.id,
    change: { type: 'invite', role: input.role, projectId },
  });
  const { user } = requirePerson(ctx);
  // An invitation is accepted by signing in, which local mode does not have.
  if (ctx.settings.mode === 'local') {
    throw new HttpError('conflict', messages.errors.needsSignIn);
  }

  const token = randomBytes(32).toString('base64url');
  const mailWhenSent: CreateInvitationResponse['mail'] =
    ctx.mailer.kind === 'smtp' ? 'sent' : 'logged';
  const now = new Date();
  const expiresAt = invitationExpiry(now);

  const { invitation, projectName } = await ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspace.id);
    await repos.workspace.lock();
    await liveWorkspace(await repos.workspace.get());

    let projectName: string | null = null;
    if (projectId !== null) {
      const project = await repos.projects.get(projectId);
      if (!project) {
        throw new HttpError('unprocessable', messages.errors.invitationProjectUnknown);
      }
      if (project.archivedAt !== null) {
        throw new HttpError('project_archived', messages.errors.invitationProjectArchived);
      }
      projectName = project.name;
    }

    const invited = await findUserByEmail(tx, input.email);
    if (invited) {
      const isMember = (await repos.members.get(invited.id)) !== null;
      if (projectId === null) {
        // Someone who holds only project roles can still be invited to the workspace:
        // an invitation is the only way to give them a workspace role.
        if (isMember) throw new HttpError('conflict', messages.errors.alreadyMember);
      } else if (isMember || (await repos.projectMembers.listForUser(invited.id)).length > 0) {
        // Someone who is in the workspace gets a project role through the PUT, with no
        // invitation.
        throw new HttpError('conflict', messages.errors.alreadyInWorkspace);
      }
    }

    // A second invitation replaces the first, which is a revocation. Whoever may not
    // revoke the earlier one may not replace it either.
    for (const earlier of await repos.invitations.openFor(input.email, projectId)) {
      assertAllowed(
        can(ctx.caller.principal, 'member.manage', {
          workspaceId: workspace.id,
          change: { type: 'revoke_invitation', role: earlier.role },
        }),
      );
    }

    const stamp = stampOf(ctx, now);
    const { invitation, replaced } = await repos.invitations.create(
      {
        email: input.email,
        role: input.role,
        projectId,
        tokenHash: hashInvitationToken(token),
        invitedBy: user.id,
        expiresAt,
      },
      stamp,
    );
    for (const earlier of replaced) {
      await appendEvent(ctx, repos, {
        type: 'member.invite_revoked',
        subject: { type: 'invitation', id: earlier.id },
        projectId: earlier.projectId,
        data: { email: earlier.email, role: earlier.role, reason: 'replaced' },
      });
    }
    await appendEvent(ctx, repos, {
      type: 'member.invited',
      subject: { type: 'invitation', id: invitation.id },
      projectId,
      data: {
        email: invitation.email,
        role: invitation.role,
        projectId,
        invitedBy: user.id,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    });
    // R50: the answer is kept with the invitation, as the last statement of its
    // transaction. A repeat that arrives while the mail is still going out is then
    // answered from the record and writes and sends nothing. What it is told about
    // the mail is what is expected; the record is corrected below if the mail fails.
    await ctx.keyed?.save(tx, workspace.id, {
      invitation: toInvitation(invitation),
      mail: mailWhenSent,
    } satisfies CreateInvitationResponse);
    return { invitation, projectName };
  });

  // The mail goes out after the commit, so a slow mail server holds no lock, and the
  // link never points at an invitation that was not stored.
  let mail: CreateInvitationResponse['mail'] = mailWhenSent;
  const url = new URL(INVITATION_PAGE_PATH, ctx.settings.baseUrl());
  url.searchParams.set('token', token);
  try {
    await ctx.mailer.send({
      to: invitation.email,
      subject: messages.mail.invitationSubject({ inviter: user.name, workspace: workspace.name }),
      text: messages.mail.invitationText({
        inviter: user.name,
        workspace: workspace.name,
        project: projectName,
        role: invitation.role,
        url: url.toString(),
        email: invitation.email,
        expiresAt: invitation.expiresAt,
      }),
    });
  } catch (error) {
    mail = 'failed';
    ctx.logger.error(messages.log.mailFailed(invitation.email), safeError(error));
  }

  const body: CreateInvitationResponse = { invitation: toInvitation(invitation), mail };
  if (mail === 'failed') {
    // A later repeat with the same key is told what really became of the mail.
    try {
      await ctx.keyed?.update(body);
    } catch (error) {
      ctx.logger.error(messages.log.keptAnswerNotUpdated(ctx.requestId), safeError(error));
    }
  }
  return body;
}

/**
 * `DELETE /invitations/:id`, under `member.manage` with the limit of R31. The
 * invitation is looked for only in the workspaces where the caller manages members,
 * so an id from anywhere else is the one 404.
 */
export async function revokeInvitation(ctx: ServiceContext, idParam: string): Promise<Invitation> {
  const id = idOr404(idParam);
  // An agent manages no members; its refusal is recorded like any other.
  const caller = ctx.caller.principal;
  if (caller.kind === 'agent') {
    await authorize(ctx, 'member.manage', { workspaceId: caller.workspaceId });
  }
  const { principal } = requirePerson(ctx);

  for (const membership of principal.memberships) {
    const workspaceId = membership.workspaceId;
    if (!can(principal, 'member.manage', { workspaceId }).allowed) continue;
    const found = await reposOf(ctx.db, workspaceId).invitations.get(id);
    if (!found) continue;

    assertAllowed(
      can(principal, 'member.manage', {
        workspaceId,
        change: { type: 'revoke_invitation', role: found.role },
      }),
    );
    return ctx.db.transaction(async (tx) => {
      const repos = reposOf(tx, workspaceId);
      await repos.workspace.lock();
      await liveWorkspace(await repos.workspace.get());
      const revoked = await repos.invitations.revoke(id, stampOf(ctx));
      // Accepted or revoked already: there is nothing left to revoke.
      if (!revoked) throw notFound();
      await appendEvent(ctx, repos, {
        type: 'member.invite_revoked',
        subject: { type: 'invitation', id: revoked.id },
        projectId: revoked.projectId,
        data: { email: revoked.email, role: revoked.role, reason: 'revoked' },
      });
      return toInvitation(revoked);
    });
  }
  throw notFound();
}

/**
 * `POST /invitations/lookup`: what the accept page shows before anyone accepts.
 * It needs no sign-in, because the link opens the sign-in page for the
 * invited address. A token that is unknown, used, expired or revoked gets the one 404.
 */
export async function lookupInvitation(
  ctx: Pick<ServiceContext, 'db'>,
  token: string,
  signedIn: User | null,
): Promise<InvitationLookup> {
  const found = await findInvitationByTokenHash(ctx.db, hashInvitationToken(token));
  if (!found || !isOpen(found.invitation, new Date())) throw notFound();
  const { invitation, workspace } = found;
  const repos = reposOf(ctx.db, workspace.id);
  const project =
    invitation.projectId === null ? null : await repos.projects.get(invitation.projectId);
  const inviter = await findUserById(ctx.db, invitation.invitedBy);

  let suggestedHandle: string | null = null;
  if (invitation.projectId === null && signedIn !== null) {
    suggestedHandle = await suggestHandle(
      signedIn,
      async (handle) => (await repos.members.findByHandle(handle)) !== null,
    );
  }
  return {
    email: invitation.email,
    role: invitation.role,
    workspace: { name: workspace.name, slug: workspace.slug },
    project: project ? { name: project.name } : null,
    invitedBy: { name: inviter?.name ?? '' },
    expiresAt: invitation.expiresAt.toISOString(),
    suggestedHandle,
  };
}

/**
 * `POST /invitations/accept`. No role allows it; the token decides. The caller
 * is signed in, and their verified email address is the one invited. An invitation to
 * the workspace makes a Member with the handle the person picks; an invitation to a
 * project makes only a ProjectMember.
 */
export async function acceptInvitation(
  ctx: ServiceContext,
  input: AcceptInvitationRequest,
): Promise<AcceptInvitationResponse> {
  // R13, R45: only a signed-in person accepts. An agent that tries is recorded.
  await refuseAgentRequest(ctx, 'invitation.accept');
  const { user } = requirePerson(ctx);
  const found = await findInvitationByTokenHash(ctx.db, hashInvitationToken(input.token));
  if (!found) throw notFound();
  const workspaceId = found.workspace.id;

  return ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspaceId);
    await repos.workspace.lock();
    const workspace = await liveWorkspace(await repos.workspace.get());
    const invitation = await repos.invitations.get(found.invitation.id);
    if (!invitation) throw notFound();
    const now = new Date();
    assertAllowed(canAcceptInvitation({ invitation, user, now }));
    const stamp = stampOf(ctx, now);

    let body: AcceptInvitationResponse;
    if (invitation.projectId === null) {
      // The database keeps a Tester out of the workspace roles; this keeps the types honest.
      const role = workspaceRoleSchema.parse(invitation.role);
      if (await repos.members.get(user.id)) {
        throw new HttpError('conflict', messages.errors.alreadyMember);
      }
      const handle =
        input.handle ??
        (await suggestHandle(
          user,
          async (candidate) => (await repos.members.findByHandle(candidate)) !== null,
        ));
      if (handle === null) throw new HttpError('unprocessable', messages.errors.noFreeHandle);
      if (!(await repos.invitations.markAccepted(invitation.id, stamp))) throw notFound();
      const member = await repos.members.add({ userId: user.id, role, handle }, stamp);
      await appendEvent(ctx, repos, {
        type: 'member.joined',
        subject: { type: 'member', id: member.id },
        data: {
          userId: user.id,
          role: member.role,
          handle: member.handle,
          invitationId: invitation.id,
        },
      });
      body = { workspace: toWorkspace(workspace), member: toMember(member), projectMember: null };
    } else {
      const project = await repos.projects.get(invitation.projectId);
      if (!project) throw notFound();
      if (project.archivedAt !== null) {
        throw new HttpError('project_archived', messages.errors.projectArchived);
      }
      if (!(await repos.invitations.markAccepted(invitation.id, stamp))) throw notFound();
      const result = await repos.projectMembers.set(
        { projectId: project.id, userId: user.id, role: invitation.role as ProjectRole },
        stamp,
      );
      if (!result) throw notFound();
      const { projectMember, previous } = result;
      await appendEvent(ctx, repos, {
        type: previous === null ? 'member.joined' : 'member.role_changed',
        subject: { type: 'project_member', id: projectMember.id },
        projectId: project.id,
        data: {
          userId: user.id,
          role: previous === null ? projectMember.role : [previous, projectMember.role],
          projectId: project.id,
          invitationId: invitation.id,
        },
      });
      body = {
        workspace: toWorkspace(workspace),
        member: null,
        projectMember: toProjectMember(projectMember),
      };
    }
    await ctx.keyed?.save(tx, workspaceId, body);
    return body;
  });
}

/**
 * Before the kept answer of `POST /workspaces/:ws/invitations` is given again:
 * `member.manage` now, under the limits of R31 and R32 for the role it names.
 */
export async function checkKeptInvitation(
  ctx: ServiceContext,
  workspaceId: string,
  input: CreateInvitationRequest,
): Promise<void> {
  const workspace = await openWorkspaceById(ctx, workspaceId);
  await authorize(ctx, 'member.manage', {
    workspaceId: workspace.id,
    change: { type: 'invite', role: input.role, projectId: input.projectId?.toLowerCase() ?? null },
  });
}

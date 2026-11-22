import {
  can,
  canReach,
  isRead,
  type Action,
  type Decision,
  type Denied,
  type ResourceFor,
} from '@turnkeel/core';
import {
  findWorkspaceBySlug,
  repositories,
  workspaceScope,
  type Executor,
  type ProjectRow,
  type Repositories,
  type WorkspaceRow,
} from '@turnkeel/db';
import { idSchema, slugSchema } from '@turnkeel/protocol';

/** The repositories of one workspace, on the database or on a transaction. */
export function reposOf(executor: Executor, workspaceId: string): Repositories {
  return repositories(executor, workspaceScope(workspaceId));
}

/**
 * The workspace `:ws` names, for a caller who reaches it. A slug nobody has, a
 * deleted workspace and a workspace the caller holds nothing in all get the one 404.
 * Whether the caller may read or change it is asked afterwards, of `can`.
 */
export async function openWorkspace(ctx: ServiceContext, slug: string): Promise<WorkspaceRow> {
  if (!slugSchema.safeParse(slug.toLowerCase()).success) throw notFound();
  const workspace = await findWorkspaceBySlug(ctx.db, slug);
  if (!workspace) throw notFound();
  if (!canReach(ctx.caller.principal, { workspaceId: workspace.id }).allowed) throw notFound();
  return workspace;
}

/**
 * The workspace with this id, for a caller who still reaches it: what a kept answer of
 * an Idempotency-Key is checked against before it is given again. A deleted
 * workspace and one the caller no longer holds anything in get the one 404.
 */
export async function openWorkspaceById(
  ctx: ServiceContext,
  workspaceId: string,
): Promise<WorkspaceRow> {
  const workspace = await reposOf(ctx.db, workspaceId).workspace.get();
  if (!workspace || workspace.deletedAt !== null) throw notFound();
  if (!canReach(ctx.caller.principal, { workspaceId: workspace.id }).allowed) throw notFound();
  return workspace;
}

/**
 * The project `:p` names, by its slug or its key, for a caller who reaches it, to do
 * `action` there. An address nobody has and a project outside the caller's reach get
 * the one 404. When an agent's write names a project of its own workspace that is
 * not on its token, `access.denied` naming R11 is appended before the 404.
 */
export async function openProject(
  ctx: ServiceContext,
  workspace: WorkspaceRow,
  address: string,
  action: Action,
): Promise<ProjectRow> {
  if (address.length < 2 || address.length > 40) throw notFound();
  const project = await reposOf(ctx.db, workspace.id).projects.findByAddress(address);
  if (!project) throw notFound();
  const place = { workspaceId: workspace.id, projectId: project.id };
  const reach = canReach(ctx.caller.principal, place);
  if (!reach.allowed) {
    if (!isRead(action)) await recordDenied(ctx, action, reach, place);
    throw notFound();
  }
  return project;
}

/** A path value that must be an id. Anything else names nothing, so it is the one 404. */
export function idOr404(value: string): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw notFound();
  return parsed.data.toLowerCase();
}

/**
 * Refuses a request that only a person may make, such as accepting an invitation,
 * which is no permission action. An agent token is refused with 403 naming R13,
 * and the refusal is recorded like any refused write.
 */
export async function refuseAgentRequest(
  ctx: ServiceContext,
  request: 'invitation.accept',
): Promise<void> {
  if (ctx.caller.principal.kind !== 'agent') return;
  const decision: Denied = {
    allowed: false,
    kind: 'forbidden',
    reason: messages.errors.personOnly,
    rule: 'R13',
  };
  await recordDenied(ctx, request, decision, { projectId: null });
  assertAllowed(decision);
}

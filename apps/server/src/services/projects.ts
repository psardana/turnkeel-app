import { can } from '@turnkeel/core';
import type { CreateProjectRequest, Project, UpdateProjectRequest } from '@turnkeel/protocol';
import { HttpError, notFound } from '../http/errors.js';
import { messages } from '../messages.js';
import { afterValues, appendEvent, changesOf, stampOf, type ServiceContext } from './context.js';
import { liveWorkspace } from './workspaces.js';

/**
 * `GET /workspaces/:ws/projects`: the projects the caller may see. A person with a
 * workspace role sees all of them; a person with only project roles sees those.
 * Archived projects are left out unless asked for. No scope reads a project, so an agent
 * token of the workspace is refused with R12 (core.can).
 */
export async function listProjects(
  ctx: ServiceContext,
  slug: string,
  options: { includeArchived: boolean },
): Promise<Project[]> {
  const workspace = await openWorkspace(ctx, slug);
  await authorize(ctx, 'workspace.read', { workspaceId: workspace.id });
  const rows = await reposOf(ctx.db, workspace.id).projects.list(options);
  return rows
    .filter(
      (row) =>
        can(ctx.caller.principal, 'project.read', { workspaceId: workspace.id, projectId: row.id })
          .allowed,
    )
    .map(toProject);
}

/** `POST /workspaces/:ws/projects`, under `project.create`. A taken slug or key is refused with 409. */
export async function createProject(
  ctx: ServiceContext,
  slug: string,
  input: CreateProjectRequest,
): Promise<Project> {
  const workspace = await openWorkspace(ctx, slug);
  await authorize(ctx, 'project.create', { workspaceId: workspace.id });
  return ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspace.id);
    await repos.workspace.lock();
    await liveWorkspace(await repos.workspace.get());
    const project = await addProject(ctx, repos, input);
    const body = toProject(project);
    await ctx.keyed?.save(tx, workspace.id, body);
    return body;
  });
}

/**
 * Makes a project and appends `project.created`, inside the caller's transaction, which
 * holds the workspace's lock. `createProject` and the first run's `POST /workspaces` with
 * its first project both write it this way.
 */
export async function addProject(
  ctx: ServiceContext,
  repos: ReturnType<typeof reposOf>,
  input: CreateProjectRequest,
): Promise<ProjectRow> {
  // Where it ships is an app's: any other kind keeps none.
  const project = await repos.projects.create(
    input.kind === 'app' ? input : { ...input, shipsTo: [] },
    stampOf(ctx),
  );
  await appendEvent(ctx, repos, {
    type: 'project.created',
    subject: { type: 'project', id: project.id },
    projectId: project.id,
    data: {
      name: project.name,
      key: project.key,
      slug: project.slug,
      kind: project.kind,
      launchDate: project.launchDate,
      locales: project.locales,
      repoUrl: project.repoUrl,
      ...(project.shipsTo.length > 0 ? { shipsTo: project.shipsTo } : {}),
    },
  });
  return project;
}

/**
 * `GET /workspaces/:ws/projects/:p`, under `project.read`. `:p` is the project's slug or
 * its key. An agent token is refused with R12, as for the list.
 */
export async function getProject(
  ctx: ServiceContext,
  slug: string,
  address: string,
): Promise<Project> {
  const workspace = await openWorkspace(ctx, slug);
  const project = await openProject(ctx, workspace, address, 'project.read');
  await authorize(ctx, 'project.read', { workspaceId: workspace.id, projectId: project.id });
  return toProject(project);
}

/**
 * `PATCH /workspaces/:ws/projects/:p`, under `project.update`. An archived project is
 * read-only (409). A patch that changes nothing writes nothing.
 */
export async function updateProject(
  ctx: ServiceContext,
  slug: string,
  address: string,
  patch: UpdateProjectRequest,
): Promise<Project> {
  const workspace = await openWorkspace(ctx, slug);
  const project = await openProject(ctx, workspace, address, 'project.update');
  await authorize(ctx, 'project.update', { workspaceId: workspace.id, projectId: project.id });
  return ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspace.id);
    await repos.workspace.lock();
    await liveWorkspace(await repos.workspace.get());
    const current = await repos.projects.lock(project.id);
    if (!current) throw notFound();
    if (current.archivedAt !== null) {
      throw new HttpError('project_archived', messages.errors.projectArchived);
    }
    // R75: the launch date follows the launch milestone, and the two change together.
    // Clearing the launch date unlinks the launch milestone, which stays.
    const next = { ...patch };
    let moveMilestone: { id: string; on: string } | null = null;
    if (patch.launchMilestoneId !== undefined && patch.launchMilestoneId !== null) {
      const milestone = await repos.milestones.get(patch.launchMilestoneId.toLowerCase());
      if (!milestone || milestone.projectId !== project.id || milestone.removedAt !== null) {
        throw new HttpError(
          'unknown_milestone',
          messages.planning.launchMilestoneOfOtherProject,
          'R74',
        );
      }
      next.launchMilestoneId = milestone.id;
      next.launchDate = milestone.on;
    } else if (
      patch.launchMilestoneId === undefined &&
      patch.launchDate !== undefined &&
      current.launchMilestoneId !== null
    ) {
      if (patch.launchDate === null) {
        // No launch date, so no launch milestone: the link goes in the same write.
        next.launchMilestoneId = null;
      } else {
        // A launch date sent while a launch milestone is set moves that milestone's date.
        moveMilestone = { id: current.launchMilestoneId, on: patch.launchDate };
      }
    }
    // Where it ships is an app's: a project that is no app keeps none.
    if ((next.kind ?? current.kind) !== 'app') {
      if (current.shipsTo.length > 0 || (next.shipsTo?.length ?? 0) > 0) next.shipsTo = [];
      else delete next.shipsTo;
    }
    const changes = changesOf(current, next);
    if (Object.keys(changes).length === 0) return toProject(current);
    const stamp = stampOf(ctx);
    const updated = await repos.projects.update(project.id, afterValues(changes), stamp);
    if (!updated) throw notFound();
    await appendEvent(ctx, repos, {
      type: 'project.updated',
      subject: { type: 'project', id: project.id },
      projectId: project.id,
      data: changes,
    });
    if (moveMilestone !== null) {
      const milestone = await repos.milestones.get(moveMilestone.id);
      if (milestone && milestone.on !== moveMilestone.on) {
        await repos.milestones.update(milestone.id, { on: moveMilestone.on }, stamp);
        await appendEvent(ctx, repos, {
          type: 'milestone.changed',
          subject: { type: 'milestone', id: milestone.id },
          projectId: project.id,
          data: { change: 'changed', key: milestone.key, on: [milestone.on, moveMilestone.on] },
        });
      }
    }
    return toProject(updated);
  });
}

/**
 * `POST /workspaces/:ws/projects/:p/archive`, under `project.archive`. A project is
 * archived, never deleted. Archiving one that is archived already is refused with 409.
 */
export async function archiveProject(
  ctx: ServiceContext,
  slug: string,
  address: string,
): Promise<Project> {
  const workspace = await openWorkspace(ctx, slug);
  const project = await openProject(ctx, workspace, address, 'project.archive');
  await authorize(ctx, 'project.archive', { workspaceId: workspace.id, projectId: project.id });
  return ctx.db.transaction(async (tx) => {
    const repos = reposOf(tx, workspace.id);
    await repos.workspace.lock();
    await liveWorkspace(await repos.workspace.get());
    const archived = await repos.projects.archive(project.id, stampOf(ctx));
    if (!archived) throw new HttpError('project_archived', messages.errors.projectArchived);
    await appendEvent(ctx, repos, {
      type: 'project.archived',
      subject: { type: 'project', id: project.id },
      projectId: project.id,
      data: { archivedAt: [null, archived.archivedAt?.toISOString() ?? null] },
    });
    const body = toProject(archived);
    await ctx.keyed?.save(tx, workspace.id, body);
    return body;
  });
}

/** Before the kept answer of `POST .../projects/:p/archive` is given again:
 * `project.archive` now. */
export async function checkKeptArchiveProject(
  ctx: ServiceContext,
  workspaceId: string,
  address: string,
): Promise<void> {
  const workspace = await openWorkspaceById(ctx, workspaceId);
  const project = await openProject(ctx, workspace, address, 'project.archive');
  await authorize(ctx, 'project.archive', { workspaceId: workspace.id, projectId: project.id });
}

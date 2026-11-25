import { can, canUseFeature, personPrincipal, type PersonPrincipal } from '@turnkeel/core';
import {
  projectRoles,
  workspaceRoles,
  type Me,
  type ProjectRole,
  type Role,
  type WorkspaceRole,
} from '@turnkeel/protocol';

/**
 * What the signed-in person may do, asked of the same `can` the server uses
 * (`@turnkeel/core`). The app shows only what the role allows; the server still
 * decides, and a 403 is handled where it arrives.
 */
export function principalOf(me: Me): PersonPrincipal {
  return personPrincipal({
    userId: me.user.id,
    local: me.local,
    memberships: me.workspaces.map((entry) => ({
      workspaceId: entry.workspace.id,
      role: entry.role,
      projectRoles: entry.projectRoles,
    })),
  });
}

export interface WorkspaceAbilities {
  /** Open the Activity view for the whole workspace (`events.read` by the workspace role). */
  readEvents: boolean;
  /** Open the Activity view for at least one project. */
  readSomeEvents: boolean;
  exportEvents: boolean;
  createProject: boolean;
  updateWorkspace: boolean;
  /** Transfer and delete the workspace: the Owner alone. Settings' Danger zone. */
  deleteWorkspace: boolean;
  readMembers: boolean;
  /** Read agents, their tokens, and the events about them (`agent.read`). */
  readAgents: boolean;
  manageMembers: boolean;
  /** Read the cards of at least one project: Your turn and the Board (`card.read`). */
  readSomeCards: boolean;
  /** Read agent sessions somewhere in the workspace: Agent sessions, in Settings
   * (`session.read`). */
  readSomeSessions: boolean;
  /** The assistant's settings page (`assistant.manage`). */
  manageAssistant: boolean;
  /** Make and change routines in at least one project: Settings, Routines (`routine.manage`). */
  manageSomeRoutines: boolean;
  /** Read the builds of at least one project: Ship's Testing (`build.read`). */
  readSomeBuilds: boolean;
  /** Read the gates of at least one project: Ship's Launch and Store listings (`gate.read`). */
  readSomeGates: boolean;
  /** Sync gates, listings and docs in at least one project (`gate.sync`): Settings, Import. */
  syncSomeGates: boolean;
  /** Read the assets of at least one project: Marketing (`asset.read`). */
  readSomeAssets: boolean;
  /** Read decisions of the workspace or of a project: Decisions, in Reference (`decision.read`). */
  readSomeDecisions: boolean;
  /** Read the releases of at least one project: Ship's Releases (`release.read`). */
  readSomeReleases: boolean;
  /** Read the inbox of at least one project: the Inbox tab (`inbox.read`). */
  readSomeInbox: boolean;
  /** Read the money of at least one project: the Money tab (`money.read`). */
  readSomeMoney: boolean;
  /** Read the docs of at least one project: Docs, in Reference (`doc.read`). */
  readSomeDocs: boolean;
  /** Read the links of at least one project: Links, in Reference (`link.read`). */
  readSomeLinks: boolean;
  /** Read the connector installs of the workspace: the Connectors screen (`connector.read`). */
  readConnectors: boolean;
  /** Install, change, run and remove connectors (`connector.manage`). */
  manageConnectors: boolean;
  /**
   * Holds only the Tester role, in one project or more: sees only Testing, with no member
   * list, no event log and no other tab.
   */
  onlyTester: boolean;
}

/** True for a person whose every role in the workspace is Tester. */
export function isOnlyTester(me: Me, workspaceId: string): boolean {
  const membership = me.workspaces.find((entry) => entry.workspace.id === workspaceId);
  if (!membership || membership.role !== null) return false;
  const roles = Object.values(membership.projectRoles);
  return roles.length > 0 && roles.every((role) => role === 'tester');
}

/** A project no role names, so that `can` answers by the workspace role alone. */
const anyProject = '00000000-0000-4000-8000-000000000000';

export function abilitiesIn(me: Me, workspaceId: string): WorkspaceAbilities {
  const principal = principalOf(me);
  const allowed = (action: Parameters<typeof can>[1]) =>
    can(principal, action as 'events.read', { workspaceId }).allowed;
  const membership = me.workspaces.find((entry) => entry.workspace.id === workspaceId);
  const readEvents = allowed('events.read');
  // A project-level read: a workspace role is asked in any project it covers, and a
  // project role in its own project.
  const readsSome = (
    action:
      'release.read' | 'inbox.read' | 'decision.read' | 'money.read' | 'doc.read' | 'link.read',
  ) =>
    (membership?.role !== null &&
      membership?.role !== undefined &&
      can(principal, action, { workspaceId, projectId: anyProject }).allowed) ||
    Object.keys(membership?.projectRoles ?? {}).some(
      (projectId) => can(principal, action, { workspaceId, projectId }).allowed,
    );
  return {
    readEvents,
    readSomeEvents:
      readEvents ||
      Object.keys(membership?.projectRoles ?? {}).some((projectId) =>
        canReadProjectEvents(me, workspaceId, projectId),
      ),
    exportEvents: allowed('events.export'),
    createProject: allowed('project.create'),
    updateWorkspace: allowed('workspace.update'),
    deleteWorkspace: allowed('workspace.delete'),
    readMembers: allowed('member.read'),
    readAgents: allowed('agent.read'),
    manageMembers: can(principal, 'member.manage', { workspaceId }).allowed,
    readSomeCards:
      allowed('card.read') ||
      Object.keys(membership?.projectRoles ?? {}).some(
        (projectId) => can(principal, 'card.read', { workspaceId, projectId }).allowed,
      ),
    readSomeSessions:
      allowed('session.read') ||
      Object.keys(membership?.projectRoles ?? {}).some(
        (projectId) => can(principal, 'session.read', { workspaceId, projectId }).allowed,
      ),
    manageAssistant: allowed('assistant.manage'),
    manageSomeRoutines:
      (membership?.role !== null &&
        membership?.role !== undefined &&
        can(principal, 'routine.manage', { workspaceId, projectId: anyProject }).allowed) ||
      Object.keys(membership?.projectRoles ?? {}).some(
        (projectId) => can(principal, 'routine.manage', { workspaceId, projectId }).allowed,
      ),
    // `build.read` is a project-level action: a workspace role is asked in any project
    // it covers, and a project role in its own project.
    readSomeBuilds:
      (membership?.role !== null &&
        membership?.role !== undefined &&
        can(principal, 'build.read', { workspaceId, projectId: anyProject }).allowed) ||
      Object.keys(membership?.projectRoles ?? {}).some(
        (projectId) => can(principal, 'build.read', { workspaceId, projectId }).allowed,
      ),
    readSomeGates:
      (membership?.role !== null &&
        membership?.role !== undefined &&
        can(principal, 'gate.read', { workspaceId, projectId: anyProject }).allowed) ||
      Object.keys(membership?.projectRoles ?? {}).some(
        (projectId) => can(principal, 'gate.read', { workspaceId, projectId }).allowed,
      ),
    syncSomeGates:
      (membership?.role !== null &&
        membership?.role !== undefined &&
        can(principal, 'gate.sync', { workspaceId, projectId: anyProject }).allowed) ||
      Object.keys(membership?.projectRoles ?? {}).some(
        (projectId) => can(principal, 'gate.sync', { workspaceId, projectId }).allowed,
      ),
    readSomeAssets:
      (membership?.role !== null &&
        membership?.role !== undefined &&
        can(principal, 'asset.read', { workspaceId, projectId: anyProject }).allowed) ||
      Object.keys(membership?.projectRoles ?? {}).some(
        (projectId) => can(principal, 'asset.read', { workspaceId, projectId }).allowed,
      ),
    readSomeDecisions: readsSome('decision.read'),
    readSomeReleases: readsSome('release.read'),
    readSomeInbox: readsSome('inbox.read'),
    readSomeMoney: readsSome('money.read'),
    readSomeDocs: readsSome('doc.read'),
    readSomeLinks: readsSome('link.read'),
    readConnectors: allowed('connector.read'),
    manageConnectors: allowed('connector.manage'),
    onlyTester: isOnlyTester(me, workspaceId),
  };
}

export function testingAbilities(me: Me, workspaceId: string, projectId: string): TestingAbilities {
  const principal = principalOf(me);
  const allowed = (action: Parameters<typeof can>[1]) =>
    can(principal, action as 'build.read', { workspaceId, projectId }).allowed;
  return {
    read: allowed('build.read'),
    readNotes: allowed('step.notes.read'),
    note: allowed('step.note'),
    mark: allowed('step.mark'),
    reply: allowed('step.reply'),
    testers: allowed('build.testers'),
    post: allowed('build.post'),
    createCards: allowed('card.create'),
    archive: allowed('build.archive'),
    readFeedback: allowed('feedback.read'),
    readPeople: allowed('people.read'),
    summarise: canUseFeature(principal, 'summarise_feedback', { workspaceId, projectId }).allowed,
  };
}

/** What the person may do with the cards of one project. */
export interface CardAbilities {
  read: boolean;
  create: boolean;
  update: boolean;
  move: boolean;
  archive: boolean;
  addStatus: boolean;
  /** Read names of people, agents and parties, which the owner field and the holders need. */
  readPeople: boolean;
  /** Read the event log of the project, which is a card's History of moves and edits. */
  readEvents: boolean;
  /** Use Catch me up on the card, when the assistant is available. */
  catchUp: boolean;
}

export function canReadProjectEvents(me: Me, workspaceId: string, projectId: string): boolean {
  return can(principalOf(me), 'events.read', { workspaceId, projectId }).allowed;
}

/**
 * The projects whose Activity the person may open: all of them with a workspace role
 * that reads events, and otherwise the ones where their project role does. A Tester's
 * project is not among them.
 */
export function projectsWithActivity<P extends { id: string }>(
  me: Me,
  workspaceId: string,
  projects: readonly P[],
): P[] {
  return projects.filter((project) => canReadProjectEvents(me, workspaceId, project.id));
}

export function canUpdateProject(me: Me, workspaceId: string, projectId: string): boolean {
  return can(principalOf(me), 'project.update', { workspaceId, projectId }).allowed;
}

export function canArchiveProject(me: Me, workspaceId: string, projectId: string): boolean {
  return can(principalOf(me), 'project.archive', { workspaceId, projectId }).allowed;
}

/** The roles the person may give a member who holds `current` now. */
export function rolesToGive(
  me: Me,
  workspaceId: string,
  current: WorkspaceRole,
  ownerCount: number,
): WorkspaceRole[] {
  const principal = principalOf(me);
  return workspaceRoles.filter(
    (next) =>
      next === current ||
      can(principal, 'member.manage', {
        workspaceId,
        change: { type: 'set_role', current, next, ownerCount },
      }).allowed,
  );
}

/** Whether the person may remove a member who holds `current`. */
export function canRemoveMember(
  me: Me,
  workspaceId: string,
  current: WorkspaceRole | null,
  ownerCount: number,
): boolean {
  const principal = principalOf(me);
  if (current === null) return can(principal, 'member.manage', { workspaceId }).allowed;
  return can(principal, 'member.manage', {
    workspaceId,
    change: { type: 'remove', current, ownerCount },
  }).allowed;
}

/** The roles the person may invite to: workspace roles without a project, project roles
 * with one. */
export function rolesToInvite(me: Me, workspaceId: string, projectId: string | null): Role[] {
  const principal = principalOf(me);
  const candidates: readonly Role[] = projectId === null ? workspaceRoles : projectRoles;
  return candidates.filter(
    (role) =>
      can(principal, 'member.manage', {
        workspaceId,
        change: { type: 'invite', role, projectId },
      }).allowed,
  );
}

/**
 * The project roles the person may give someone in one project: none to
 * themselves, and none to an Owner unless they are an Owner. `target` is the person who
 * would get the role, with the workspace role they hold, null when they hold none.
 */
export function projectRolesToGive(
  me: Me,
  workspaceId: string,
  projectId: string,
  target: { userId: string; role: WorkspaceRole | null },
): ProjectRole[] {
  const principal = principalOf(me);
  return projectRoles.filter(
    (role) =>
      can(principal, 'member.manage', {
        workspaceId,
        change: {
          type: 'set_project_role',
          projectId,
          role,
          userId: target.userId,
          targetRole: target.role,
        },
      }).allowed,
  );
}

/** Whether the person may revoke an invitation that gives `role`. */
export function canRevokeInvitation(me: Me, workspaceId: string, role: Role): boolean {
  return can(principalOf(me), 'member.manage', {
    workspaceId,
    change: { type: 'revoke_invitation', role },
  }).allowed;
}

export type { ProjectRole };

/** Whether the person may make, change and mark seen the routines of a project (`routine.manage`). */
export function canManageRoutines(me: Me, workspaceId: string, projectId: string): boolean {
  return can(principalOf(me), 'routine.manage', { workspaceId, projectId }).allowed;
}

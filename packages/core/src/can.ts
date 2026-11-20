import type { Role, RuleId } from '@turnkeel/protocol';
import {
  isHumanOnly,
  isRead,
  type Action,
  type MembershipAction,
  type TableAction,
} from './actions.js';
import { guards } from './guards.js';
import { messages } from './messages.js';
import {
  effectiveProjectRole,
  isOwnerAnywhere,
  membershipIn,
  projectRoleIn,
  type AgentPrincipal,
  type PersonPrincipal,
  type Principal,
} from './principal.js';

/**
 * The one place that decides who may do what.
 * It answers allow, or deny with a reason and, when one applies, the rule (`R1` to `R85`).
 * A read is an action like any other.
 */
export function can<A extends Action>(
  principal: Principal,
  action: A,
  resource: ResourceFor<A>,
): Decision {
  const fields = resource as AnyResource;
  switch (principal.kind) {
    case 'user':
      return canPerson(principal, action, fields);
    case 'agent':
      return canAgent(principal, action, fields);
    case 'system':
      return canSystem(action);
  }
}

/**
 * The system: a job or a connector. The first job that writes is the one that
 * marks sessions stale. A connector's check records its result on
 * a gate, and on a gate with `pass: check` it alone sets the state. Each later job or
 * connector adds what it writes here.
 */
function canSystem(action: Action): Decision {
  // The recurrence job makes the cards of recurrence rules.
  if (action === 'session.write' || action === 'gate.check' || action === 'card.create') {
    return allow;
  }
  return notBuilt(messages.systemNotBuilt);
}

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The level that judges the action on this resource: the level of its row in the role table,
 * with `either` settled by whether the object has a project. `money.write` on rates
 * is a row of its own at the level `workspace`, and so is `card.update` on a party.
 */
function levelOf(action: TableAction, resource: AnyResource): Exclude<Level, 'either'> {
  if (action === 'money.write' && resource.rates === true) return 'workspace';
  // A party belongs to the workspace: renaming one is judged by the workspace role.
  if (action === 'card.update' && resource.party === true) {
    if (projectOf(resource) !== null) throw new TypeError('A party has no project.');
    return 'workspace';
  }
  const { level } = roleTable[action];
  if (level === 'either') return projectOf(resource) === null ? 'workspace' : 'project';
  if (level === 'project' && projectOf(resource) === null) {
    throw new TypeError(`${action} is a project-level action and needs a projectId.`);
  }
  return level;
}

// --- People -----------------------------------------------------------------------

function canPerson(principal: PersonPrincipal, action: Action, resource: AnyResource): Decision {
  const membershipCheck = membershipChecks[action as MembershipAction];
  if (membershipCheck) return membershipCheck(principal, resource);

  // R4: a person always reads their own notes and marks, whatever
  // their role. That is a read of the build they are on.
  if (action === 'step.notes.read' && isSelf(principal, resource.ownerId)) {
    return canPerson(principal, 'build.read', {
      workspaceId: resource.workspaceId,
      projectId: resource.projectId,
    });
  }

  const tableAction = action as TableAction;
  const workspaceId = resource.workspaceId ?? '';
  const projectId = projectOf(resource);

  // R1: with nothing in the workspace, the person cannot learn that it exists.
  const membership = membershipIn(principal, workspaceId);
  if (!membership) return hide();

  // R1: the same for a project the person has no role in.
  if (projectId !== null && effectiveProjectRole(membership, projectId) === null) return hide();

  let role: Role | null;
  if (levelOf(tableAction, resource) === 'project') {
    // R2: the project role, else the workspace role. An Owner stays Owner.
    role = effectiveProjectRole(membership, projectId ?? '');
  } else {
    // R30: a workspace-level action is judged by the workspace role only.
    role = membership.role;
  }

  if (role === null) {
    // R1: an item with no project is out of sight of a person who holds only project
    // roles, so a read of one is the one 404, as for an agent without workspaceWide.
    // The workspace itself they see, so a workspace-level action, a write, and the
    // workspace's own event list are refused with R30.
    if (
      isRead(tableAction) &&
      roleTable[tableAction].level === 'either' &&
      tableAction !== 'events.read'
    ) {
      return hide();
    }
    return forbid(messages.workspaceLevel, 'R30');
  }
  const rule = roleTable[tableAction];
  if (!rule.roles.includes(role)) {
    // An action of an opt-in scope has no role: it is an agent's, on a person's word.
    if (rule.roles.length === 0) return forbid(messages.agentsOnly, 'R83');
    return forbid(messages.needsRole(rule.roles), ruleFor(tableAction, role));
  }

  // R46: a file is read through an item the person may read.
  if (action === 'file.read') return fileRead(principal, resource);

  const guard = guards[tableAction];
  return guard ? guard(role, resource, principal) : allow;
}

/** What R7 says a Member cannot do. */
const notForMembers: ReadonlySet<Action> = new Set<Action>([
  'asset.decide',
  'decision.decide',
  'post.approve',
  'release.publish',
  'member.manage',
  'agent.manage',
  'connector.manage',
  'assistant.manage',
  'money.write',
]);

/** The rule that tells a role it may not do an action, when there is one. */
function ruleFor(action: Action, role: Role): RuleId | undefined {
  // R8: only an Owner can delete or transfer the workspace.
  if (action === 'workspace.delete' || action === 'workspace.transfer') return 'R8';
  // R3: a Tester does nothing outside Testing.
  if (role === 'tester') return 'R3';
  if (isRead(action)) return undefined;
  // R5 and R6: a Viewer writes nothing, and a Reviewer writes only what the table gives the role.
  if (role === 'viewer') return 'R5';
  if (role === 'reviewer') return 'R6';
  // R7: what a Member cannot do.
  if (role === 'member' && notForMembers.has(action)) return 'R7';
  return undefined;
}

const isSelf = (principal: PersonPrincipal, userId: string | undefined) =>
  userId !== undefined && sameId(principal.userId, userId);

type MembershipCheck = (principal: PersonPrincipal, resource: AnyResource) => Decision;

const membershipChecks: Partial<Record<Action, MembershipCheck>> = {
  /** R1: a person sees a workspace when they hold a workspace role or a project role in it. */
  'workspace.read': (principal, resource) =>
    personReach(principal, { workspaceId: resource.workspaceId ?? '' }),

  /**
   * R1: a workspace role covers every project, and a person without one
   * sees only the projects where they hold a project role.
   */
  'project.read': (principal, resource) =>
    personReach(principal, {
      workspaceId: resource.workspaceId ?? '',
      projectId: resource.projectId ?? '',
    }),

  /**
   * R44: a person creates a workspace when open sign-up is on or when
   * they are already an Owner on the server. The local owner always may. On an install
   * that has no workspace yet, whoever signed in first creates the first one.
   */
  'workspace.create': (principal, resource) => {
    if (
      principal.local ||
      resource.openSignup === true ||
      resource.emptyInstall === true ||
      isOwnerAnywhere(principal)
    ) {
      return allow;
    }
    return forbid(messages.workspaceCreate, 'R44');
  },

  /** A person changes their own handle without `member.manage`. Only a member has one. */
  'member.handle': (principal, resource) => {
    const membership = membershipIn(principal, resource.workspaceId ?? '');
    if (!membership) return hide();
    if (!isSelf(principal, resource.userId)) return forbid(messages.ownHandle);
    if (membership.role === null) return forbid(messages.workspaceLevel, 'R30');
    return allow;
  },
};

// --- Both -------------------------------------------------------------------------

/**
 * R46: a file is readable only through an item the principal may read. A file that is
 * attached to nothing yet is read only by whoever uploaded it. An agent also needs a
 * read scope, which the scope check has seen by now.
 */
function fileRead(principal: PersonPrincipal | AgentPrincipal, resource: AnyResource): Decision {
  const workspaceId = resource.workspaceId ?? '';
  const projectId = projectOf(resource);
  const attachedTo = resource.attachedTo ?? [];
  if (attachedTo.length === 0) {
    const uploader = resource.uploadedBy;
    const self =
      principal.kind === 'user'
        ? { kind: 'user', id: principal.userId }
        : { kind: 'agent', id: principal.agentId };
    return uploader !== undefined && uploader.kind === self.kind && sameId(uploader.id, self.id)
      ? allow
      : hide('R46');
  }
  if (principal.kind === 'agent' && !hasReadScope(principal.scopes)) {
    return forbid(messages.noScope('file.read'), 'R12');
  }
  for (const purpose of attachedTo) {
    // A receipt is read through Money's cost lines, which no agent reads.
    if (purpose === 'receipt' && principal.kind === 'agent') continue;
    const read = fileReadActions[purpose];
    if (can(principal, read, { workspaceId, projectId }).allowed) return allow;
  }
  return hide('R46');
}

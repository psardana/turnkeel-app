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
import type { AnyResource, ResourceFor } from './resource.js';
import { roleTable, type Level } from './role-table.js';
import {
  actionsOfScopes,
  fileReadActions,
  hasReadScope,
  humanOnlyRule,
  isOnWordAction,
  onWordActions,
  onWordRule,
  onWordScopeOf,
  uploadScopes,
  type OnWordAction,
} from './scopes.js';

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

/** The `projectId` of a resource: null for an object with no project. */
const projectOf = (resource: AnyResource): string | null => resource.projectId ?? null;

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

// --- Reach ------------------------------------------------------------------------

/** A workspace, or one project in it: what a request names before it says what it does there. */
export interface Place {
  readonly workspaceId: string;
  readonly projectId?: string | null;
}

/**
 * R1, R11: whether the principal reaches a workspace, or a project in it, at all. It
 * says nothing about what the principal may do there, which `can` answers. A request
 * that names a place asks this first, and anything out of reach is the one 404.
 *
 * - A person reaches a workspace where they hold a workspace role or a project role,
 *   and a project there when the workspace role covers it or they hold a role in it.
 * - An agent reaches its token's workspace, and the projects on its token. A project of
 *   that workspace that is not on the token is out of reach by R11.
 */
export function canReach(principal: Principal, place: Place): Decision {
  switch (principal.kind) {
    case 'user':
      return personReach(principal, place);
    case 'agent':
      return agentReach(principal, place);
    case 'system':
      return notBuilt(messages.systemNotBuilt);
  }
}

function personReach(principal: PersonPrincipal, place: Place): Decision {
  const membership = membershipIn(principal, place.workspaceId);
  if (!membership) return hide();
  const projectId = place.projectId ?? null;
  if (projectId === null || membership.role !== null) return allow;
  return projectRoleIn(membership, projectId) ? allow : hide();
}

function agentReach(principal: AgentPrincipal, place: Place): Decision {
  if (!sameId(place.workspaceId, principal.workspaceId)) return hide();
  const projectId = place.projectId ?? null;
  if (projectId !== null && !onToken(principal, projectId)) return hide('R11');
  return allow;
}

// --- Agents -----------------------------------------------------------------------

const onToken = (principal: AgentPrincipal, projectId: string) =>
  principal.projectIds.some((id) => sameId(id, projectId));

/**
 * An agent acts through one token. It may do an action only when the token
 * reaches the object, the action is not human-only, and a scope on the
 * token allows it.
 */
function canAgent(principal: AgentPrincipal, action: Action, resource: AnyResource): Decision {
  // R44: a workspace is created by a person. R13: a handle belongs to a person.
  if (action === 'workspace.create') return forbid(messages.humanOnly, 'R44');
  if (action === 'member.handle') return forbid(messages.humanOnly, 'R13');

  // R1: a token of another workspace learns nothing about this one.
  if (!sameId(resource.workspaceId ?? '', principal.workspaceId)) return hide();

  const projectId = projectOf(resource);
  // R12: no scope reads the workspace or a project as such. Their rows carry names,
  // which reach an agent only wrapped, and an agent names its project by
  // key. What the token reaches is asked of `canReach`. A project that is not on the
  // token is out of reach, and answered as R1.
  if (action === 'workspace.read' || action === 'project.read') {
    const reach = agentReach(principal, { workspaceId: principal.workspaceId, projectId });
    if (!reach.allowed) return hide();
    return forbid(messages.noScopeReadsPlaces, 'R12');
  }
  const tableAction = action;

  // A session belongs to its agent, not to a project. `session.write` is
  // checked against the token's agent and workspace, with no project and no workspaceWide.
  if (tableAction === 'session.write') {
    if (resource.agentId !== undefined && !sameId(resource.agentId, principal.agentId)) {
      return hide();
    }
    return scopeAllows(principal, tableAction, resource);
  }

  if (projectId !== null && !onToken(principal, projectId)) return hide('R11');

  // R84: a token sees and reports the runs of its own agent's routines, and no others.
  if (
    tableAction === 'routine.run' &&
    resource.agentId !== undefined &&
    !sameId(resource.agentId, principal.agentId)
  ) {
    return hide();
  }

  // R13: never a human-only action, whatever the token holds.
  if (isHumanOnly(tableAction)) return forbid(messages.humanOnly, humanOnlyRule(tableAction));

  levelOf(tableAction, resource);
  // R11: an object with no project only for a token with workspaceWide. A read of one
  // is answered as if it were not there.
  if (projectId === null && !principal.workspaceWide) {
    return isRead(tableAction) ? hide() : forbid(messages.noWorkspaceWide, 'R11');
  }

  const scoped = scopeAllows(principal, tableAction, resource);
  if (!scoped.allowed) return scoped;
  if (isOnWordAction(tableAction)) {
    const word = onWordOfAllows(tableAction, resource);
    if (!word.allowed) return word;
  }
  // A receipt is Money's: its upload, too, is on the word of a person who may write
  // Money there.
  if (tableAction === 'file.upload' && resource.purpose === 'receipt') {
    const word = receiptWordAllows(resource);
    if (!word.allowed) return word;
  }
  return agentLimits(principal, tableAction, resource);
}

/** R83 for the upload of a receipt: the person may take `money.write` there themselves. */
function receiptWordAllows(resource: AnyResource): Decision {
  const person = resource.onWordOf ?? null;
  if (person === null) return forbid(messages.onWordNoPerson, 'R83');
  const answer = can(person, 'money.write', {
    workspaceId: resource.workspaceId ?? '',
    projectId: projectOf(resource),
  });
  return answer.allowed ? allow : forbid(messages.onWordPersonMayNot('money.write'), 'R83');
}

/** R12: a scope on the token must allow the action. An upload is allowed only for its purpose. */
function scopeAllows(
  principal: AgentPrincipal,
  action: TableAction,
  resource: AnyResource,
): Decision {
  if (action === 'file.upload') {
    const { purpose } = resource;
    if (purpose === undefined) return forbid(messages.uploadPurposeMissing, 'R47');
    const scope = uploadScopes[purpose];
    if (scope === null || !principal.scopes.includes(scope)) {
      return forbid(messages.uploadPurpose(purpose), 'R47');
    }
    return allow;
  }
  if (actionsOfScopes(principal.scopes).has(action)) return allow;
  // An action of an opt-in scope is refused, without the scope, under the rule that kept
  // it a person's.
  if (isOnWordAction(action) && action !== 'decision.relay') {
    return forbid(messages.noOptInScope(action, onWordScopeOf(action)), onWordRule(action));
  }
  return forbid(messages.noScope(action), 'R12');
}

/** The limits some actions have for an agent beyond its scopes. */
function agentLimits(
  principal: AgentPrincipal,
  action: TableAction,
  resource: AnyResource,
): Decision {
  switch (action) {
    case 'decision.propose': {
      // R15: an agent records a decision as proposed, and says nothing about what it supersedes.
      if (resource.supersedes === true) return forbid(messages.agentDecision, 'R15');
      if (resource.status !== undefined && resource.status !== 'proposed') {
        return forbid(messages.agentDecision, 'R15');
      }
      if (resource.edit) {
        // R38: an edit only while proposed, and only of its own decision.
        if (resource.edit.status !== 'proposed') {
          return forbid(messages.decisionEditProposed, 'R38');
        }
        const recorder = resource.edit.recordedBy;
        if (recorder.kind !== 'agent' || !sameId(recorder.id, principal.agentId)) {
          return forbid(messages.decisionEditOthers, 'R38');
        }
      }
      return allow;
    }
    case 'decision.relay':
      // R15 as amended: with decisions:decide, on the word of a person who
      // may decide (checked above), accepted, rejected or parked, and nothing else.
      if (resource.supersedes === true) return forbid(messages.relayStatus, 'R15');
      // A decision that supersedes another replaces it when it changes: a person's.
      if (resource.replaces === true) return conflict(messages.relayReplaces, 'R15');
      return resource.status === 'accepted' ||
        resource.status === 'rejected' ||
        resource.status === 'parked'
        ? allow
        : forbid(messages.relayStatus, 'R15');
    case 'money.write':
      // money:write covers cost lines, receipts, plans and rates; a scenario of the
      // calculator stays a person's.
      return resource.scenario === true ? forbid(messages.scenarioPersonOnly, 'R13') : allow;
    case 'signal.write':
      // R42: an agent's Signal is one of Money's four kinds, a post's two, a post's
      // four counts on its network or a channel's followers.
      return resource.kind === undefined ||
        [
          'cost',
          'revenue',
          'usage',
          'subscribers',
          'clicks',
          'signups',
          'views',
          'likes',
          'comments',
          'shares',
          'followers',
        ].includes(resource.kind)
        ? allow
        : forbid(messages.signalKind, 'R42');
    case 'file.read':
      return fileRead(principal, resource);
    case 'milestone.write':
      // R75: the launch milestone carries the project's launch date, so any change of it
      // needs `project.update`, which no token holds.
      return resource.launch === true ? forbid(messages.launchMilestone, 'R75') : allow;
    case 'gate.check':
      // R16: an agent's check sets the state only of a `pass: agent` gate. On any other
      // gate it adds evidence and leaves the state as it was.
      return resource.setsState === true && resource.pass !== 'agent'
        ? forbid(messages.gateAgentCheck, 'R16')
        : allow;
    default:
      return allow;
  }
}

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

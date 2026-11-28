import {
  projectRoles,
  workspaceRoles,
  type ProjectRole,
  type Role,
  type WorkspaceRole,
} from '@turnkeel/protocol';
import type { TableAction } from './actions.js';
import { allow, conflict, forbid, type Decision } from './decision.js';
import { messages } from './messages.js';
import type { PersonPrincipal } from './principal.js';
import type { AnyResource, MemberChange } from './resource.js';
import { roleTable } from './role-table.js';

/**
 * A limit that an action has beyond its row in the role table. A guard runs after the
 * table has said yes, with the role that judged the action and the person who asks.
 */
export type Guard = (role: Role, resource: AnyResource, principal: PersonPrincipal) => Decision;

const isWorkspaceRole = (role: Role): role is WorkspaceRole =>
  (workspaceRoles as readonly Role[]).includes(role);

const isProjectRole = (role: Role): role is ProjectRole =>
  (projectRoles as readonly Role[]).includes(role);

/**
 * R31: nobody gives a role above their own. Owner is above Admin, and Admin is above
 * the other four, which are one rank.
 */
function rank(role: Role): number {
  return role === 'owner' ? 0 : role === 'admin' ? 1 : 2;
}

function aboveOwn(actor: Role, given: Role): boolean {
  return rank(given) < rank(actor);
}

function memberChange(actor: Role, change: MemberChange, principal: PersonPrincipal): Decision {
  const actorIsOwner = actor === 'owner';

  switch (change.type) {
    case 'invite': {
      if (change.projectId) {
        // R30: a project role is one of Member, Reviewer, Tester or Viewer.
        return isProjectRole(change.role) ? allow : forbid(messages.projectRoleKinds, 'R30');
      }
      // R32: Tester is never a workspace role, so a Tester invitation must name a project.
      if (!isWorkspaceRole(change.role)) return forbid(messages.testerNeedsProject, 'R32');
      // R31: only an Owner gives the Owner role, and nobody gives a role above their own.
      if (change.role === 'owner' && !actorIsOwner) return forbid(messages.ownerRole, 'R31');
      if (aboveOwn(actor, change.role)) return forbid(messages.roleAboveOwn, 'R31');
      return allow;
    }

    case 'revoke_invitation':
      // R31 limits revoking as it limits inviting (notes).
      if (change.role === 'owner' && !actorIsOwner) return forbid(messages.ownerRole, 'R31');
      return allow;

    case 'set_role': {
      if (!isWorkspaceRole(change.next)) return forbid(messages.testerNeedsProject, 'R32');
      // R31: only an Owner gives the Owner role, or changes an Owner.
      if ((change.next === 'owner' || change.current === 'owner') && !actorIsOwner) {
        return forbid(messages.ownerRole, 'R31');
      }
      if (aboveOwn(actor, change.next)) return forbid(messages.roleAboveOwn, 'R31');
      // R9: the last Owner cannot be lowered.
      if (change.current === 'owner' && change.next !== 'owner' && change.ownerCount <= 1) {
        return forbid(messages.lastOwner, 'R9');
      }
      return allow;
    }

    case 'remove':
      // R31: only an Owner removes an Owner.
      if (change.current === 'owner' && !actorIsOwner) return forbid(messages.ownerRole, 'R31');
      // R9: the last Owner cannot be removed.
      if (change.current === 'owner' && change.ownerCount <= 1) {
        return forbid(messages.lastOwner, 'R9');
      }
      return allow;

    case 'set_project_role':
      // R30: a project role is one of Member, Reviewer, Tester or Viewer.
      if (!isProjectRole(change.role)) return forbid(messages.projectRoleKinds, 'R30');
      return projectRoleOf(actorIsOwner, change, principal);

    case 'remove_project_role':
      return projectRoleOf(actorIsOwner, change, principal);
  }
}

/**
 * The limits on giving or taking away someone's project role. Nobody does it to
 * themselves, and only an Owner does it to an Owner.
 */
function projectRoleOf(
  actorIsOwner: boolean,
  change: { readonly userId: string; readonly targetRole: WorkspaceRole | null },
  principal: PersonPrincipal,
): Decision {
  if (isSelf(principal, change.userId)) return forbid(messages.ownProjectRole);
  if (change.targetRole === 'owner' && !actorIsOwner) return forbid(messages.ownerRole, 'R31');
  return allow;
}

const isSelf = (principal: PersonPrincipal, userId: string | undefined) =>
  userId !== undefined && userId.toLowerCase() === principal.userId.toLowerCase();

/** True when the role may take `decision.decide`, which is judged at the same level as `decision.propose`. */
const decides = (role: Role) => roleTable['decision.decide'].roles.includes(role);

/** A person writes only their own notes and marks (`step.note` and `step.mark` are "own"). */
const ownNote: Guard = (_role, resource, principal) =>
  resource.ownerId === undefined || isSelf(principal, resource.ownerId)
    ? allow
    : forbid(messages.ownNotes);

/** R75: what changes the launch milestone, its date or anything else, or removes it, needs `project.update` too. */
const launchNeedsProjectUpdate: Guard = (role, resource) =>
  resource.launch === true && !roleTable['project.update'].roles.includes(role)
    ? forbid(messages.launchMilestone, 'R75')
    : allow;

/** The actions that have a limit of their own. */
export const guards: Partial<Record<TableAction, Guard>> = {
  'member.manage': (role, resource, principal) =>
    resource.change ? memberChange(role, resource.change, principal) : allow,

  // R4: a Tester reads the replies under the steps they wrote on, and no others.
  'build.read': (role, resource) =>
    role === 'tester' && resource.reply !== undefined && !resource.reply.onStepTheCallerNoted
      ? forbid(messages.testerReplies, 'R4')
      : allow,

  'step.note': ownNote,
  'step.mark': ownNote,

  // R83: an opt-in scope is given only by an Owner, by name.
  'agent.manage': (role, resource) =>
    resource.optInScopes === true && role !== 'owner'
      ? forbid(messages.optInOwnerOnly, 'R83')
      : allow,

  'decision.propose': (role, resource, principal) => {
    // R38: only a person with decision.decide says which decision this one replaces.
    if (resource.supersedes === true && !decides(role)) {
      return forbid(messages.decideToSupersede, 'R38');
    }
    // R23: every status change needs decision.decide, recording as accepted included.
    if (resource.status !== undefined && resource.status !== 'proposed' && !decides(role)) {
      return forbid(messages.decideToRecord, 'R23');
    }
    if (resource.edit) {
      // R38: an edit only while proposed, by whoever recorded it or by someone who decides.
      if (resource.edit.status !== 'proposed') return forbid(messages.decisionEditProposed, 'R38');
      const recorder = resource.edit.recordedBy;
      const ownDecision = recorder.kind === 'user' && isSelf(principal, recorder.id);
      if (!ownDecision && !decides(role)) return forbid(messages.decisionEditOthers, 'R38');
    }
    return allow;
  },

  // R16: the state of a `pass: check` gate is set only by its connector check, so a
  // person cannot set or reopen it either. The answer is 409.
  'gate.pass': (_role, resource) =>
    resource.pass === 'check' ? conflict(messages.gateSetByCheck, 'R16') : allow,

  // R16: a check that a person records adds evidence. It sets no state of a `pass: check` gate.
  'gate.check': (_role, resource) =>
    resource.setsState === true && resource.pass === 'check'
      ? forbid(messages.gateSetByCheck, 'R16')
      : allow,

  // R75: a change of the launch milestone, and its removal, need `project.update` as well.
  'milestone.write': launchNeedsProjectUpdate,
  'planning.remove': launchNeedsProjectUpdate,

  // Uploading a receipt's file needs money.write as well.
  'file.upload': (role, resource) =>
    resource.purpose === 'receipt' && !roleTable['money.write'].roles.includes(role)
      ? forbid(messages.receiptNeedsMoney)
      : allow,
};

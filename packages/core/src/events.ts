import { eventAreaOf, type EventType, type Ref } from '@turnkeel/protocol';
import { can, canReach } from './can.js';
import { allow, hide, notBuilt, type Decision } from './decision.js';
import { messages } from './messages.js';

/** The part of an event that decides who may see it. */
export interface EventToRead {
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly type: EventType;
  /** `owner` is set when the subject belongs to one person, such as a tester's note. */
  readonly subject?: { readonly type?: string; readonly owner?: Ref | undefined };
  readonly actor?: { readonly kind: string; readonly id: string };
  /** `step.replied` carries `noteAuthors`: the people with a note on the step then. */
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * R27: whether an event may reach a principal, in the stream or in a list. An event
 * about members or invitations needs `member.read`, and one about agents and tokens,
 * `access.denied` included, needs `agent.read`. An event about a project needs the
 * project to be one the principal sees, and an event about the workspace the workspace.
 * An event about a card needs `card.read` in the card's project, and the rename of a
 * party, which belongs to the workspace, a role that reads names somewhere in it.
 * An agent gets less (`agentReadsWorkspaceEvent`). A denial is always `not_found`: an
 * event the principal may not read does not exist for it.
 *
 * This is separate from `events.read`, which opens the Activity view and the event
 * list. The stream needs no `events.read`.
 */
export function canReadEvent(principal: Principal, event: EventToRead): Decision {
  let decision: Decision;
  switch (eventAreaOf(event.type)) {
    case 'people':
      decision = can(principal, 'member.read', { workspaceId: event.workspaceId });
      break;
    case 'agents':
      decision = can(principal, 'agent.read', { workspaceId: event.workspaceId });
      break;
    case 'workspace':
      decision =
        principal.kind === 'agent'
          ? agentReadsWorkspaceEvent(principal, event)
          : canReach(principal, { workspaceId: event.workspaceId, projectId: event.projectId });
      break;
    case 'board':
      decision =
        event.type === 'party.renamed'
          ? partyEventReach(principal, event.workspaceId)
          : event.projectId === null
            ? hide()
            : can(principal, 'card.read', {
                workspaceId: event.workspaceId,
                projectId: event.projectId,
              });
      break;
    case 'launch':
      decision = inProject(
        principal,
        event.type.startsWith('listing.') ? 'listing.read' : 'gate.read',
        event,
      );
      break;
    case 'connectors':
      // R27: events about connectors reach only whoever may read the installs.
      decision = can(principal, 'connector.read', { workspaceId: event.workspaceId });
      break;
    case 'review':
      // A post's events are read under post.read, the rest of Review under asset.read.
      decision = inProject(
        principal,
        event.type.startsWith('post.') ? 'post.read' : 'asset.read',
        event,
      );
      break;
    case 'testing': {
      // A tester's note or mark is read under step.notes.read, which a person always has
      // for their own; everything else of a build under build.read.
      const owner = event.subject?.owner;
      decision =
        event.projectId === null
          ? hide()
          : event.type === 'step.replied'
            ? replyReach(principal, event)
            : // That the feedback was read tells only whoever reads every note.
              event.type === 'feedback.read'
              ? can(principal, 'step.notes.read', {
                  workspaceId: event.workspaceId,
                  projectId: event.projectId,
                  ownerId: '',
                })
              : owner !== undefined && owner.kind === 'user'
                ? can(principal, 'step.notes.read', {
                    workspaceId: event.workspaceId,
                    projectId: event.projectId,
                    ownerId: owner.id,
                  })
                : can(principal, 'build.read', {
                    workspaceId: event.workspaceId,
                    projectId: event.projectId,
                  });
      break;
    }
    case 'decisions':
      decision = can(principal, 'decision.read', {
        workspaceId: event.workspaceId,
        projectId: event.projectId,
      });
      break;
    case 'releases':
      // Releases and the Changes a connector brought in, under release.read.
      decision = inProject(principal, 'release.read', event);
      break;
    case 'inbox':
      decision = inProject(principal, 'inbox.read', event);
      break;
    case 'money':
      // Signals, plans, cost lines, scenarios and rates, under money.read; one with
      // no project (a workspace cost line, a rate) by the workspace role, and for an agent
      // only with `workspaceWide`.
      decision = can(principal, 'money.read', {
        workspaceId: event.workspaceId,
        projectId: event.projectId,
      });
      break;
    case 'sessions':
      // No scope reads sessions; a person reads them under session.read.
      decision = can(principal, 'session.read', {
        workspaceId: event.workspaceId,
        projectId: event.projectId,
      });
      break;
    case 'files':
      // An upload that completed is attached to nothing yet, so only its uploader reads it.
      decision =
        event.projectId === null || event.actor === undefined
          ? hide()
          : can(principal, 'file.read', {
              workspaceId: event.workspaceId,
              projectId: event.projectId,
              attachedTo: [],
              uploadedBy: { kind: event.actor.kind as 'user', id: event.actor.id },
            });
      break;
    case 'docs':
      // A sync of the docs under doc.read in its project; a change of a link group
      // or a link under link.read, by the workspace role for a group of the whole workspace.
      // No scope reads links, so `links.changed` reaches no agent token.
      decision =
        event.type === 'docs.synced'
          ? inProject(principal, 'doc.read', event)
          : can(principal, 'link.read', {
              workspaceId: event.workspaceId,
              projectId: event.projectId,
            });
      break;
    case 'assistant':
      decision = assistantEventReach(principal, event);
      break;
    case 'planning':
      decision = planningEventReach(principal, event);
      break;
    case 'import':
      decision = importEventReach(principal, event);
      break;
    case 'routines':
      decision = routineEventReach(principal, event);
      break;
    default:
      return notBuilt(messages.notBuilt(`reading ${String(event.type)}`));
  }
  return decision.allowed ? decision : hide();
}

/**
 * Whether a message about an event may name its actor's id. A principal who
 * reads only their own notes in the event's project (a Tester) learns who acted on a
 * build by kind alone, unless it was them, as the build's answers name people to them.
 * Everyone else gets the id.
 */
export function streamShowsActor(principal: Principal, event: EventToRead): boolean {
  if (eventAreaOf(event.type) !== 'testing' || event.projectId === null) return true;
  if (
    principal.kind === 'user' &&
    event.actor?.kind === 'user' &&
    event.actor.id.toLowerCase() === principal.userId.toLowerCase()
  ) {
    return true;
  }
  return can(principal, 'step.notes.read', {
    workspaceId: event.workspaceId,
    projectId: event.projectId,
    ownerId: '',
  }).allowed;
}

/**
 * What an agent gets of the Workspace area. No scope reads a workspace or a
 * project as such, so:
 *
 * - `project.*` events reach no agent token. Each item kind an agent reads in a project
 *   has its events judged by its read action.
 * - An event with no project reaches a token only with `workspaceWide`, as any object
 *   with no project does.
 * - `workspace.deleted` reaches every token of the workspace: it is the moment all
 *   access stops, and the stream ends on it.
 */
function agentReadsWorkspaceEvent(principal: AgentPrincipal, event: EventToRead): Decision {
  const reach = canReach(principal, { workspaceId: event.workspaceId });
  if (!reach.allowed) return reach;
  if (event.type === 'workspace.deleted') return allow;
  if (event.projectId !== null || event.type.startsWith('project.')) return hide();
  return principal.workspaceWide ? allow : hide('R11');
}

/**
 * The assistant's events reach people only, never an agent token and never a
 * Tester. `assistant.called` is read under the read action of the item the call was for.
 * `assistant.settings_changed` has no project and reaches every other person of
 * the workspace, one with only project roles included, because a message names changed
 * fields and gives no values.
 */
function assistantEventReach(principal: Principal, event: EventToRead): Decision {
  if (principal.kind !== 'user') return hide();
  const membership = membershipIn(principal, event.workspaceId);
  if (!membership) return hide();
  const onlyTester =
    membership.role === null &&
    Object.values(membership.projectRoles).every((role) => role === 'tester');
  if (onlyTester) return hide();
  if (event.type === 'assistant.settings_changed') return allow;
  if (event.projectId === null) return hide();
  const where = { workspaceId: event.workspaceId, projectId: event.projectId };
  if (effectiveProjectRole(membership, event.projectId) === 'tester') return hide();
  switch (event.subject?.type) {
    case 'card':
      return can(principal, 'card.read', where);
    case 'build':
      return can(principal, 'build.read', where);
    default:
      return hide();
  }
}

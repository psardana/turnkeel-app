import type {
  DecisionStatus,
  FilePurpose,
  PrincipalRef,
  ProjectRole,
  Role,
  SignalKind,
  WorkspaceRole,
} from '@turnkeel/protocol';
import type { Action } from './actions.js';

/** Where an action happens. `projectId` is null or left out for an object with no project. */
export interface WorkspaceResource {
  readonly workspaceId: string;
  readonly projectId?: string | null;
  /**
   * For an action of an opt-in scope: the person whose word an agent acts on, as
   * the server holds them, or null when the request named nobody. A person's own request
   * leaves it out.
   */
  readonly onWordOf?: PersonPrincipal | null;
}

/** A project-level action always names its project. */
export interface ProjectResource {
  readonly workspaceId: string;
  readonly projectId: string;
  /** As in `WorkspaceResource`: the person an agent acts for, under an opt-in scope. */
  readonly onWordOf?: PersonPrincipal | null;
}

/**
 * What `member.manage` is asked to do. The limits of R9, R31 and R32 depend on it.
 * Without a change the question is only whether the person manages members at all,
 * which is what listing the invitations needs.
 */
export type MemberChange =
  /** Create an invitation. With `projectId` the role is a project role. */
  | { readonly type: 'invite'; readonly role: Role; readonly projectId?: string | null }
  /** Revoke an invitation, under the same limit as creating it. */
  | { readonly type: 'revoke_invitation'; readonly role: Role }
  /** Change a member's workspace role. `ownerCount` is how many Owners the workspace has now. */
  | {
      readonly type: 'set_role';
      readonly current: WorkspaceRole;
      readonly next: WorkspaceRole;
      readonly ownerCount: number;
    }
  /** Remove a member from the workspace. */
  | { readonly type: 'remove'; readonly current: WorkspaceRole; readonly ownerCount: number }
  /**
   * Give a person who has an account a role in one project. `userId` is that person,
   * and `targetRole` the workspace role they hold now, null when they hold none: only
   * an Owner sets the project role of an Owner, and nobody sets their own.
   */
  | {
      readonly type: 'set_project_role';
      readonly projectId: string;
      readonly role: ProjectRole;
      readonly userId: string;
      readonly targetRole: WorkspaceRole | null;
    }
  /** Take a person's role in one project away, under the same limits as giving one. */
  | {
      readonly type: 'remove_project_role';
      readonly projectId: string;
      readonly userId: string;
      readonly targetRole: WorkspaceRole | null;
    };

export interface MemberManageResource {
  readonly workspaceId: string;
  readonly change?: MemberChange;
}

/** `workspace.create` is asked of the server, not of a workspace. */
export interface ServerResource {
  /** `TURNKEEL_OPEN_SIGNUP=true`. */
  readonly openSignup: boolean;
  /**
   * True when the server has no workspace at all, deleted ones included. The first
   * person to sign in on such an install creates the first workspace and is its Owner.
   * Left out, it counts as false.
   */
  readonly emptyInstall?: boolean;
}

/** `member.handle`: whose handle is to change. */
export interface HandleResource {
  readonly workspaceId: string;
  readonly userId: string;
}

/**
 * A tester's note or mark, for `step.notes.read`, `step.note` and `step.mark`. `ownerId`
 * is the user id of the person whose note or mark it is. A person always reads and
 * writes their own; nobody writes another person's.
 */
export interface NoteResource extends WorkspaceResource {
  readonly ownerId?: string;
}

/**
 * `build.read`. `reply` is set when what is read is a reply under a step: whether the
 * caller wrote a note on that step. A Tester reads only those replies.
 */
export interface BuildResource extends WorkspaceResource {
  readonly reply?: { readonly onStepTheCallerNoted: boolean };
}

/**
 * `decision.propose`: recording a decision, or editing one while it is `proposed`.
 *
 * - `status` is what a new decision is recorded as; `proposed` unless given. Anything
 *   else is a status change, which needs `decision.decide`; an agent records only
 *   `proposed`.
 * - `supersedes` is true when the request sets `supersedesId`, which needs
 *   `decision.decide` and is never an agent's.
 * - `edit` is set for an edit: who recorded the decision and its status now.
 */
export interface DecisionResource extends WorkspaceResource {
  readonly status?: DecisionStatus;
  readonly supersedes?: boolean;
  readonly edit?: { readonly recordedBy: PrincipalRef; readonly status: DecisionStatus };
}

/**
 * An action an agent takes on a person's word, under an opt-in scope. `onWordOf` is that
 * person as the server holds them, with their memberships, or
 * null when the request named nobody.
 */
export interface OnWordResource extends WorkspaceResource {
  readonly onWordOf: PersonPrincipal | null;
}

/** `money.write`. `rates` is true for currency rates and the rates for a model, which are
 * judged by the workspace role. */
export interface MoneyResource extends WorkspaceResource {
  readonly rates?: boolean;
  /**
   * True for a scenario of the calculator: a person's, which `money:write` does not give.
   * An agent is refused it whatever its scopes.
   */
  readonly scenario?: boolean;
}

/** `signal.write`. An agent writes only some kinds. */
export interface SignalResource extends WorkspaceResource {
  readonly kind?: SignalKind;
}

/** `file.upload`: a file declared for one purpose. A file belongs to a project. */
export interface FileUploadResource extends ProjectResource {
  readonly purpose: FilePurpose;
}

/**
 * `file.read`: a file is read only through an item the principal may read.
 * `attachedTo` holds the purpose of every item the file is attached to. A file that
 * is attached to nothing yet is read only by `uploadedBy`.
 */
export interface FileReadResource extends ProjectResource {
  readonly attachedTo: readonly FilePurpose[];
  readonly uploadedBy?: PrincipalRef;
}

/**
 * `session.write`. `agentId` is the agent whose session it is. An agent writes the
 * sessions of its own agent and no others, whatever projects its token lists.
 */
export interface SessionResource extends WorkspaceResource {
  readonly agentId?: string;
}

/**
 * `card.update`. `party` is true for renaming a party: a party belongs to the workspace,
 * so the rename is judged by the workspace role, and an agent needs `cards:write` and
 * `workspaceWide` (notes). It names no project.
 */
export interface CardUpdateResource extends WorkspaceResource {
  readonly party?: boolean;
}

interface SpecialResources {
  'workspace.create': ServerResource;
  'workspace.read': { readonly workspaceId: string };
  'project.read': ProjectResource;
  'project.update': ProjectResource;
  'project.archive': ProjectResource;
  'member.manage': MemberManageResource;
  'member.handle': HandleResource;
  'agent.manage': AgentManageResource;
  'step.notes.read': NoteResource;
  'step.note': NoteResource;
  'step.mark': NoteResource;
  'build.read': BuildResource;
  'decision.propose': DecisionResource;
  'decision.relay': RelayResource;
  'money.write': MoneyResource;
  'signal.write': SignalResource;
  'file.upload': FileUploadResource;
  'file.read': FileReadResource;
  'session.write': SessionResource;
  'routine.run': RoutineRunResource;
  'gate.pass': GateResource;
  'gate.check': GateResource;
  'card.update': CardUpdateResource;
  'milestone.write': MilestoneResource;
  'planning.remove': MilestoneResource;
}

/** The resource `can` takes for an action. */
export type ResourceFor<A extends Action> = A extends keyof SpecialResources
  ? SpecialResources[A]
  : WorkspaceResource;

/** Every field a resource can have. `can` reads the ones the action needs. */
export interface AnyResource {
  readonly workspaceId?: string;
  readonly projectId?: string | null;
  readonly change?: MemberChange;
  readonly openSignup?: boolean;
  readonly emptyInstall?: boolean;
  readonly userId?: string;
  readonly ownerId?: string;
  readonly reply?: BuildResource['reply'];
  readonly status?: DecisionStatus;
  readonly supersedes?: boolean;
  readonly edit?: DecisionResource['edit'];
  readonly rates?: boolean;
  readonly kind?: SignalKind;
  readonly purpose?: FilePurpose;
  readonly attachedTo?: readonly FilePurpose[];
  readonly uploadedBy?: PrincipalRef;
  readonly agentId?: string;
  readonly pass?: GatePass;
  readonly reopen?: boolean;
  readonly setsState?: boolean;
  readonly party?: boolean;
  readonly launch?: boolean;
  readonly onWordOf?: PersonPrincipal | null;
  readonly optInScopes?: boolean;
  readonly replaces?: boolean;
  readonly scenario?: boolean;
}

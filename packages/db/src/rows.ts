import type {
  Change,
  InboxItem,
  Release,
  Post,
  AgentSession,
  Asset,
  AssetDecision,
  AssetGroup,
  AssetNote,
  AssetVariant,
  Build,
  Decision,
  Feature,
  FileInfo,
  Gate,
  Step,
  StepMark,
  StepNote,
  StepReply,
  Agent,
  AgentScope,
  AgentToken,
  Card,
  CardTile,
  Party,
  StatusLine,
  Invitation,
  Member,
  PrincipalRef,
  Project,
  ProjectMember,
  User,
  Workspace,
  ChecklistItem,
  Label,
  LabelTag,
  Milestone,
  MilestoneBrief,
  Epic,
  EpicBrief,
  SavedView,
  TimeEntry,
} from '@turnkeel/protocol';
import type {
  agentSessions,
  assetDecisions,
  assetGroups,
  assetNotes,
  assetVariants,
  assets,
  builds,
  assistantCalls,
  connectorInstalls,
  listingRows,
  listings,
  assistantSettings,
  decisions,
  features,
  files,
  gateEvidence,
  gates,
  stepMarks,
  stepNotes,
  stepReplies,
  steps,
  agentTokens,
  agents,
  cards,
  invitations,
  parties,
  members,
  projectMembers,
  projects,
  statusLines,
  user,
  workspaces,
  checklistItems,
  labels,
  epics,
  milestones,
  recurrenceRules,
  savedViews,
  timeEntries,
  posts,
  reviewSeen,
  postSuggestionsHidden,
  releases,
  changes,
  inboxItems,
  personViews,
} from './schema/index.js';

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type MemberRow = typeof members.$inferSelect;
export type ProjectMemberRow = typeof projectMembers.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;
export type UserRow = typeof user.$inferSelect;
export type AgentRow = typeof agents.$inferSelect;
export type AgentTokenRow = typeof agentTokens.$inferSelect;

/** Who writes a row, and when. `at` is the server's clock unless given. */
export interface Stamp {
  by: PrincipalRef;
  at?: Date;
  /**
   * A new row's `createdAt` when it is not `at`. Only the importer gives one: it writes the
   * times its source gives, a card's oldest known time and its `updatedAt`.
   */
  createdAt?: Date;
}

/** The four columns a new row gets from a stamp. */
export function created(stamp: Stamp) {
  const at = stamp.at ?? new Date();
  return {
    createdAt: stamp.createdAt ?? at,
    createdByKind: stamp.by.kind,
    createdById: stamp.by.id,
    updatedAt: at,
    updatedByKind: stamp.by.kind,
    updatedById: stamp.by.id,
  };
}

/** The two columns a changed row gets from a stamp. */
export function updated(stamp: Stamp) {
  return {
    updatedAt: stamp.at ?? new Date(),
    updatedByKind: stamp.by.kind,
    updatedById: stamp.by.id,
  };
}

interface AuditColumns {
  createdAt: Date;
  createdByKind: PrincipalRef['kind'];
  createdById: string;
  updatedAt: Date;
  updatedByKind: PrincipalRef['kind'];
  updatedById: string;
}

function audit(row: AuditColumns) {
  return {
    createdAt: row.createdAt.toISOString(),
    createdBy: { kind: row.createdByKind, id: row.createdById },
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: { kind: row.updatedByKind, id: row.updatedById },
  };
}

const iso = (value: Date | null) => (value === null ? null : value.toISOString());

/** Rows as the objects of `@turnkeel/protocol`, which is how they leave the server. */
export function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    workspaceId: row.id,
    name: row.name,
    slug: row.slug,
    baseCurrency: row.baseCurrency,
    timeZone: row.timeZone,
    planning: {
      recurring: row.planning.recurring !== false,
      timeTracking: row.planning.timeTracking !== false,
      gantt: row.planning.gantt !== false,
      savedViews: row.planning.savedViews !== false,
    },
    tabsOff: inViewOrder(row.tabsOff),
    tabsKeptAt: iso(row.tabsKeptAt),
    demo: row.demo,
    deletedAt: iso(row.deletedAt),
    ...audit(row),
  };
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    key: row.key,
    slug: row.slug,
    kind: row.kind,
    launchDate: row.launchDate,
    launchMilestoneId: row.launchMilestoneId,
    locales: row.locales,
    repoUrl: row.repoUrl,
    shipsTo: row.shipsTo,
    changelogPublic: row.changelogPublic,
    archivedAt: iso(row.archivedAt),
    ...audit(row),
  };
}

export function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: row.role,
    handle: row.handle,
    ...audit(row),
  };
}

export function toProjectMember(row: ProjectMemberRow): ProjectMember {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
    ...audit(row),
  };
}

/** The invitation without the hash of its token, which never leaves this package. */
export function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role,
    projectId: row.projectId,
    invitedBy: row.invitedBy,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: iso(row.acceptedAt),
    revokedAt: iso(row.revokedAt),
    ...audit(row),
  };
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    kind: row.kind,
    ownerUserId: row.ownerUserId,
    disabledAt: iso(row.disabledAt),
    ...audit(row),
  };
}

/** The token without its hash, which never leaves this package. */
export function toAgentToken(row: AgentTokenRow): AgentToken {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes as AgentScope[],
    projectIds: row.projectIds,
    workspaceWide: row.workspaceWide,
    expiresAt: iso(row.expiresAt),
    revokedAt: iso(row.revokedAt),
    lastUsedAt: iso(row.lastUsedAt),
    spendCap:
      row.spendCap === null || row.spendCapCurrency === null
        ? null
        : { amount: row.spendCap, currency: row.spendCapCurrency },
    preset: row.preset === 'reporter' || row.preset === 'builder' ? row.preset : null,
    ...audit(row),
  };
}

/**
 * An inbox item as the API answers it. `line` is the cost line that came from it, when one
 * did: a suggested receipt, or a receipt once a person confirmed it.
 */
export function toInboxItem(
  row: InboxItemRow,
  cardKey: string | null,
  line: { id: string | null; suggested: boolean } | null = null,
): InboxItem {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    source: row.source,
    externalId: row.externalId,
    from: row.from,
    subject: row.subject,
    text: row.text,
    rating: row.rating,
    locale: row.locale,
    receivedAt: row.receivedAt.toISOString(),
    status: row.status,
    cardId: row.cardId,
    cardKey,
    receipt:
      line !== null
        ? { state: line.suggested ? 'suggested' : 'receipt', costLineId: line.id }
        : row.receiptDismissedAt !== null
          ? { state: 'dismissed', costLineId: null }
          : null,
    ...audit(row),
  };
}

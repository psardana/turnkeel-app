import { randomUUID } from 'node:crypto';
import { NO_SIGN_IN_SUFFIX, type Membership } from '@turnkeel/core';
import { isTransaction, type Executor, type Transaction } from './database.js';
import { ConflictError, NotInTransactionError, uniqueViolation } from './errors.js';
import {
  created,
  type AgentRow,
  type AgentTokenRow,
  type ConnectorInstallRow,
  type InvitationRow,
  type Stamp,
  type UserRow,
  type WorkspaceRow,
} from './rows.js';
import {
  agentSessions,
  connectorInstalls,
  listingRows,
  listings,
  assistantCalls,
  assistantInstallUsage,
  assetVariants,
  gateEvidence,
  agentTokens,
  agents,
  assetGroups,
  assets,
  builds,
  cards,
  decisions,
  features,
  files,
  gates,
  steps,
  eventCounters,
  invitations,
  members,
  parties,
  projectMembers,
  projects,
  user,
  workspaces,
  checklistItems,
  labels,
  epics,
  milestones,
  recurrenceRules,
  routines,
  routineRuns,
  savedViews,
  timeEntries,
  posts,
  releases,
  inboxItems,
  costLines,
  pricePlans,
  scenarios,
  docs,
  linkGroups,
  links,
} from './schema/index.js';

/**
 * The few queries that run before there is a workspace scope, because they are how a
 * scope is found: which workspace a slug names, what a person holds on the server,
 * which invitation a token belongs to, and the accounts themselves, which belong to
 * no workspace. Everything else goes through `repositories(executor, scope)`.
 */

export interface NewWorkspace {
  name: string;
  slug: string;
  baseCurrency: string;
  /** True only for the demo workspace that local mode seeds. */
  demo?: boolean;
  /** The planning switches it starts with; the column's default, `planningAtStart`, unless given. */
  planning?: PlanningSwitches;
  /** The tabs it starts with off (`tabsOffFor`); none unless given. */
  tabsOff?: SwitchableViewId[];
}

/**
 * Creates a workspace together with the counter row that numbers and orders its events.
 * Throws `ConflictError` when the slug is taken, by a live workspace or a deleted one.
 */
export async function createWorkspace(
  tx: Transaction,
  input: NewWorkspace,
  stamp: Stamp,
): Promise<WorkspaceRow> {
  if (!isTransaction(tx)) throw new NotInTransactionError('createWorkspace');
  const taken = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(sql`lower(${workspaces.slug}) = ${input.slug.toLowerCase()}`);
  if (taken.length > 0) throw slugTaken(input.slug, null);
  try {
    const rows = await tx
      .insert(workspaces)
      .values({
        id: randomUUID(),
        name: input.name,
        slug: input.slug,
        baseCurrency: input.baseCurrency,
        demo: input.demo ?? false,
        ...(input.planning === undefined ? {} : { planning: input.planning }),
        ...(input.tabsOff === undefined ? {} : { tabsOff: inViewOrder(input.tabsOff) }),
        ...created(stamp),
      })
      .returning();
    const workspace = rows[0]!;
    await tx.insert(eventCounters).values({ workspaceId: workspace.id, lastSeq: 0 });
    // The workspace's own `manual` install, for the Signals that have no project.
    await tx
      .insert(connectorInstalls)
      .values(manualInstallValues(workspace.id, null, stamp.at ?? new Date()));
    return workspace;
  } catch (error) {
    const constraint = uniqueViolation(error);
    if (constraint !== null) throw slugTaken(input.slug, constraint);
    throw error;
  }
}

function slugTaken(slug: string, constraint: string | null): ConflictError {
  return new ConflictError(
    'slug_taken',
    `Another workspace on this server has the slug "${slug}".`,
    constraint,
  );
}

/**
 * The workspace a slug names, without regard to case. A deleted workspace is not
 * found, because it answers every request like one that does not exist.
 */
export async function findWorkspaceBySlug(
  executor: Executor,
  slug: string,
  options: { includeDeleted?: boolean } = {},
): Promise<WorkspaceRow | null> {
  const rows = await executor
    .select()
    .from(workspaces)
    .where(
      and(
        sql`lower(${workspaces.slug}) = ${slug.toLowerCase()}`,
        options.includeDeleted ? undefined : isNull(workspaces.deletedAt),
      ),
    );
  return rows[0] ?? null;
}

/** How many workspaces the server has that are not deleted. Local mode seeds the demo when there is none at all. */
export async function countWorkspaces(
  executor: Executor,
  options: { includeDeleted?: boolean } = {},
): Promise<number> {
  const rows = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(workspaces)
    .where(options.includeDeleted ? undefined : isNull(workspaces.deletedAt));
  return rows[0]?.count ?? 0;
}

/**
 * What a person holds in every workspace that is not deleted: the input of the
 * permission check (`personPrincipal` in `@turnkeel/core`). A deleted workspace gives
 * nothing, which is how all access to it stops.
 */
export async function membershipsOf(executor: Executor, userId: string): Promise<Membership[]> {
  const workspaceRoles = await executor
    .select({ workspaceId: members.workspaceId, role: members.role })
    .from(members)
    .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(and(eq(members.userId, userId), isNull(workspaces.deletedAt)));
  const projectRoleRows = await executor
    .select({
      workspaceId: projectMembers.workspaceId,
      projectId: projectMembers.projectId,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(workspaces, eq(workspaces.id, projectMembers.workspaceId))
    .where(and(eq(projectMembers.userId, userId), isNull(workspaces.deletedAt)));

  const byWorkspace = new Map<
    string,
    { workspaceId: string; role: Membership['role']; projectRoles: Record<string, ProjectRole> }
  >();
  const entry = (workspaceId: string) => {
    let found = byWorkspace.get(workspaceId);
    if (!found) {
      found = { workspaceId, role: null, projectRoles: {} };
      byWorkspace.set(workspaceId, found);
    }
    return found;
  };
  for (const row of workspaceRoles) entry(row.workspaceId).role = row.role;
  for (const row of projectRoleRows) entry(row.workspaceId).projectRoles[row.projectId] = row.role;
  return [...byWorkspace.values()];
}

/** The workspaces a person can open: where they hold a workspace role or a project role. By name. */
export async function listWorkspacesFor(
  executor: Executor,
  userId: string,
): Promise<WorkspaceRow[]> {
  const rows = await executor
    .selectDistinct({ workspace: workspaces })
    .from(workspaces)
    .leftJoin(members, and(eq(members.workspaceId, workspaces.id), eq(members.userId, userId)))
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.workspaceId, workspaces.id), eq(projectMembers.userId, userId)),
    )
    .where(
      and(
        isNull(workspaces.deletedAt),
        or(sql`${members.id} is not null`, sql`${projectMembers.id} is not null`),
      ),
    );
  return rows
    .map((row) => row.workspace)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * The invitation a token's hash belongs to, with its workspace. Null when no
 * invitation has that hash or its workspace is deleted. Whether it can still be
 * accepted is for `canAcceptInvitation` in `@turnkeel/core` to say.
 */
export async function findInvitationByTokenHash(
  executor: Executor,
  tokenHash: string,
): Promise<{ invitation: InvitationRow; workspace: WorkspaceRow } | null> {
  const rows = await executor
    .select({ invitation: invitations, workspace: workspaces })
    .from(invitations)
    .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
    .where(and(eq(invitations.tokenHash, tokenHash), isNull(workspaces.deletedAt)));
  return rows[0] ?? null;
}

/**
 * The agent token a hash belongs to, with its agent and its workspace: how a bearer
 * request finds its principal. Null when no token has that hash or its workspace is
 * deleted. Whether the token still works is for `tokenUsable` in `@turnkeel/core` to
 * say.
 */
export async function findAgentTokenByHash(
  executor: Executor,
  hash: string,
): Promise<{ token: AgentTokenRow; agent: AgentRow; workspace: WorkspaceRow } | null> {
  const rows = await executor
    .select({ token: agentTokens, agent: agents, workspace: workspaces })
    .from(agentTokens)
    .innerJoin(agents, eq(agents.id, agentTokens.agentId))
    .innerJoin(workspaces, eq(workspaces.id, agentTokens.workspaceId))
    .where(and(eq(agentTokens.hash, hash), isNull(workspaces.deletedAt)));
  return rows[0] ?? null;
}

/**
 * True when an invitation to this address can still be accepted somewhere on the
 * server. A sign-in for an address without an account is let through only then.
 */
export async function hasOpenInvitation(
  executor: Executor,
  email: string,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await executor
    .select({ id: invitations.id })
    .from(invitations)
    .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
    .where(
      and(
        sql`lower(${invitations.email}) = ${email.trim().toLowerCase()}`,
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, now),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** How many accounts the server has. The first sign-in on an install with none becomes Owner. */
export async function countUsers(executor: Executor): Promise<number> {
  const rows = await executor.select({ count: sql<number>`count(*)::int` }).from(user);
  return rows[0]?.count ?? 0;
}

/**
 * How many accounts someone can sign in to. This is the count of R44. It leaves out
 * the accounts the server makes for itself, whose address is under `.invalid`: the
 * local owner, and the people the demo seeds (`canSignInWith` in `core`).
 */
export async function countSignInAccounts(executor: Executor): Promise<number> {
  const rows = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(user)
    .where(sql`lower(${user.email}) not like ${`%${NO_SIGN_IN_SUFFIX}`}`);
  return rows[0]?.count ?? 0;
}

export async function findUserById(executor: Executor, id: string): Promise<UserRow | null> {
  const rows = await executor.select().from(user).where(eq(user.id, id));
  return rows[0] ?? null;
}

/** The account with this email address, without regard to case. */
export async function findUserByEmail(executor: Executor, email: string): Promise<UserRow | null> {
  const rows = await executor
    .select()
    .from(user)
    .where(sql`lower(${user.email}) = ${email.trim().toLowerCase()}`)
    .orderBy(asc(user.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Makes an account row with no way to sign in. Accounts that people sign in to are
 * made by Better Auth. This is for the local owner of local mode and for the people
 * the demo seeds.
 */
export async function createUser(
  executor: Executor,
  input: { name: string; email: string; emailVerified?: boolean; at?: Date },
): Promise<UserRow> {
  const now = input.at ?? new Date();
  const rows = await executor
    .insert(user)
    .values({
      id: randomUUID(),
      name: input.name,
      email: input.email.trim().toLowerCase(),
      emailVerified: input.emailVerified ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return rows[0]!;
}

/**
 * The workspaces that are not deleted and have a recurrence rule that is neither paused
 * nor removed: what the recurrence job looks at.
 */
export async function workspacesWithLiveRules(executor: Executor): Promise<string[]> {
  const rows = await executor
    .selectDistinct({ workspaceId: recurrenceRules.workspaceId })
    .from(recurrenceRules)
    .innerJoin(workspaces, eq(workspaces.id, recurrenceRules.workspaceId))
    .where(
      and(
        isNull(workspaces.deletedAt),
        isNull(recurrenceRules.removedAt),
        isNull(recurrenceRules.pausedAt),
      ),
    );
  return rows.map((row) => row.workspaceId);
}

import {
  agentScopes,
  type AssistantFeature,
  type AssistantOutcome,
  type AssistantProvider,
  type AssistantSource,
  type AssistantSubjectType,
  type AgentKind,
  type AssetDecisionStatus,
  type AssetKind,
  type BuildPlatform,
  type DecisionStatus,
  type FilePurpose,
  type GateCheck,
  type GateFileChangeState,
  type GatePassValue,
  type GateState,
  type HeldChange,
  type ListingStore,
  type NeedsKind,
  type PostStatus,
  type SessionState,
  type AuthorMarker,
  type CardColumn,
  type CardPriority,
  type DraftMark,
  type EventVia,
  type PrincipalKind,
  type ProjectKind,
  type ProjectTarget,
  type PlanningSwitches,
  type ProjectRole,
  type RefKind,
  type LabelColour,
  type EpicState,
  type BoardView,
  type RecurrenceUnit,
  type RoutineRunCause,
  type RoutineRunItem,
  type RoutineRunState,
  type RoutineTrigger,
  type ViewQuery,
  type ChangeCi,
  type ChangeState,
  type InboxSource,
  type InboxStatus,
  type ReleaseItemKind,
  type MoneyBasis,
  type MoneyPeriod,
  type ReleaseStatus,
  type ReleaseStore,
  type Role,
  type StartView,
  type SwitchableViewId,
  type ViewId,
  type WorkspaceRole,
} from '@turnkeel/protocol';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';

/** A time, stored with its zone, which is always UTC. */
const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * `createdAt`, `createdBy`, `updatedAt` and `updatedBy`, which every object carries.
 * `createdBy` and `updatedBy` name a principal: a kind and an id.
 */
const audit = () => ({
  createdAt: at('created_at').notNull(),
  createdByKind: text('created_by_kind').$type<PrincipalKind>().notNull(),
  createdById: uuid('created_by_id').notNull(),
  updatedAt: at('updated_at').notNull(),
  updatedByKind: text('updated_by_kind').$type<PrincipalKind>().notNull(),
  updatedById: uuid('updated_by_id').notNull(),
});

const principalKindList = sql.raw(`'user', 'agent', 'system'`);

/**
 * The scope names, as the database checks them. A new scope in the protocol
 * changes this list, and with it the schema, so it needs a migration of its own.
 */
const agentScopeList = sql.raw(agentScopes.map((scope) => `'${scope}'`).join(', '));

/** A workspace: a company. Deleting one sets `deleted_at` and removes nothing. */
export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    baseCurrency: text('base_currency').notNull(),
    /** An IANA time zone: overdue and recurrence rules go by its days. */
    timeZone: text('time_zone').notNull().default('UTC'),
    /**
     * The four planning switches. A new workspace starts with the
     * Gantt on and the rest off (`planningAtStart`, migration 0029).
     */
    planning: jsonb('planning')
      .$type<PlanningSwitches>()
      .notNull()
      .default(
        sql`'{"recurring": false, "timeTracking": false, "gantt": true, "savedViews": false}'::jsonb`,
      ),
    /** The tabs turned off for everyone, in tab order. */
    tabsOff: jsonb('tabs_off')
      .$type<SwitchableViewId[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** When an Owner or Admin last pressed Keep these tabs. */
    tabsKeptAt: at('tabs_kept_at'),
    demo: boolean('demo').notNull().default(false),
    deletedAt: at('deleted_at'),
    ...audit(),
  },
  (table) => [
    // Unique on the server without regard to case. A deleted workspace keeps its slug,
    // so the slug is not given out again.
    uniqueIndex('workspaces_slug_lower_key').on(sql`lower(${table.slug})`),
    check(
      'workspaces_created_by_kind_check',
      sql`${table.createdByKind} in (${principalKindList})`,
    ),
    check(
      'workspaces_updated_by_kind_check',
      sql`${table.updatedByKind} in (${principalKindList})`,
    ),
    check('workspaces_tabs_off_check', sql`jsonb_typeof(${table.tabsOff}) = 'array'`),
  ],
);

/**
 * The counter of event `seq` for one workspace. Its row is also the workspace's
 * event lock: a transaction that appends an event updates the row, which holds it
 * until the transaction ends, so `seq` order is commit order.
 */
export const eventCounters = pgTable('event_counters', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id),
  lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
});

/** A project: a product in the workspace. A project is archived, never deleted. */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    key: text('key').notNull(),
    slug: text('slug').notNull(),
    kind: text('kind').$type<ProjectKind>().notNull(),
    launchDate: date('launch_date', { mode: 'string' }),
    /** The milestone the launch date follows, one of the project's. */
    launchMilestoneId: uuid('launch_milestone_id'),
    locales: text('locales')
      .array()
      .notNull()
      .default(sql`ARRAY['en']::text[]`),
    repoUrl: text('repo_url'),
    /** Where the product ships: App Store, Google Play, the web; empty when nobody said. */
    shipsTo: text('ships_to')
      .array()
      .$type<ProjectTarget[]>()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    changelogPublic: boolean('changelog_public').notNull().default(false),
    archivedAt: at('archived_at'),
    ...audit(),
  },
  // Typed, so that the keys between tables that name each other do not make a cycle of
  // inferred types.
  (table): PgTableExtraConfigValue[] => [
    // Unique in the workspace without regard to case. That a slug does not equal
    // another project's key is checked by the repository, under the workspace's lock.
    uniqueIndex('projects_workspace_key_lower_key').on(table.workspaceId, sql`lower(${table.key})`),
    uniqueIndex('projects_workspace_slug_lower_key').on(
      table.workspaceId,
      sql`lower(${table.slug})`,
    ),
    check(
      'projects_kind_check',
      sql`${table.kind} in ('app', 'web', 'extension', 'library', 'other')`,
    ),
    check(
      'projects_ships_to_check',
      sql`${table.shipsTo} <@ ARRAY['appstore', 'play', 'web']::text[]`,
    ),
    // What a card's project is checked against: a project together with its workspace.
    uniqueIndex('projects_workspace_id_id_key').on(table.workspaceId, table.id),
    // R75: the launch milestone is one of the project's own (0016).
    foreignKey({
      name: 'projects_launch_milestone_fk',
      columns: [table.workspaceId, table.id, table.launchMilestoneId],
      foreignColumns: [milestones.workspaceId, milestones.projectId, milestones.id],
    }),
  ],
);

/** A person's role in a workspace, with their handle there. */
export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    role: text('role').$type<WorkspaceRole>().notNull(),
    handle: text('handle').notNull(),
    ...audit(),
  },
  (table) => [
    uniqueIndex('members_workspace_user_key').on(table.workspaceId, table.userId),
    uniqueIndex('members_workspace_handle_lower_key').on(
      table.workspaceId,
      sql`lower(${table.handle})`,
    ),
    index('members_user_idx').on(table.userId),
    // Tester is never a workspace role.
    check(
      'members_role_check',
      sql`${table.role} in ('owner', 'admin', 'member', 'reviewer', 'viewer')`,
    ),
  ],
);

/** A person's role in one project. It replaces the workspace role there. */
export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    role: text('role').$type<ProjectRole>().notNull(),
    ...audit(),
  },
  (table) => [
    uniqueIndex('project_members_project_user_key').on(table.projectId, table.userId),
    index('project_members_workspace_user_idx').on(table.workspaceId, table.userId),
    index('project_members_user_idx').on(table.userId),
    // A project role is one of Member, Reviewer, Tester or Viewer.
    check(
      'project_members_role_check',
      sql`${table.role} in ('member', 'reviewer', 'tester', 'viewer')`,
    ),
  ],
);

/**
 * An invitation to an email address. Only the hash of its token is stored, and the
 * hash never leaves this package.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    email: text('email').notNull(),
    role: text('role').$type<Role>().notNull(),
    projectId: uuid('project_id').references(() => projects.id),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => user.id),
    expiresAt: at('expires_at').notNull(),
    acceptedAt: at('accepted_at'),
    revokedAt: at('revoked_at'),
    ...audit(),
  },
  (table) => [
    uniqueIndex('invitations_token_hash_key').on(table.tokenHash),
    index('invitations_workspace_email_lower_idx').on(
      table.workspaceId,
      sql`lower(${table.email})`,
    ),
    index('invitations_email_lower_idx').on(sql`lower(${table.email})`),
    // One open invitation per address, for the workspace or for one project. A second
    // one replaces the first, so the first is revoked before it is made.
    uniqueIndex('invitations_open_key')
      .on(
        table.workspaceId,
        sql`coalesce(${table.projectId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`lower(${table.email})`,
      )
      .where(sql`${table.acceptedAt} is null and ${table.revokedAt} is null`),
    check(
      'invitations_role_check',
      sql`${table.role} in ('owner', 'admin', 'member', 'reviewer', 'tester', 'viewer')`,
    ),
    // A Tester invitation names a project, and a project invitation gives a project role.
    check(
      'invitations_role_project_check',
      sql`(${table.projectId} is null and ${table.role} <> 'tester') or (${table.projectId} is not null and ${table.role} not in ('owner', 'admin'))`,
    ),
  ],
);

/**
 * An agent: a non-human principal with a name and one or more tokens. Its
 * owner is the person its sessions wait on. A disabled agent's tokens stop working.
 */
export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    kind: text('kind').$type<AgentKind>().notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => user.id),
    disabledAt: at('disabled_at'),
    ...audit(),
  },
  (table) => [
    // Unique in the workspace without regard to case.
    uniqueIndex('agents_workspace_name_lower_key').on(table.workspaceId, sql`lower(${table.name})`),
    // What a token's agent is checked against: an agent together with its workspace.
    uniqueIndex('agents_workspace_id_id_key').on(table.workspaceId, table.id),
    check(
      'agents_kind_check',
      sql`${table.kind} in ('claude-code', 'codex', 'cursor', 'script', 'other')`,
    ),
  ],
);

/**
 * An agent token. Only the SHA-256 of the token is stored; the token is
 * shown once, when it is made. The hash never leaves this package.
 */
export const agentTokens = pgTable(
  'agent_tokens',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    hash: text('hash').notNull(),
    scopes: text('scopes').array().notNull(),
    projectIds: uuid('project_ids').array().notNull(),
    workspaceWide: boolean('workspace_wide').notNull().default(false),
    expiresAt: at('expires_at'),
    revokedAt: at('revoked_at'),
    lastUsedAt: at('last_used_at'),
    /**
     * The monthly cap of `spend:commit`, in `spend_cap_currency`, the workspace's currency
     * when it was set. Kept when the scope is turned off.
     */
    spendCap: doublePrecision('spend_cap'),
    spendCapCurrency: text('spend_cap_currency'),
    /**
     * The preset the token was made or last changed with, whose scopes it follows:
     * `reporter`, `builder`, or null for a list of its own.
     */
    preset: text('preset'),
    ...audit(),
  },
  (table) => [
    uniqueIndex('agent_tokens_hash_key').on(table.hash),
    check(
      'agent_tokens_preset_check',
      sql`${table.preset} is null or ${table.preset} in ('reporter', 'builder')`,
    ),
    // A cap is an amount above zero with its currency, and spend:commit needs one.
    check(
      'agent_tokens_spend_cap_check',
      sql`(${table.spendCap} is null) = (${table.spendCapCurrency} is null) and (${table.spendCap} is null or (${table.spendCap} > 0 and ${table.spendCapCurrency} ~ '^[A-Z]{3}$'))`,
    ),
    check(
      'agent_tokens_spend_commit_cap_check',
      sql`not ('spend:commit' = any(${table.scopes})) or ${table.spendCap} is not null`,
    ),
    index('agent_tokens_agent_idx').on(table.agentId),
    // A token names at least one project and at least one scope.
    check('agent_tokens_project_ids_check', sql`cardinality(${table.projectIds}) > 0`),
    check('agent_tokens_scopes_check', sql`cardinality(${table.scopes}) > 0`),
    // R13: a token holds only scopes of the scope list, whatever the code above asks.
    check(
      'agent_tokens_scopes_known_check',
      sql`${table.scopes} <@ array[${agentScopeList}]::text[]`,
    ),
    // A token's agent is in the token's workspace: the database refuses any other.
    foreignKey({
      name: 'agent_tokens_workspace_agent_fk',
      columns: [table.workspaceId, table.agentId],
      foreignColumns: [agents.workspaceId, agents.id],
    }),
  ],
);

/**
 * The event log. Append-only: a trigger rejects UPDATE, DELETE and
 * TRUNCATE (the hand-written migration `events_append_only`).
 */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    projectId: uuid('project_id').references(() => projects.id),
    at: at('at').notNull(),
    actorKind: text('actor_kind').$type<PrincipalKind>().notNull(),
    actorId: uuid('actor_id').notNull(),
    actorName: text('actor_name').notNull(),
    via: text('via').$type<EventVia>().notNull(),
    tokenId: uuid('token_id'),
    sessionId: uuid('session_id'),
    requestId: uuid('request_id').notNull(),
    type: text('type').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    subjectOwnerKind: text('subject_owner_kind'),
    subjectOwnerId: uuid('subject_owner_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    uniqueIndex('events_workspace_seq_key').on(table.workspaceId, table.seq),
    index('events_workspace_subject_idx').on(
      table.workspaceId,
      table.subjectType,
      table.subjectId,
      table.seq,
    ),
    index('events_workspace_project_idx').on(table.workspaceId, table.projectId, table.seq),
    index('events_workspace_actor_idx').on(table.workspaceId, table.actorId, table.seq),
    // Get started counts `import.item` and finds a change of currency by type.
    index('events_workspace_type_idx').on(table.workspaceId, table.type),
    check('events_seq_check', sql`${table.seq} > 0`),
    check('events_actor_kind_check', sql`${table.actorKind} in (${principalKindList})`),
    check(
      'events_via_check',
      sql`${table.via} in ('web', 'rest', 'mcp', 'cli', 'hook', 'connector', 'job')`,
    ),
  ],
);

/**
 * The first result of a write that carried an idempotency key, kept for 24 hours.
 * `principal_id` is the user or the agent; `token_id` says which
 * token an agent used, and is part of the key: two tokens of one agent never share a
 * kept answer. A person's records have no token, and the key treats that null as one
 * value (`nulls not distinct`).
 */
export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    principalKind: text('principal_kind').$type<PrincipalKind>().notNull(),
    principalId: uuid('principal_id').notNull(),
    tokenId: uuid('token_id'),
    key: text('key').notNull(),
    scope: text('scope').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response').$type<unknown>().notNull(),
    expiresAt: at('expires_at').notNull(),
    createdAt: at('created_at').notNull(),
  },
  (table) => [
    unique('idempotency_records_principal_token_scope_key_key')
      .on(table.principalKind, table.principalId, table.tokenId, table.scope, table.key)
      .nullsNotDistinct(),
    index('idempotency_records_expires_at_idx').on(table.expiresAt),
    check(
      'idempotency_records_principal_kind_check',
      sql`${table.principalKind} in (${principalKindList})`,
    ),
  ],
);

/** A run of a routine: made by the job, started and finished by its agent. */
export const routineRuns = pgTable(
  'routine_runs',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectId: uuid('project_id').notNull(),
    routineId: uuid('routine_id').notNull(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    /** `slot:<day>` or `event:<event id>`: one run a slot or an event. */
    triggerKey: text('trigger_key').notNull(),
    /**
     * The task as it was when the run was made, and who had set it then: what the run's agent
     * is given, whatever the routine's task or agent became since.
     */
    task: text('task').notNull(),
    taskById: uuid('task_by_id')
      .notNull()
      .references(() => user.id),
    taskAt: at('task_at').notNull(),
    cause: jsonb('cause').$type<RoutineRunCause>().notNull(),
    state: text('state').$type<RoutineRunState>().notNull(),
    startedAt: at('started_at'),
    endedAt: at('ended_at'),
    result: text('result'),
    items: jsonb('items')
      .$type<RoutineRunItem[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    seenAt: at('seen_at'),
    seenById: uuid('seen_by_id').references(() => user.id),
    ...audit(),
  },
  (table) => [
    uniqueIndex('routine_runs_trigger_key').on(table.routineId, table.triggerKey),
    foreignKey({
      name: 'routine_runs_workspace_project_routine_fk',
      columns: [table.workspaceId, table.projectId, table.routineId],
      foreignColumns: [routines.workspaceId, routines.projectId, routines.id],
    }),
    index('routine_runs_routine_idx').on(table.routineId, table.createdAt),
    index('routine_runs_open_idx')
      .on(table.workspaceId, table.agentId)
      .where(sql`${table.state} in ('waiting', 'running')`),
    index('routine_runs_unseen_idx')
      .on(table.workspaceId, table.projectId)
      .where(sql`${table.seenAt} is null and ${table.state} in ('done', 'failed', 'missed')`),
    check(
      'routine_runs_state_check',
      sql`${table.state} in ('waiting', 'running', 'done', 'failed', 'missed', 'cancelled')`,
    ),
    check(
      'routine_runs_result_check',
      sql`${table.result} is null or char_length(${table.result}) between 1 and 2000`,
    ),
    check('routine_runs_items_check', sql`jsonb_typeof(${table.items}) = 'array'`),
    check('routine_runs_task_check', sql`char_length(${table.task}) between 1 and 4000`),
    check(
      'routine_runs_started_check',
      sql`(${table.state} = 'waiting') = (${table.startedAt} is null) or ${table.state} in ('missed', 'cancelled')`,
    ),
    check(
      'routine_runs_ended_check',
      sql`(${table.state} in ('waiting', 'running')) = (${table.endedAt} is null)`,
    ),
    // Only the agent of the run gives it a result, and only once it is done or failed.
    check(
      'routine_runs_result_state_check',
      sql`${table.result} is null or ${table.state} in ('done', 'failed')`,
    ),
    check(
      'routine_runs_seen_check',
      sql`(${table.seenAt} is null) = (${table.seenById} is null) and (${table.seenAt} is null or ${table.state} in ('done', 'failed', 'missed'))`,
    ),
  ],
);

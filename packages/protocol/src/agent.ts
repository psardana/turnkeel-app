import { z } from 'zod';
import { commonFields } from './common.js';
import { idSchema, timestampSchema } from './ids.js';

/** What kind of program an agent is. A session's `tool` is its agent's kind (3.8). */
export const agentKinds = ['claude-code', 'codex', 'cursor', 'script', 'other'] as const;

export type AgentKind = (typeof agentKinds)[number];

/**
 * The scopes a token can hold. Each names actions of the role table; which ones is
 * the scope table in `@turnkeel/core`. A token with a name that is not here cannot be
 * made.
 */
export const agentScopes = [
  'cards:read',
  'cards:write',
  'planning:write',
  // Epics: an agent makes and changes epics directly.
  'epics:write',
  'testing:read',
  'testing:post',
  'testing:reply',
  'assets:read',
  'assets:propose',
  'posts:read',
  'posts:write',
  'gates:read',
  'gates:check',
  'gates:sync',
  'decisions:read',
  'decisions:propose',
  'decisions:decide',
  'releases:read',
  'releases:write',
  'inbox:read',
  'inbox:write',
  'signals:write',
  'money:read',
  'docs:read',
  'docs:sync',
  'links:write',
  'sessions:write',
  // Routines: a token sees and reports the runs of its own agent.
  'routines:run',
  // The second set of opt-in scopes.
  'cards:archive',
  'inbox:triage',
  'testing:mark',
  'money:write',
  'assets:decide',
  'posts:approve',
  'gates:pass',
  'releases:publish',
  'posts:send',
  'spend:commit',
] as const;

export type AgentScope = (typeof agentScopes)[number];

export const agentScopeSchema = z.enum(agentScopes);

/**
 * The scopes a token gets only when an Owner picks each one by name. No bundle of scopes
 * holds them: not the demo's token, not a
 * test's "every scope", not a default. Each lets an agent do one thing that is otherwise
 * a person's, on the word of a named person who may do it themselves.
 */
export const optInScopes = [
  'decisions:decide',
  'cards:archive',
  'inbox:triage',
  'testing:mark',
  'money:write',
  'assets:decide',
  'posts:approve',
  'gates:pass',
  'releases:publish',
  'posts:send',
  'spend:commit',
] as const satisfies readonly AgentScope[];

/**
 * What a file may be attached to. An agent token uploads a file only for a
 * purpose that goes with one of its scopes.
 */
export const filePurposes = [
  'step_run',
  'asset_variant',
  'gate_evidence',
  'doc_image',
  'listing_file',
  'post_media',
  'receipt',
] as const;

export type FilePurpose = (typeof filePurposes)[number];

/**
 * The kinds of Signal. An agent writes only some of them; the others
 * come from connectors. `clicks` and `signups` name a post. The last six
 * are a social network's figures, which only connectors bring in, and
 * `quota` the share of a plan's limit used. `views`, `likes`, `comments` and
 * `shares` are a post's counts on its network that an agent measured, and an agent may
 * report `followers` of a channel too.
 */
export const signalKinds = [
  'cost',
  'revenue',
  'usage',
  'subscribers',
  'store_state',
  'ci',
  'review',
  'clicks',
  'signups',
  'followers',
  'impressions',
  'reach',
  'video_views',
  'profile_views',
  'engagements',
  'quota',
  'views',
  'likes',
  'comments',
  'shares',
] as const;

export type SignalKind = (typeof signalKinds)[number];

/** The statuses of a decision. */
export const decisionStatuses = ['proposed', 'accepted', 'rejected', 'parked', 'done'] as const;

export type DecisionStatus = (typeof decisionStatuses)[number];

const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u, 'Use one line without control characters.');

/**
 * An agent's name: how tools and gate files name it, as `agent:<name>`. Lower-case
 * letters, digits and single hyphens, 2 to 40 characters, unique in the workspace
 * without regard to case.
 */
export const agentNameSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, digits and single hyphens.');

/**
 * An agent's name as a read gives it. Every agent a request makes or renames has a name
 * of `agentNameSchema`; the one agent the importer makes is named "Claude (imported)",
 * which no request can name as
 * `agent:<name>`. A read takes the name as stored, one line of at most 40 characters.
 */
export const agentNameReadSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[^\p{Cc}]*$/u);

/** The longest name a token can have. A token's name says where it is used. */
export const TOKEN_NAME_MAX = 80;

/**
 * An agent: a non-human principal with a name and one or more tokens. Its
 * owner is the person its sessions wait on. A disabled agent's tokens stop working.
 */
export const agentSchema = z.strictObject({
  ...commonFields,
  name: agentNameReadSchema,
  kind: z.enum(agentKinds),
  ownerUserId: idSchema,
  disabledAt: timestampSchema.nullable(),
});

export type Agent = z.infer<typeof agentSchema>;

/**
 * An agent token, as a response shows it. The token itself is shown once,
 * when it is made, and its hash never leaves the server. `prefix` is the start of the
 * token, so a person can tell tokens apart.
 */
export const agentTokenSchema = z.strictObject({
  ...commonFields,
  agentId: idSchema,
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(agentScopeSchema),
  projectIds: z.array(idSchema).min(1),
  workspaceWide: z.boolean(),
  expiresAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  lastUsedAt: timestampSchema.nullable(),
  /**
   * The monthly cap of `spend:commit`, in the workspace's currency. Set
   * while the token holds that scope, and kept when the scope is turned off.
   */
  spendCap: spendCapSchema.nullable(),
  /**
   * The preset the token was made or last changed with, whose scopes it follows, or null
   * for a list of its own, Operator's included.
   */
  preset: standardPresetSchema.nullable(),
});

export type AgentToken = z.infer<typeof agentTokenSchema>;

/** One agent in `GET /workspaces/:ws/agents`, with its tokens, newest first. */
export const agentWithTokensSchema = z.strictObject({
  agent: agentSchema,
  tokens: z.array(agentTokenSchema),
});

export type AgentWithTokens = z.infer<typeof agentWithTokensSchema>;

/** `POST /workspaces/:ws/agents`, under `agent.manage`. The owner is the caller unless named. */
export const createAgentRequestSchema = z.strictObject({
  name: agentNameSchema,
  kind: z.enum(agentKinds),
  ownerUserId: idSchema.optional(),
});

export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

/**
 * `PATCH /agents/:id`, under `agent.manage`: the name, the owner, or `disabled: true`.
 * Disabling cannot be undone; a new agent takes its place.
 */
export const updateAgentRequestSchema = z
  .strictObject({
    name: agentNameSchema,
    ownerUserId: idSchema,
    disabled: z.literal(true),
  })
  .partial();

export type UpdateAgentRequest = z.infer<typeof updateAgentRequestSchema>;

/**
 * `POST /agents/:id/tokens`, under `agent.manage`. A token names at least one scope and
 * at least one project of the workspace. `workspaceWide` lets it reach objects
 * that have no project. `preset` (Reporter or Builder) gives the token that preset's
 * scopes and makes it follow the preset; `scopes` may then be left out, and when
 * sent its standard scopes are the preset's exactly, beside any opt-in scopes. Without
 * `preset`, `scopes` is the token's own list.
 */
export const createTokenRequestSchema = z
  .strictObject({
    name: oneLine(TOKEN_NAME_MAX),
    scopes: z
      .array(agentScopeSchema)
      .min(1)
      .refine((scopes) => new Set(scopes).size === scopes.length, 'Name each scope once.')
      .optional(),
    preset: standardPresetSchema.optional(),
    projectIds: z
      .array(idSchema)
      .min(1)
      .max(200)
      .refine(
        (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
        'Name each project once.',
      ),
    workspaceWide: z.boolean().optional(),
    expiresAt: timestampSchema.nullable().optional(),
    /** Needed with `spend:commit`, and only with it. */
    spendCap: spendCapSchema.optional(),
  })
  .refine((body) => body.scopes !== undefined || body.preset !== undefined, {
    message: 'Send scopes, a preset or both.',
    path: ['scopes'],
  });

export type CreateTokenRequest = z.infer<typeof createTokenRequestSchema>;

/**
 * `PATCH /tokens/:id`, under `agent.manage` by an Owner:
 * `scopes` is the standard scopes the token holds from now on, all of them and at least
 * one, and the token then follows no preset. `preset` gives it the standard scopes of
 * Reporter or Builder and makes it follow that preset; with `scopes` too, they are
 * the preset's exactly. `optInScopes` is the opt-in scopes the token holds from now on, all
 * of them; an empty list takes them all away. `spendCap` sets the monthly cap of
 * `spend:commit`, which the token needs before that scope is turned on. Any of them, at
 * least one. The token's projects and its value stay as they were made.
 */
export const updateTokenRequestSchema = z
  .strictObject({
    scopes: z
      .array(z.enum(standardScopeNames))
      .min(1)
      .max(standardScopeNames.length)
      .refine((scopes) => new Set(scopes).size === scopes.length, 'Name each scope once.')
      .optional(),
    optInScopes: z
      .array(z.enum(optInScopes))
      .max(optInScopes.length)
      .refine((scopes) => new Set(scopes).size === scopes.length, 'Name each scope once.')
      .optional(),
    spendCap: spendCapSchema.optional(),
    preset: standardPresetSchema.optional(),
  })
  .refine(
    (body) =>
      body.scopes !== undefined ||
      body.preset !== undefined ||
      body.optInScopes !== undefined ||
      body.spendCap !== undefined,
    'Send scopes, preset, optInScopes, spendCap or more than one.',
  );

/**
 * The answer to `POST /agents/:id/tokens`. `value` is the token itself. It is in this
 * answer and nowhere else: the server keeps only its hash, and no read returns it again.
 */
export const createTokenResponseSchema = z.strictObject({
  token: agentTokenSchema,
  value: z.string(),
});

export type CreateTokenResponse = z.infer<typeof createTokenResponseSchema>;

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Executor } from '../database.js';
import { ConflictError, uniqueViolation } from '../errors.js';
import { created, updated, type AgentRow, type AgentTokenRow, type Stamp } from '../rows.js';
import { agentTokens, agents } from '../schema/index.js';
import type { WorkspaceScope } from '../scope.js';

function nameTaken(name: string, constraint: string): ConflictError {
  return new ConflictError(
    'name_taken',
    `This workspace already has an agent named "${name}".`,
    constraint,
  );
}

export interface AgentPatch {
  name?: string | undefined;
  ownerUserId?: string | undefined;
}

export function agentsRepository(executor: Executor, scope: WorkspaceScope) {
  const inWorkspace = eq(agents.workspaceId, scope.workspaceId);

  async function guarded<T>(name: string | undefined, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      const constraint = uniqueViolation(error);
      if (constraint !== null) throw nameTaken(name ?? '', constraint);
      throw error;
    }
  }

  return {
    /** The agents of the workspace, by name. */
    async list(): Promise<AgentRow[]> {
      return executor
        .select()
        .from(agents)
        .where(inWorkspace)
        .orderBy(asc(sql`lower(${agents.name})`));
    },

    async get(id: string): Promise<AgentRow | null> {
      const rows = await executor
        .select()
        .from(agents)
        .where(and(inWorkspace, eq(agents.id, id)));
      return rows[0] ?? null;
    },

    /** The agents of the workspace that a person owns, disabled ones included. */
    async listOwnedBy(userId: string): Promise<AgentRow[]> {
      return executor
        .select()
        .from(agents)
        .where(and(inWorkspace, eq(agents.ownerUserId, userId.toLowerCase())))
        .orderBy(asc(sql`lower(${agents.name})`));
    },

    /** Makes an agent. Throws `ConflictError` when another agent of the workspace has the name. */
    async create(
      input: { name: string; kind: AgentKind; ownerUserId: string },
      stamp: Stamp,
    ): Promise<AgentRow> {
      return guarded(input.name, async () => {
        const rows = await executor
          .insert(agents)
          .values({
            id: randomUUID(),
            workspaceId: scope.workspaceId,
            name: input.name,
            kind: input.kind,
            ownerUserId: input.ownerUserId,
            ...created(stamp),
          })
          .returning();
        return rows[0]!;
      });
    },

    /** Changes the name or the owner. Throws `ConflictError` when the name is taken. */
    async update(id: string, patch: AgentPatch, stamp: Stamp): Promise<AgentRow | null> {
      const values = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      );
      return guarded(patch.name, async () => {
        const rows = await executor
          .update(agents)
          .set({ ...values, ...updated(stamp) })
          .where(and(inWorkspace, eq(agents.id, id)))
          .returning();
        return rows[0] ?? null;
      });
    },

    /** Disables an agent, which stops every token of it. Null when it was disabled already. */
    async disable(id: string, stamp: Stamp): Promise<AgentRow | null> {
      const rows = await executor
        .update(agents)
        .set({ disabledAt: stamp.at ?? new Date(), ...updated(stamp) })
        .where(and(inWorkspace, eq(agents.id, id), isNull(agents.disabledAt)))
        .returning();
      return rows[0] ?? null;
    },
  };
}

export interface NewAgentToken {
  agentId: string;
  name: string;
  /** The start of the token, which a person can see. */
  prefix: string;
  /** The SHA-256 of the token. The token itself is in the answer that made it and nowhere else. */
  hash: string;
  scopes: readonly AgentScope[];
  projectIds: readonly string[];
  workspaceWide: boolean;
  expiresAt: Date | null;
  /** The monthly cap of spend:commit, with the workspace's currency. */
  spendCap?: { amount: number; currency: string } | null;
  /** The preset the token follows, or null for a list of its own. */
  preset?: StandardPreset | null;
}

/** How long a token's last use may be behind before it is written again. */
const LAST_USE_STEP_MS = 60_000;

export function agentTokensRepository(executor: Executor, scope: WorkspaceScope) {
  const inWorkspace = eq(agentTokens.workspaceId, scope.workspaceId);

  return {
    /** The tokens of the workspace, or of one agent, newest first. */
    async list(agentId?: string): Promise<AgentTokenRow[]> {
      return executor
        .select()
        .from(agentTokens)
        .where(
          and(inWorkspace, agentId === undefined ? undefined : eq(agentTokens.agentId, agentId)),
        )
        .orderBy(desc(agentTokens.createdAt), desc(agentTokens.id));
    },

    async get(id: string): Promise<AgentTokenRow | null> {
      const rows = await executor
        .select()
        .from(agentTokens)
        .where(and(inWorkspace, eq(agentTokens.id, id)));
      return rows[0] ?? null;
    },

    /** The tokens of the workspace that a person created and that are not revoked yet, oldest first. */
    async listActiveCreatedBy(userId: string): Promise<AgentTokenRow[]> {
      return executor
        .select()
        .from(agentTokens)
        .where(
          and(
            inWorkspace,
            eq(agentTokens.createdByKind, 'user'),
            eq(agentTokens.createdById, userId.toLowerCase()),
            isNull(agentTokens.revokedAt),
          ),
        )
        .orderBy(asc(agentTokens.createdAt), asc(agentTokens.id));
    },

    async create(input: NewAgentToken, stamp: Stamp): Promise<AgentTokenRow> {
      const rows = await executor
        .insert(agentTokens)
        .values({
          id: randomUUID(),
          workspaceId: scope.workspaceId,
          agentId: input.agentId,
          name: input.name,
          prefix: input.prefix,
          hash: input.hash,
          scopes: [...input.scopes],
          projectIds: input.projectIds.map((id) => id.toLowerCase()),
          workspaceWide: input.workspaceWide,
          expiresAt: input.expiresAt,
          spendCap: input.spendCap?.amount ?? null,
          spendCapCurrency: input.spendCap?.currency ?? null,
          preset: input.preset ?? null,
          ...created(stamp),
        })
        .returning();
      return rows[0]!;
    },

    /**
     * Sets the token's scopes, its monthly cap of spend:commit when `spendCap` is given, and
     * the preset it follows when `preset` is given (null for none). Its hash, prefix and
     * projects never change.
     */
    async setScopes(
      id: string,
      scopes: string[],
      stamp: Stamp,
      spendCap?: { amount: number; currency: string },
      preset?: StandardPreset | null,
    ): Promise<AgentTokenRow | null> {
      const rows = await executor
        .update(agentTokens)
        .set({
          scopes,
          ...(spendCap === undefined
            ? {}
            : { spendCap: spendCap.amount, spendCapCurrency: spendCap.currency }),
          ...(preset === undefined ? {} : { preset }),
          ...updated(stamp),
        })
        .where(and(inWorkspace, eq(agentTokens.id, id)))
        .returning();
      return rows[0] ?? null;
    },

    /** Revokes a token. Null when it is unknown or revoked already. */
    async revoke(id: string, stamp: Stamp): Promise<AgentTokenRow | null> {
      const rows = await executor
        .update(agentTokens)
        .set({ revokedAt: stamp.at ?? new Date(), ...updated(stamp) })
        .where(and(inWorkspace, eq(agentTokens.id, id), isNull(agentTokens.revokedAt)))
        .returning();
      return rows[0] ?? null;
    },

    /**
     * Records that the token was used. It is bookkeeping, not a change anyone made, so
     * it moves no `updatedAt` and appends no event, and it writes at most once a minute.
     */
    async markUsed(id: string, at: Date): Promise<void> {
      await executor
        .update(agentTokens)
        .set({ lastUsedAt: at })
        .where(
          and(
            inWorkspace,
            eq(agentTokens.id, id),
            or(
              isNull(agentTokens.lastUsedAt),
              lt(agentTokens.lastUsedAt, new Date(at.getTime() - LAST_USE_STEP_MS)),
            ),
          ),
        );
    },
  };
}

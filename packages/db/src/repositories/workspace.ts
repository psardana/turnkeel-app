import type { PlanningSwitches, SwitchableViewId } from '@turnkeel/protocol';
import { eq } from 'drizzle-orm';
import { isTransaction, type Executor } from '../database.js';
import { ConflictError, NotInTransactionError, uniqueViolation } from '../errors.js';
import { lockWorkspace } from '../events/append.js';
import { updated, type Stamp, type WorkspaceRow } from '../rows.js';
import { workspaces } from '../schema/index.js';
import type { WorkspaceScope } from '../scope.js';

export interface WorkspacePatch {
  name?: string | undefined;
  slug?: string | undefined;
  baseCurrency?: string | undefined;
  timeZone?: string | undefined;
  planning?: PlanningSwitches | undefined;
  /** The tabs turned off for everyone. */
  tabsOff?: SwitchableViewId[] | undefined;
  /** When an Owner or Admin pressed Keep these tabs. */
  tabsKeptAt?: Date | undefined;
}

export function workspaceRepository(executor: Executor, scope: WorkspaceScope) {
  const self = eq(workspaces.id, scope.workspaceId);

  return {
    /** The workspace of the scope, deleted or not. Null when there is no such row. */
    async get(): Promise<WorkspaceRow | null> {
      const rows = await executor.select().from(workspaces).where(self);
      return rows[0] ?? null;
    },

    /** Takes the workspace's event lock until the transaction ends. See `lockWorkspace`. */
    async lock(): Promise<void> {
      if (!isTransaction(executor)) throw new NotInTransactionError('workspace.lock');
      await lockWorkspace(executor, scope.workspaceId);
    },

    /** Changes the name, the slug or the base currency. Throws `ConflictError` when the slug is taken. */
    async update(patch: WorkspacePatch, stamp: Stamp): Promise<WorkspaceRow | null> {
      const values = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      );
      try {
        const rows = await executor
          .update(workspaces)
          .set({ ...values, ...updated(stamp) })
          .where(self)
          .returning();
        return rows[0] ?? null;
      } catch (error) {
        const constraint = uniqueViolation(error);
        if (constraint !== null) {
          throw new ConflictError(
            'slug_taken',
            `Another workspace on this server has the slug "${patch.slug ?? ''}".`,
            constraint,
          );
        }
        throw error;
      }
    },

    /**
     * The soft delete of R26: sets `deletedAt` and removes nothing. The rows and the
     * events stay. Returns null when the workspace is unknown or already deleted.
     */
    async markDeleted(stamp: Stamp): Promise<WorkspaceRow | null> {
      const current = await this.get();
      if (!current || current.deletedAt !== null) return null;
      const rows = await executor
        .update(workspaces)
        .set({ deletedAt: stamp.at ?? new Date(), ...updated(stamp) })
        .where(self)
        .returning();
      return rows[0] ?? null;
    },
  };
}

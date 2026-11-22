import { randomUUID } from 'node:crypto';
import type { Role } from '@turnkeel/protocol';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../database.js';
import { created, updated, type InvitationRow, type Stamp } from '../rows.js';
import { invitations } from '../schema/index.js';
import type { WorkspaceScope } from '../scope.js';

export interface NewInvitation {
  email: string;
  role: Role;
  projectId?: string | null;
  /** The hash of the token. The token itself is in the link and nowhere else. */
  tokenHash: string;
  /** The person who invites. */
  invitedBy: string;
  expiresAt: Date;
}

export function invitationsRepository(executor: Executor, scope: WorkspaceScope) {
  const inWorkspace = eq(invitations.workspaceId, scope.workspaceId);
  const open = and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));
  /** The open invitations to one address, for the workspace (`projectId` null) or for one project. */
  const openTo = (email: string, projectId: string | null) =>
    and(
      inWorkspace,
      open,
      sql`lower(${invitations.email}) = ${email.toLowerCase()}`,
      projectId === null ? isNull(invitations.projectId) : eq(invitations.projectId, projectId),
    );

  return {
    /** The invitations of the workspace, newest first. `openOnly` leaves out accepted and revoked ones. */
    async list(options: { openOnly?: boolean } = {}): Promise<InvitationRow[]> {
      return executor
        .select()
        .from(invitations)
        .where(and(inWorkspace, options.openOnly ? open : undefined))
        .orderBy(desc(invitations.createdAt), desc(invitations.id));
    },

    async get(id: string): Promise<InvitationRow | null> {
      const rows = await executor
        .select()
        .from(invitations)
        .where(and(inWorkspace, eq(invitations.id, id)));
      return rows[0] ?? null;
    },

    /**
     * The invitations that a new one to this address, for the workspace or for this
     * project, would replace. Whoever invites must be allowed to revoke each of them.
     */
    async openFor(email: string, projectId: string | null): Promise<InvitationRow[]> {
      return executor.select().from(invitations).where(openTo(email, projectId));
    },

    /**
     * Makes an invitation. An open one to the same address for the same workspace or
     * project is revoked first, because a second invitation replaces the first.
     * `replaced` holds what was revoked, for the `member.invite_revoked` events.
     */
    async create(
      input: NewInvitation,
      stamp: Stamp,
    ): Promise<{ invitation: InvitationRow; replaced: InvitationRow[] }> {
      const email = input.email.toLowerCase();
      const projectId = input.projectId ?? null;
      const replaced = await executor
        .update(invitations)
        .set({ revokedAt: stamp.at ?? new Date(), ...updated(stamp) })
        .where(openTo(email, projectId))
        .returning();
      const rows = await executor
        .insert(invitations)
        .values({
          id: randomUUID(),
          workspaceId: scope.workspaceId,
          email,
          role: input.role,
          projectId,
          tokenHash: input.tokenHash,
          invitedBy: input.invitedBy,
          expiresAt: input.expiresAt,
          ...created(stamp),
        })
        .returning();
      return { invitation: rows[0]!, replaced };
    },

    /** Revokes an open invitation. Returns null when it is unknown, accepted or already revoked. */
    async revoke(id: string, stamp: Stamp): Promise<InvitationRow | null> {
      const rows = await executor
        .update(invitations)
        .set({ revokedAt: stamp.at ?? new Date(), ...updated(stamp) })
        .where(and(inWorkspace, open, eq(invitations.id, id)))
        .returning();
      return rows[0] ?? null;
    },

    /**
     * Marks an open invitation accepted, which is what makes it work once.
     * Returns null when it was not open any more, so two people racing to accept get one yes.
     */
    async markAccepted(id: string, stamp: Stamp): Promise<InvitationRow | null> {
      const rows = await executor
        .update(invitations)
        .set({ acceptedAt: stamp.at ?? new Date(), ...updated(stamp) })
        .where(and(inWorkspace, open, eq(invitations.id, id)))
        .returning();
      return rows[0] ?? null;
    },
  };
}

import { randomUUID } from 'node:crypto';
import type { ProjectRole, WorkspaceRole } from '@turnkeel/protocol';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Executor } from '../database.js';
import { ConflictError, uniqueViolation } from '../errors.js';
import {
  created,
  updated,
  type MemberRow,
  type ProjectMemberRow,
  type Stamp,
  type UserRow,
} from '../rows.js';
import { members, projectMembers, projects, user } from '../schema/index.js';
import type { WorkspaceScope } from '../scope.js';

/** A member with the account behind it. The email is for a reader with `member.read` only. */
export interface MemberWithUser {
  member: MemberRow;
  user: UserRow;
}

export interface ProjectMemberWithUser {
  projectMember: ProjectMemberRow;
  user: UserRow;
}

function handleTaken(handle: string, constraint: string): ConflictError {
  return new ConflictError(
    'handle_taken',
    `Someone in this workspace already has the handle "${handle}".`,
    constraint,
  );
}

export function membersRepository(executor: Executor, scope: WorkspaceScope) {
  const inWorkspace = eq(members.workspaceId, scope.workspaceId);

  return {
    /** Everyone with a workspace role, by handle. */
    async list(): Promise<MemberWithUser[]> {
      return executor
        .select({ member: members, user })
        .from(members)
        .innerJoin(user, eq(user.id, members.userId))
        .where(inWorkspace)
        .orderBy(asc(sql`lower(${members.handle})`));
    },

    async get(userId: string): Promise<MemberRow | null> {
      const rows = await executor
        .select()
        .from(members)
        .where(and(inWorkspace, eq(members.userId, userId)));
      return rows[0] ?? null;
    },

    /** The member that `@handle` names, without regard to case. */
    async findByHandle(handle: string): Promise<MemberRow | null> {
      const rows = await executor
        .select()
        .from(members)
        .where(and(inWorkspace, sql`lower(${members.handle}) = ${handle.toLowerCase()}`));
      return rows[0] ?? null;
    },

    /** How many Owners the workspace has, which R9 needs. */
    async countOwners(): Promise<number> {
      const rows = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(members)
        .where(and(inWorkspace, eq(members.role, 'owner')));
      return rows[0]?.count ?? 0;
    },

    /** Gives a person a workspace role and a handle. Throws `ConflictError` when either is taken. */
    async add(
      input: { userId: string; role: WorkspaceRole; handle: string },
      stamp: Stamp,
    ): Promise<MemberRow> {
      try {
        const rows = await executor
          .insert(members)
          .values({
            id: randomUUID(),
            workspaceId: scope.workspaceId,
            userId: input.userId,
            role: input.role,
            handle: input.handle,
            ...created(stamp),
          })
          .returning();
        return rows[0]!;
      } catch (error) {
        const constraint = uniqueViolation(error);
        if (constraint === 'members_workspace_handle_lower_key') {
          throw handleTaken(input.handle, constraint);
        }
        if (constraint !== null) {
          throw new ConflictError(
            'conflict',
            'This person is already in the workspace.',
            constraint,
          );
        }
        throw error;
      }
    },

    async setRole(userId: string, role: WorkspaceRole, stamp: Stamp): Promise<MemberRow | null> {
      const rows = await executor
        .update(members)
        .set({ role, ...updated(stamp) })
        .where(and(inWorkspace, eq(members.userId, userId)))
        .returning();
      return rows[0] ?? null;
    },

    /** Changes a handle. Throws `ConflictError` when someone else has it. */
    async setHandle(userId: string, handle: string, stamp: Stamp): Promise<MemberRow | null> {
      try {
        const rows = await executor
          .update(members)
          .set({ handle, ...updated(stamp) })
          .where(and(inWorkspace, eq(members.userId, userId)))
          .returning();
        return rows[0] ?? null;
      } catch (error) {
        const constraint = uniqueViolation(error);
        if (constraint !== null) throw handleTaken(handle, constraint);
        throw error;
      }
    },

    /** Takes the workspace role away. The person's project roles are a separate matter. */
    async remove(userId: string): Promise<MemberRow | null> {
      const rows = await executor
        .delete(members)
        .where(and(inWorkspace, eq(members.userId, userId)))
        .returning();
      return rows[0] ?? null;
    },
  };
}

export function projectMembersRepository(executor: Executor, scope: WorkspaceScope) {
  const inWorkspace = eq(projectMembers.workspaceId, scope.workspaceId);

  return {
    /** Every project role of the workspace, with the account behind it. */
    async list(): Promise<ProjectMemberWithUser[]> {
      return executor
        .select({ projectMember: projectMembers, user })
        .from(projectMembers)
        .innerJoin(user, eq(user.id, projectMembers.userId))
        .where(inWorkspace)
        .orderBy(asc(sql`lower(${user.name})`), asc(user.id));
    },

    /** Everyone with a role in the project. */
    async listForProject(projectId: string): Promise<ProjectMemberWithUser[]> {
      return executor
        .select({ projectMember: projectMembers, user })
        .from(projectMembers)
        .innerJoin(user, eq(user.id, projectMembers.userId))
        .where(and(inWorkspace, eq(projectMembers.projectId, projectId)))
        .orderBy(asc(sql`lower(${user.name})`), asc(user.id));
    },

    /** The project roles one person holds in the workspace. */
    async listForUser(userId: string): Promise<ProjectMemberRow[]> {
      return executor
        .select()
        .from(projectMembers)
        .where(and(inWorkspace, eq(projectMembers.userId, userId)));
    },

    async get(projectId: string, userId: string): Promise<ProjectMemberRow | null> {
      const rows = await executor
        .select()
        .from(projectMembers)
        .where(
          and(
            inWorkspace,
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, userId),
          ),
        );
      return rows[0] ?? null;
    },

    /**
     * Gives a person a role in a project, or changes the one they have. `previous` is
     * the role they had. Returns null when the workspace has no such project.
     */
    async set(
      input: { projectId: string; userId: string; role: ProjectRole },
      stamp: Stamp,
    ): Promise<{ projectMember: ProjectMemberRow; previous: ProjectRole | null } | null> {
      const project = await executor
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.workspaceId, scope.workspaceId), eq(projects.id, input.projectId)));
      if (project.length === 0) return null;

      const existing = await this.get(input.projectId, input.userId);
      if (existing) {
        const rows = await executor
          .update(projectMembers)
          .set({ role: input.role, ...updated(stamp) })
          .where(and(inWorkspace, eq(projectMembers.id, existing.id)))
          .returning();
        return { projectMember: rows[0]!, previous: existing.role };
      }
      const rows = await executor
        .insert(projectMembers)
        .values({
          id: randomUUID(),
          workspaceId: scope.workspaceId,
          projectId: input.projectId,
          userId: input.userId,
          role: input.role,
          ...created(stamp),
        })
        .returning();
      return { projectMember: rows[0]!, previous: null };
    },

    async remove(projectId: string, userId: string): Promise<ProjectMemberRow | null> {
      const rows = await executor
        .delete(projectMembers)
        .where(
          and(
            inWorkspace,
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, userId),
          ),
        )
        .returning();
      return rows[0] ?? null;
    },
  };
}

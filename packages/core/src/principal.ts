import {
  SYSTEM_PRINCIPAL_ID,
  type PrincipalRef,
  type ProjectRole,
  type Role,
  type WorkspaceRole,
} from '@turnkeel/protocol';

/**
 * What a person holds in one workspace: a workspace role, project roles, or both.
 * `role` is null for a person who holds only project roles.
 */
export interface Membership {
  readonly workspaceId: string;
  readonly role: WorkspaceRole | null;
  /** Project id to the role held in that project. */
  readonly projectRoles: Readonly<Record<string, ProjectRole>>;
}

/**
 * A person: signed in, or holding the local session in local mode.
 * `memberships` holds what the person has in every workspace that is not deleted, because
 * creating a workspace depends on being an Owner anywhere on the server.
 */
export interface PersonPrincipal {
  readonly kind: 'user';
  readonly userId: string;
  /** True for the local owner of local mode without sign-in, who may always create a workspace. */
  readonly local: boolean;
  readonly memberships: readonly Membership[];
}

/** An agent, acting through one token. */
export interface AgentPrincipal {
  readonly kind: 'agent';
  readonly agentId: string;
  readonly tokenId: string;
  readonly workspaceId: string;
  readonly scopes: readonly string[];
  readonly projectIds: readonly string[];
  readonly workspaceWide: boolean;
}

/** The system: a job or a connector. */
export interface SystemPrincipal {
  readonly kind: 'system';
}

export type Principal = PersonPrincipal | AgentPrincipal | SystemPrincipal;

export const systemPrincipal: SystemPrincipal = Object.freeze({ kind: 'system' });

/** Builds a person principal from the membership rows the database holds for them. */
export function personPrincipal(input: {
  userId: string;
  local?: boolean;
  memberships?: readonly Membership[];
}): PersonPrincipal {
  return {
    kind: 'user',
    userId: input.userId,
    local: input.local ?? false,
    memberships: input.memberships ?? [],
  };
}

/** The `{ kind, id }` that `createdBy`, `updatedBy` and an event's actor carry for a principal. */
export function principalRef(principal: Principal): PrincipalRef {
  switch (principal.kind) {
    case 'user':
      return { kind: 'user', id: principal.userId };
    case 'agent':
      return { kind: 'agent', id: principal.agentId };
    case 'system':
      return { kind: 'system', id: SYSTEM_PRINCIPAL_ID };
  }
}

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** What the person holds in the workspace, or undefined when they hold nothing there. */
export function membershipIn(
  principal: PersonPrincipal,
  workspaceId: string,
): Membership | undefined {
  const membership = principal.memberships.find((entry) => sameId(entry.workspaceId, workspaceId));
  if (!membership) return undefined;
  if (membership.role === null && Object.keys(membership.projectRoles).length === 0) {
    return undefined;
  }
  return membership;
}

/** The role a membership gives in one project, before R2 is applied; undefined when it gives none. */
export function projectRoleIn(membership: Membership, projectId: string): ProjectRole | undefined {
  for (const [id, role] of Object.entries(membership.projectRoles)) {
    if (sameId(id, projectId)) return role;
  }
  return undefined;
}

/**
 * The role that judges a project-level action: the project role when there is one,
 * else the workspace role. An Owner stays Owner everywhere. Null when the person has no
 * role that reaches the project.
 */
export function effectiveProjectRole(membership: Membership, projectId: string): Role | null {
  if (membership.role === 'owner') return 'owner';
  return projectRoleIn(membership, projectId) ?? membership.role;
}

/** True when the person is an Owner of at least one workspace on the server. */
export function isOwnerAnywhere(principal: PersonPrincipal): boolean {
  return principal.memberships.some((membership) => membership.role === 'owner');
}

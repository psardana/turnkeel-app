import { z } from 'zod';

/** The roles a person can hold in a workspace, highest first. Tester is not one of them. */
export const workspaceRoles = ['owner', 'admin', 'member', 'reviewer', 'viewer'] as const;

export type WorkspaceRole = (typeof workspaceRoles)[number];

/** The roles a person can hold in one project. */
export const projectRoles = ['member', 'reviewer', 'tester', 'viewer'] as const;

export type ProjectRole = (typeof projectRoles)[number];

/** Every role, highest first. */
export const roles = ['owner', 'admin', 'member', 'reviewer', 'tester', 'viewer'] as const;

export type Role = (typeof roles)[number];

export const workspaceRoleSchema = z.enum(workspaceRoles);
export const projectRoleSchema = z.enum(projectRoles);
export const roleSchema = z.enum(roles);

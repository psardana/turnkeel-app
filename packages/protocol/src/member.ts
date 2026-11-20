import { z } from 'zod';
import { commonFields } from './common.js';
import { emailSchema, handleSchema, idSchema, timestampSchema } from './ids.js';
import { projectRoleSchema, workspaceRoleSchema } from './roles.js';

/** The longest display name an account keeps. A longer one is cut where it is stored. */
export const DISPLAY_NAME_MAX = 80;

/**
 * A person's account on the server. It belongs to no workspace. `email` is
 * shown only to a person with `member.read`.
 */
export const userSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  email: emailSchema,
  emailVerified: z.boolean(),
  createdAt: timestampSchema,
});

export type User = z.infer<typeof userSchema>;

/** A person's role in a workspace, with their handle there. */
export const memberSchema = z.strictObject({
  ...commonFields,
  userId: idSchema,
  role: workspaceRoleSchema,
  handle: handleSchema,
});

export type Member = z.infer<typeof memberSchema>;

/** A person's role in one project. It replaces the workspace role there. */
export const projectMemberSchema = z.strictObject({
  ...commonFields,
  projectId: idSchema,
  userId: idSchema,
  role: projectRoleSchema,
});

export type ProjectMember = z.infer<typeof projectMemberSchema>;

/**
 * `PATCH /workspaces/:ws/members/:userId`. `role` needs `member.manage`.
 * A person may change their own `handle` without it.
 */
export const updateMemberRequestSchema = z
  .strictObject({
    role: workspaceRoleSchema,
    handle: handleSchema,
  })
  .partial();

export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

/** `PUT /workspaces/:ws/projects/:p/members/:userId`, under `member.manage`. */
export const setProjectMemberRequestSchema = z.strictObject({
  role: projectRoleSchema,
});

export type SetProjectMemberRequest = z.infer<typeof setProjectMemberRequestSchema>;

export type WorkspacePerson = z.infer<typeof workspacePersonSchema>;

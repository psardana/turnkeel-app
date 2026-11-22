import { z } from 'zod';
import { handleSchema, idSchema } from './ids.js';
import { userSchema } from './member.js';
import { projectRoleSchema, workspaceRoleSchema } from './roles.js';
import { workspaceSchema } from './workspace.js';

/**
 * One workspace the caller can open, with what they hold in it. `role` and `handle`
 * are null for a person who holds only project roles there.
 */
export const myWorkspaceSchema = z.strictObject({
  workspace: workspaceSchema,
  role: workspaceRoleSchema.nullable(),
  handle: handleSchema.nullable(),
  /** Project id to the role held in that project. */
  projectRoles: z.record(idSchema, projectRoleSchema),
  /** This person's own tabs, intros and Get started in the workspace. */
  view: personViewSchema,
});

export type MyWorkspace = z.infer<typeof myWorkspaceSchema>;

/**
 * `GET /me`: who the caller is and what they can open. `local` is true for the local
 * owner of local mode without sign-in. `canCreateWorkspace` is the answer
 * of the rule for creating a workspace, for this person right now.
 */
export const meSchema = z.strictObject({
  user: userSchema,
  local: z.boolean(),
  workspaces: z.array(myWorkspaceSchema),
  canCreateWorkspace: z.boolean(),
});

export type Me = z.infer<typeof meSchema>;

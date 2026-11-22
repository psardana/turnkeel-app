import { z } from 'zod';
import { commonFields } from './common.js';
import { emailSchema, handleSchema, idSchema, timestampSchema } from './ids.js';
import { memberSchema, projectMemberSchema } from './member.js';
import { roleSchema } from './roles.js';
import { workspaceSchema } from './workspace.js';

/**
 * An invitation, as a response shows it. The token and its hash are
 * never part of it. Without `projectId` the role is a workspace role; with
 * it, a project role. A Tester invitation always names a project.
 */
export const invitationSchema = z.strictObject({
  ...commonFields,
  email: emailSchema,
  role: roleSchema,
  projectId: idSchema.nullable(),
  invitedBy: idSchema,
  expiresAt: timestampSchema,
  acceptedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
});

export type Invitation = z.infer<typeof invitationSchema>;

/** `POST /workspaces/:ws/invitations`, under `member.manage`. R31 and R32 limit the role. */
export const createInvitationRequestSchema = z.strictObject({
  email: emailSchema,
  role: roleSchema,
  projectId: idSchema.optional(),
});

export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

/**
 * `POST /invitations/accept`. The token decides. An invitation to a workspace
 * also takes the handle the person picks; an invitation to a project gives none.
 */
export const acceptInvitationRequestSchema = z.strictObject({
  token: z.string().min(1).max(200),
  handle: handleSchema.optional(),
});

export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

/**
 * What `POST /workspaces/:ws/invitations` answers: the invitation, and what became of
 * its mail. `logged` means mail is not configured and the link is in the server log;
 * `failed` means the invitation exists and the mail could not be sent.
 */
export const createInvitationResponseSchema = z.strictObject({
  invitation: invitationSchema,
  mail: z.enum(['sent', 'logged', 'failed']),
});

export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>;

/** `POST /invitations/lookup`: the token from the link. */
export const lookupInvitationRequestSchema = z.strictObject({
  token: z.string().min(1).max(200),
});

export type LookupInvitationRequest = z.infer<typeof lookupInvitationRequestSchema>;

/**
 * What an invited person learns before they accept: the workspace, the
 * project when there is one, the role, who invited them, and the address the
 * invitation was sent to. `suggestedHandle` is a free handle for an invitation to the
 * workspace, made from the signed-in person's name, and null otherwise.
 */
export const invitationLookupSchema = z.strictObject({
  email: emailSchema,
  role: roleSchema,
  workspace: z.strictObject({ name: z.string(), slug: z.string() }),
  project: z.strictObject({ name: z.string() }).nullable(),
  invitedBy: z.strictObject({ name: z.string() }),
  expiresAt: timestampSchema,
  suggestedHandle: handleSchema.nullable(),
});

export type InvitationLookup = z.infer<typeof invitationLookupSchema>;

/**
 * What `POST /invitations/accept` answers: the workspace the person joined, and the
 * Member or the ProjectMember that was made. Exactly one of the two is set.
 */
export const acceptInvitationResponseSchema = z.strictObject({
  workspace: workspaceSchema,
  member: memberSchema.nullable(),
  projectMember: projectMemberSchema.nullable(),
});

export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;

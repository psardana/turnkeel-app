import { z } from 'zod';
import { commonFields } from './common.js';
import { emailSchema, handleSchema, idSchema, timestampSchema } from './ids.js';
import { roleSchema } from './roles.js';

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

export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;

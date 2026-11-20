import { z } from 'zod';

/**
 * The error codes and the status each one travels with. The statuses mean the same
 * on every channel. The first eight are the general
 * code of each status; the rest say more about a 409 or a 422.
 */
export const errorStatuses = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  payload_too_large: 413,
  too_many_requests: 429,
  unprocessable: 422,
  slug_taken: 409,
  key_taken: 409,
  handle_taken: 409,
  name_taken: 409,
  project_archived: 409,
  idempotency_key_reused: 409,
  rev_mismatch: 409,
  card_archived: 409,
  step_removed: 409,
  blocked_cycle: 422,
  blocked_other_project: 422,
  unknown_holder: 422,
  file_not_ready: 422,
  file_not_usable: 422,
  checksum_mismatch: 422,
  sync_failed: 422,
  project_required: 422,
  base_url_not_allowed: 422,
  draft_not_usable: 422,
  secrets_key_missing: 409,
  settings_invalid: 422,
  secrets_invalid: 422,
  assistant_unavailable: 409,
  assistant_cap_reached: 429,
  assistant_busy: 429,
  assistant_tests_limit: 429,
  feature_off: 409,
  milestone_in_use: 409,
  unknown_label: 422,
  unknown_milestone: 422,
  unknown_epic: 422,
  internal: 500,
} as const;

export type ErrorCode = keyof typeof errorStatuses;

export const errorCodes = Object.keys(errorStatuses) as [ErrorCode, ...ErrorCode[]];

/** A rule that refuses a request, written `R1` to `R85`. */
export const ruleIdSchema = z.string().regex(/^R[1-9][0-9]?$/);

export type RuleId = `R${number}`;

/** `{ "error": { "code", "message", "rule?" } }`: the body of every error answer. */
export const errorBodySchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(errorCodes),
    message: z.string(),
    rule: ruleIdSchema.optional(),
  }),
});

export type ErrorBody = z.infer<typeof errorBodySchema>;

/** Builds an error body. */
export function errorBody(code: ErrorCode, message: string, rule?: RuleId): ErrorBody {
  return { error: rule === undefined ? { code, message } : { code, message, rule } };
}

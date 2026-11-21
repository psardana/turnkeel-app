/** A repository was called without a workspace scope, or with one that is not a workspace id. */
export class MissingScopeError extends Error {
  override readonly name = 'MissingScopeError';

  constructor() {
    super('A repository needs a workspace scope. Make one with workspaceScope(workspaceId).');
  }
}

/** Something that appends events was called outside a transaction. */
export class NotInTransactionError extends Error {
  override readonly name = 'NotInTransactionError';

  constructor(what: string) {
    super(`${what} must run inside a transaction: db.transaction(async (tx) => ...).`);
  }
}

/** An event was to be appended to a workspace that has no counter row, so it does not exist. */
export class UnknownWorkspaceError extends Error {
  override readonly name = 'UnknownWorkspaceError';

  constructor(workspaceId: string) {
    super(`There is no workspace ${workspaceId}.`);
  }
}

/** An event that the log does not take: an unknown type, or data that names a secret. */
export class InvalidEventError extends Error {
  override readonly name = 'InvalidEventError';
}

/** What a write collided with. The server answers each with 409 and the error code of the same name. */
export type ConflictCode = 'slug_taken' | 'key_taken' | 'handle_taken' | 'name_taken' | 'conflict';

/** A write that would break a uniqueness rule. */
export class ConflictError extends Error {
  override readonly name = 'ConflictError';
  readonly code: ConflictCode;
  /** The database constraint that refused the write, when one did. */
  readonly constraint: string | null;

  constructor(code: ConflictCode, message: string, constraint: string | null = null) {
    super(message);
    this.code = code;
    this.constraint = constraint;
  }
}

/**
 * The name of the constraint, when `error` is a unique violation from either driver.
 * Drizzle wraps the driver's error, so the cause chain is searched.
 */
export function uniqueViolation(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const candidate = current as Error & { code?: unknown; constraint?: unknown };
    if (candidate.code === '23505') {
      return typeof candidate.constraint === 'string' ? candidate.constraint : '';
    }
    current = current.cause;
  }
  return null;
}

/** The SQLSTATE the append-only trigger raises (migrations/0001_events_append_only.sql). */
export const APPEND_ONLY_SQLSTATE = 'TK001';

/** True when `error` is the append-only trigger refusing a change to the event log. */
export function isAppendOnlyViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if ((current as Error & { code?: unknown }).code === APPEND_ONLY_SQLSTATE) return true;
    current = current.cause;
  }
  return false;
}

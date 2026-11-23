import {
  errorBody,
  errorStatuses,
  type ErrorBody,
  type ErrorCode,
  type RuleId,
} from '@turnkeel/protocol';
import type { Decision } from '@turnkeel/core';
import { messages } from '../messages.js';

/**
 * An answer that is an error: `{ "error": { "code", "message", "rule?" } }` with the
 * status of its code. Services throw it and the
 * app's error handler sends it, so every channel answers in the same shape.
 */
export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly code: ErrorCode;
  readonly rule: RuleId | undefined;
  /**
   * Fields the answer carries beside `error`, for the few errors that say more: the
   * 409 of a PATCH whose `rev` is out of date carries the current values.
   */
  readonly extra: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    rule?: RuleId,
    extra?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.code = code;
    this.rule = rule;
    this.extra = extra;
  }

  get status(): number {
    return errorStatuses[this.code];
  }

  get body(): ErrorBody {
    const body = errorBody(this.code, this.message, this.rule);
    return this.extra === undefined ? body : { ...body, ...this.extra };
  }
}

/**
 * The one 404. An item that does not exist and an item the caller may not know
 * about get exactly this answer, with no rule number, so the two cannot be told
 * apart.
 */
export function notFound(): HttpError {
  return new HttpError('not_found', messages.errors.notFound);
}

export function unauthorized(message: string = messages.errors.unauthorized): HttpError {
  return new HttpError('unauthorized', message);
}

/** Throws the error a denial stands for. `not_found` becomes the one 404. */
export function assertAllowed(decision: Decision): void {
  if (decision.allowed) return;
  if (decision.kind === 'not_found') throw notFound();
  if (decision.kind === 'conflict') throw new HttpError('conflict', decision.reason, decision.rule);
  throw new HttpError('forbidden', decision.reason, decision.rule);
}

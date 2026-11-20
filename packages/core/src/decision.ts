import type { RuleId } from '@turnkeel/protocol';
import { messages } from './messages.js';

export interface Allowed {
  readonly allowed: true;
}

/**
 * A refusal, with the sentence to show.
 *
 * - `forbidden`: the principal can see the item and may not do the action. Answered with 403.
 * - `not_found`: the principal may not learn that the item exists. Answered with the
 *   same 404 as an item that does not exist.
 * - `conflict`: the principal may do the action, but not to the item as it is now, such
 *   as setting the state of a gate that only its check sets. Answered with 409.
 * - `not_built`: the rule for this action, or this kind of principal, is not built yet,
 *   so the answer is no. Answered with 403.
 */
export interface Denied {
  readonly allowed: false;
  readonly kind: 'forbidden' | 'not_found' | 'conflict' | 'not_built';
  readonly reason: string;
  /** The rule that says no, when one does. */
  readonly rule?: RuleId;
}

export type Decision = Allowed | Denied;

export const allow: Allowed = Object.freeze({ allowed: true });

export function forbid(reason: string, rule?: RuleId): Denied {
  return rule === undefined
    ? { allowed: false, kind: 'forbidden', reason }
    : { allowed: false, kind: 'forbidden', reason, rule };
}

/**
 * R1: outside the caller's workspaces and projects, everything looks like it does not
 * exist. `rule` names a rule that says the same about one kind of object, such as R46
 * for a file. The answer to the caller is the one 404 either way, without a rule.
 */
export function hide(rule: RuleId = 'R1'): Denied {
  return { allowed: false, kind: 'not_found', reason: messages.notFound, rule };
}

/** The item as it is now does not allow the action, whoever asks (409). */
export function conflict(reason: string, rule: RuleId): Denied {
  return { allowed: false, kind: 'conflict', reason, rule };
}

export function notBuilt(reason: string): Denied {
  return { allowed: false, kind: 'not_built', reason };
}

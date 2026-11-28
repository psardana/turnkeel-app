/** The parts of a token and of its agent that say whether the token still works. */
export interface TokenState {
  readonly revokedAt: Date | string | null;
  readonly expiresAt: Date | string | null;
}

export interface AgentState {
  readonly disabledAt: Date | string | null;
}

const time = (value: Date | string) => (value instanceof Date ? value : new Date(value)).getTime();

/**
 * R10: an agent acts only through a token that is not revoked, not expired, and whose
 * agent is not disabled. A token expires at the moment `expiresAt` names.
 */
export function tokenUsable(token: TokenState, agent: AgentState, now: Date): boolean {
  if (token.revokedAt !== null) return false;
  if (agent.disabledAt !== null) return false;
  if (token.expiresAt !== null && time(token.expiresAt) <= now.getTime()) return false;
  return true;
}

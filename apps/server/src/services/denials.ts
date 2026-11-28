/** How long one `access.denied` stands for every refusal of the same kind after it. */
export const DENIED_WINDOW_MS = 60_000;

/** How many keys are kept before the ones with nothing to report are let go. */
const MAX_IDLE_KEYS = 1000;

/**
 * Bounds how many `access.denied` events an agent's refused writes append. For one
 * token, action and rule, at most one event is appended a minute. The refusals in
 * between are counted here, in the memory of this process, and the next event of that
 * kind carries how many there were as `repeats`.
 *
 * A server that runs as several processes counts in each of them, so each may append
 * its own event in a minute. A count that never gets a next event is not written, and
 * a restart forgets the counts.
 */
export interface DeniedLimiter {
  /**
   * Called for every refusal, before anything is awaited, so that refusals that arrive
   * at once are counted one by one. Answers with the number of refusals that were not
   * written since the last event of this kind when an event is to be appended now, and
   * with null when this refusal is only counted.
   */
  take(key: { tokenId: string; action: string; rule: string | null }): { repeats: number } | null;
}

interface Entry {
  /** When the last event of this kind was let through, by the clock of `Date.now`. */
  writtenAt: number;
  /** The refusals counted since then. */
  skipped: number;
}

export function createDeniedLimiter(windowMs: number = DENIED_WINDOW_MS): DeniedLimiter {
  const entries = new Map<string, Entry>();

  /** Lets go of the kinds that have nothing to report and whose minute is over. */
  function prune(now: number): void {
    if (entries.size <= MAX_IDLE_KEYS) return;
    for (const [key, entry] of entries) {
      if (entry.skipped === 0 && now - entry.writtenAt >= windowMs) entries.delete(key);
    }
  }

  return {
    take({ tokenId, action, rule }) {
      const now = Date.now();
      const key = `${tokenId.toLowerCase()} ${action} ${rule ?? '-'}`;
      const entry = entries.get(key);
      if (entry && now - entry.writtenAt < windowMs) {
        entry.skipped += 1;
        return null;
      }
      const repeats = entry?.skipped ?? 0;
      entries.set(key, { writtenAt: now, skipped: 0 });
      prune(now);
      return { repeats };
    },
  };
}

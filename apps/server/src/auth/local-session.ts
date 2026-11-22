import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** The cookie that makes a request the local owner's. */
export const LOCAL_SESSION_COOKIE = 'turnkeel_local';

/** How long the browser keeps the cookie. It works as long as the key file stays the same. */
export const LOCAL_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** The file in the data folder that holds the local session's secret. */
export const LOCAL_SESSION_KEY_FILE = 'local-session.key';

/** How many one-time codes can be waiting to be used at once. */
const MAX_PENDING_CODES = 20;

/**
 * The local session of local mode without sign-in.
 *
 * The secret comes from the key file of the data folder (`loadOrCreateLocalSessionKey`)
 * and never leaves this object. A one-time code is made from it; the launcher gets a
 * URL with that code and opens the browser there. The code is exchanged once for a
 * cookie, and only a request with that cookie is the local owner. The cookie is made
 * from the secret alone, so it works again after a restart that reads the same file.
 * The codes live in memory only: a restart forgets every code that was not used.
 */
export interface LocalSession {
  /** Makes a code that `redeem` accepts once. */
  issueCode(): string;
  /** Uses up a code. Returns the cookie value, or null when the code is unknown or was used. */
  redeem(code: string): string | null;
  /** True when `cookie` is the value this secret gives out. */
  verify(cookie: string | undefined): boolean;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The local session under `secret`; a random one, held in memory only, unless given. */
export function createLocalSession(secret: Buffer = randomBytes(KEY_BYTES)): LocalSession {
  const sign = (text: string) => createHmac('sha256', secret).update(text).digest('base64url');
  const cookieValue = sign('local-session');
  /** The codes that were given out and not used yet. */
  const pending = new Set<string>();

  return {
    issueCode() {
      const code = sign(`one-time-code:${randomBytes(32).toString('base64url')}`);
      if (pending.size >= MAX_PENDING_CODES) {
        const oldest = pending.values().next().value;
        if (oldest !== undefined) pending.delete(oldest);
      }
      pending.add(code);
      return code;
    },

    redeem(code) {
      for (const candidate of pending) {
        if (sameText(candidate, code)) {
          pending.delete(candidate);
          return cookieValue;
        }
      }
      return null;
    },

    verify(cookie) {
      return cookie !== undefined && sameText(cookie, cookieValue);
    },
  };
}

/**
 * The secret of the local session, from `local-session.key` in `folder` (the data
 * folder): read when the file is there, made once when it is not (32 random bytes, mode
 * 0600). A file that other accounts may read, or that is not 32 bytes, is replaced by a
 * new one, which signs every browser out; `onReplaced` hears about that, with the file's
 * path and never its content. Removing the file and starting again signs every browser
 * out as well.
 */
export function loadOrCreateLocalSessionKey(
  folder: string,
  onReplaced: (file: string, problem: LocalSessionKeyProblem) => void = () => {},
): Buffer {
  const file = path.join(folder, LOCAL_SESSION_KEY_FILE);
  const found = readKeyFile(file);
  if (found !== null && 'key' in found) return found.key;
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const key = randomBytes(KEY_BYTES);
  writeKeyFile(file, key);
  if (found !== null) onReplaced(file, found.problem);
  return key;
}

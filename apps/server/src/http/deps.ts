import type { Database, EventBus } from '@turnkeel/db';
import type { ServerInfo } from '@turnkeel/protocol';
import type { Context } from 'hono';
import type { Auth } from '../auth/auth.js';
import type { Logger } from '../log.js';
import type { Mailer } from '../mail/mailer.js';
import type { KeyedWrite, ServerSettings, ServiceContext } from '../services/context.js';
import type { AppEnv } from './context.js';
import type { AgentTokenVerifier, LocalMode } from './principal.js';

/** Everything the app is made of. `createRuntime` builds it; tests can pass their own parts. */
export interface AppDeps {
  db: Database;
  bus: EventBus;
  /** Sign-in, when it is on. */
  auth: Auth | null;
  /** Local mode without sign-in, when sign-in is off. Exactly one of `auth` and `local` is set. */
  local: LocalMode | null;
  agentTokens: AgentTokenVerifier;
  mailer: Mailer;
  logger: Logger;
  settings: ServerSettings;
  /** What `GET /server` answers. */
  info: ServerInfo;
  /**
   * True for a `host:port` a request may name in local mode: `127.0.0.1`,
   * `localhost` or a name under `.localhost`, on the server's own port. Functions,
   * because the port is known only once the server listens.
   */
  hostAllowed: (host: string) => boolean;
  /** True for an `Origin` a browser's write may come from: the server's own pages. */
  originAllowed: (origin: string) => boolean;
  /**
   * The server's own origins, written out, for the shell's Content-Security-Policy:
   * the public URL with sign-in, `http://127.0.0.1:<port>` and `http://localhost:<port>`
   * in local mode. A page opened under a name of `.localhost` is `'self'` there.
   */
  allowedOrigins: () => readonly string[];
  /**
   * The address a request is counted under by the limits on sign-in, or null when it
   * has none. `createRuntime` reads the socket and `TURNKEEL_TRUSTED_PROXIES`.
   */
  clientAddress: (c: Context) => string | null;
  /** How often a stream sends its comment line, in milliseconds (25 seconds by default). */
  heartbeatMs: number;
  /**
   * How often an open stream looks at the session it was opened with, in
   * milliseconds. A stream whose session has ended, by sign-out or by its time
   * running out, is closed at the next look.
   */
  sessionCheckMs: number;
  /** The folder with the built web app, or null when there is none. */
  webDir: string | null;
  /** The open streams, so that stopping the server can end them. */
  streams: Set<() => void>;
  /** Counts an agent's refused writes, so that `access.denied` is appended at most once a
   * minute for each kind. */
  denials: DeniedLimiter;
  /** The hook events refused for a known token in the last hour, for the Agents page. */
  hookRefusals: HookRefusals;
  /** Where files are kept, and the largest one taken. */
  files: FileDeps;
  /** The assistant: the install's default, the secrets key and the clients to model hosts. */
  assistant: AssistantRuntime;
  /** The connector runtime: the connectors of this server, the secrets key, `fetch`. */
  connectors: ConnectorRuntime;
}

/** The service context of one request. */
export function contextOf(
  c: Context<AppEnv>,
  deps: AppDeps,
  keyed: KeyedWrite | null = null,
): ServiceContext {
  return {
    db: deps.db,
    caller: c.get('caller'),
    requestId: c.get('requestId'),
    keyed,
    settings: deps.settings,
    mailer: deps.mailer,
    logger: deps.logger,
    denials: deps.denials,
    connectors: deps.connectors,
    storage: deps.files.storage,
  };
}

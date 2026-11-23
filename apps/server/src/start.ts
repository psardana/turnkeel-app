import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { DEFAULT_HOST, DEFAULT_PORT } from './defaults.js';
import { consoleLogger, type Logger } from './log.js';
import { messages } from './messages.js';

/** The port is taken, or the address cannot be listened on. */
export class ListenError extends Error {
  override readonly name = 'ListenError';
}

/** A server that listens. */
export interface RunningServer {
  /** The address the server is reached at: the public URL with sign-in on, the loopback address in local mode. */
  readonly url: string;
  readonly host: string;
  /** The port it listens on. */
  readonly port: number;
  readonly mode: 'local' | 'server';
  /**
   * Local mode: the URL that gives a browser the local session. It works once.
   * Null with sign-in on.
   */
  readonly oneTimeUrl: string | null;
  /** Local mode: another one-time URL, for a second browser or after the first was used. */
  newOneTimeUrl(): string;
  /** True when this start loaded the demo workspace. */
  readonly demoLoaded: boolean;
  /** Stops listening, ends the open streams, stops the jobs and closes the database. */
  stop(): Promise<void>;
  readonly runtime: Runtime;
}

export type StartOptions = Omit<RuntimeOptions, 'config'>;

function listen(
  fetch: Parameters<typeof serve>[0]['fetch'],
  host: string,
  port: number,
): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, hostname: host, port });
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new ListenError(messages.log.portInUse(host, port))
          : new ListenError(error.message),
      );
    });
    server.once('listening', () => resolve(server));
  });
}

/**
 * Starts the server from a checked configuration: builds it, listens, and returns
 * the handle that stops it. With sign-in off this is local mode.
 */
export async function startServer(
  config: Config,
  options: StartOptions = {},
): Promise<RunningServer> {
  const logger = options.logger ?? consoleLogger;
  // R29, once more, for a configuration that did not come from `loadConfig`: without
  // sign-in the server listens on the loopback address and on nothing else.
  if (config.signIn === null && !isLocalModeHost(config.host)) {
    throw new ConfigError([messages.config.notLocalHost]);
  }
  const runtime = await createRuntime({ ...options, config, logger });
  // Until the demo is loaded, every request is answered 503: none can see half a seed.
  let ready = false;
  // The node server's own bindings go on to the app, which reads the socket's address there.
  const fetch: Parameters<typeof serve>[0]['fetch'] = (request, env) =>
    ready
      ? runtime.app.fetch(request, env)
      : new Response(messages.log.starting, {
          status: 503,
          headers: { 'retry-after': '1', 'content-type': 'text/plain; charset=utf-8' },
        });
  let server: ServerType;
  try {
    server = await listen(fetch, config.host, config.port);
  } catch (error) {
    await runtime.stop();
    throw error;
  }
  const port = (server.address() as AddressInfo).port;
  runtime.setAddress({ host: config.host, port });
  // The demo is seeded once the port is bound: a start that cannot listen has
  // seeded nothing, so the token the first page shows is never lost to a busy port.
  try {
    await runtime.loadDemo();
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.stop();
    throw error;
  }
  ready = true;

  let stopped = false;
  return {
    url: runtime.baseUrl(),
    host: config.host,
    port,
    mode: runtime.mode,
    oneTimeUrl: runtime.mode === 'local' ? runtime.newOneTimeUrl() : null,
    newOneTimeUrl: () => runtime.newOneTimeUrl(),
    demoLoaded: runtime.demoLoaded,
    runtime,
    async stop() {
      if (stopped) return;
      stopped = true;
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      // An assistant call is recorded and its page told before the connections go.
      await runtime.interruptCalls();
      // A stream is a connection that never ends by itself.
      if ('closeAllConnections' in server) server.closeAllConnections();
      await runtime.stop();
      await closed;
    },
  };
}

export interface StartLocalOptions extends StartOptions {
  /** The port to listen on. 0 takes a free one. 4400 unless given. */
  port?: number;
  /** Where PGlite and files are kept. `~/.turnkeel` unless given. */
  dataDir?: string;
  /** The loopback address to listen on. 127.0.0.1 unless given. */
  host?: string;
  /**
   * Whether the first run loads the demo workspace. False unless given:
   * `turnkeel --demo` is true.
   */
  demo?: boolean;
}

/**
 * Starts local mode: PGlite in a data folder, no sign-in, this machine only.
 * This is what the launcher asks for. It reads nothing from the
 * environment but the home folder, when no data folder is given.
 *
 * The result has the server's `url`, the `oneTimeUrl` to open the browser at, and
 * `stop`.
 */
export async function startLocal(options: StartLocalOptions = {}): Promise<RunningServer> {
  const { port, dataDir, host, demo, ...rest } = options;
  const base = loadConfig({
    TURNKEEL_HOST: host ?? DEFAULT_HOST,
    TURNKEEL_DEMO: demo === true ? 'true' : 'false',
    ...(dataDir === undefined ? {} : { TURNKEEL_DATA_DIR: dataDir }),
  });
  return startServer({ ...base, port: port ?? DEFAULT_PORT }, rest);
}

/** Starts the server the environment describes: local mode, or with sign-in when `TURNKEEL_PUBLIC_URL` is set. */
export async function startFromEnvironment(
  env: Environment = process.env,
  options: StartOptions = {},
): Promise<RunningServer> {
  return startServer(loadConfig(env), options);
}

/**
 * The lines a start has to say, in order.
 *
 * `oneTimeUrl: false` leaves the one-time URL out. That is for a server started by
 * the launcher, which gets the URL over the channel and opens the browser at it: a
 * printed copy would be an address that no longer works.
 */
export function describeStart(
  server: RunningServer,
  logger: Logger,
  options: { oneTimeUrl?: boolean } = {},
): void {
  const { config, database } = server.runtime;
  for (const notice of config.notices) logger.warn(notice);
  logger.info(
    messages.log.database(
      database.engine === 'postgres' ? 'Postgres' : 'PGlite',
      database.engine === 'postgres' ? 'DATABASE_URL' : (database.dataDir ?? 'in memory'),
    ),
  );
  // Local mode names the address a browser opens, which for `::1` is `localhost`.
  // With sign-in on it names where the server is bound, but not as a link:
  // sign-in works only at TURNKEEL_PUBLIC_URL, which the next line gives.
  logger.info(
    server.mode === 'local'
      ? messages.log.listening(server.url)
      : messages.log.listeningOn(server.host, server.port),
  );
  if (server.mode === 'local') {
    logger.info(messages.log.localMode);
    // Under the launcher, which says it in its own words, these two are left out.
    if (server.oneTimeUrl !== null && options.oneTimeUrl !== false) {
      logger.info(messages.log.oneTimeUrl(server.oneTimeUrl));
    }
    if (server.demoLoaded && options.oneTimeUrl !== false) {
      logger.info(messages.log.loadedDemo);
    }
  } else {
    logger.info(messages.log.serverMode(server.url));
  }
}

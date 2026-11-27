import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDatabase,
  createEventBus,
  defaultMigrationsFolder,
  runMigrations,
  type DatabaseHandle,
  type EventBus,
} from '@turnkeel/db';
import type { ServerInfo } from '@turnkeel/protocol';
import type { Context, Hono } from 'hono';
import { createAuth, type Auth } from './auth/auth.js';
import { ConfigError, type Config } from './config.js';
import { createApp } from './http/app.js';
import {
  createClientAddressResolver,
  FORWARDED_FOR_HEADER,
  socketAddress,
} from './http/client-address.js';
import type { AppEnv } from './http/context.js';
import type { AppDeps } from './http/deps.js';
import { createJobRunner, defineJobs, type JobRunner } from './jobs/index.js';
import { claimDataDir, databaseDir } from './local/data-dir.js';
import { createMailer, type Mailer } from './mail/mailer.js';
import { messages } from './messages.js';

/** How often a stream sends its comment line. */
export const HEARTBEAT_MS = 25_000;

/** How often an open stream checks that the session it was opened with still stands. */
export const SESSION_CHECK_MS = 60_000;

export interface RuntimeOptions {
  config: Config;
  logger?: Logger;
  /** A mailer to use in place of the configured one. Tests pass one that keeps the mail. */
  mailer?: Mailer;
  /**
   * A database that is open and migrated already. The runtime uses it and does not
   * close it. Tests pass the one `createTestDatabase` made.
   */
  database?: DatabaseHandle;
  /** False leaves the job runner out. Tests that are not about jobs do that. */
  jobs?: boolean;
  /** The folder with the built web app. Unless given, the usual places are looked at. */
  webDir?: string | null;
  heartbeatMs?: number;
  /** How often an open stream looks at its session again. A minute unless given. */
  sessionCheckMs?: number;
  /**
   * Says which address a request comes from, in place of the socket. Tests pass one,
   * because a request made in process has no socket.
   */
  clientAddress?: (c: Context) => string | null;
  /**
   * How many sign-in links one address is sent, and within how many minutes: 3 in 10
   * unless given. The API tests raise it, because they sign the same few people in
   * over and over within seconds.
   */
  signInLinkLimit?: { max: number; minutes: number } | undefined;
  /** How bearer tokens are checked. Unless given, by the agent tokens in the database. */
  agentTokens?: AgentTokenVerifier;
  /**
   * The folder that keeps files when no object store is set. `files` in the data folder
   * unless given; the API tests pass a folder of their own.
   */
  filesDir?: string;
  /**
   * The folder of local mode's key files, the secrets key and the local session's key.
   * The data folder unless given; the API tests pass a folder of their own.
   */
  secretsDir?: string;
  /**
   * The connector runtime, for tests: connectors to add (one that takes webhooks), the
   * `fetch` a connector's `ctx.fetch` calls (a stub, so nothing leaves the machine), and
   * a shorter timeout.
   */
  connectors?: {
    extra?: readonly Connector[];
    fetch?: (input: string, init?: RequestInit) => Promise<Response>;
    /** What `ctx.connect` calls: a fake server in a test. */
    connect?: ConnectorConnect;
    timeoutMs?: number;
  };
  /** How names are resolved for the assistant's connections, and shorter limits; for tests. */
  assistant?: {
    resolve?: Resolver;
    timings?: Partial<AssistantTimings>;
    testsPerMinute?: number;
  };
}

/** The server, built and not yet listening. `startServer` makes one and listens. */
export interface Runtime {
  readonly app: Hono<AppEnv>;
  readonly config: Config;
  readonly mode: 'local' | 'server';
  readonly database: DatabaseHandle;
  readonly bus: EventBus;
  readonly jobs: JobRunner | null;
  readonly auth: Auth | null;
  readonly mailer: Mailer;
  /** Local mode: the session of this start. Null with sign-in on. */
  readonly localSession: LocalSession | null;
  /** True when this start loaded the demo workspace: local mode's first run. */
  readonly demoLoaded: boolean;
  /**
   * Loads the demo workspace on local mode's first run when `--demo` asked for it, and
   * answers whether it did. `startServer` calls it once the port is bound.
   */
  loadDemo(): Promise<boolean>;
  /** The connector runtime: the connectors of this server, which the scheduled job runs. */
  readonly connectors: ConnectorRuntime;
  /** Tells the runtime where it listens, which the Host check and the links need. */
  setAddress(address: { host: string; port: number }): void;
  /** The address the server is reached at: the public URL, or the loopback address it listens on. */
  baseUrl(): string;
  /** Local mode: a URL that gives a browser the local session, once. */
  newOneTimeUrl(): string;
  /** How many streams are open right now. */
  openStreams(): number;
  /**
   * Ends the assistant calls that run: each is recorded as `interrupted` and its page
   * gets the `error` event, before this resolves. `stop` does it too.
   */
  interruptCalls(): Promise<void>;
  /** Ends the streams, stops the jobs and the event bus, and closes the database it opened. */
  stop(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** How long stopping the server waits for its assistant calls to be recorded. */
const INTERRUPT_WAIT_MS = 10_000;

/** The first of the usual places that holds what is looked for, seen from the sources and from the bundle. */
function firstExisting(candidates: string[], marker: string): string | null {
  return candidates.find((candidate) => existsSync(path.join(candidate, marker))) ?? null;
}

/** The migrations: next to the bundle when the server runs from one, in `packages/db` otherwise. */
export function findMigrationsFolder(): string {
  return (
    firstExisting(
      [path.join(here, 'migrations'), path.join(here, '..', 'migrations'), defaultMigrationsFolder],
      path.join('meta', '_journal.json'),
    ) ?? defaultMigrationsFolder
  );
}

/** The built web app: next to the bundle, or in `apps/web/dist` when the server runs from its sources. */
export function findWebDir(): string | null {
  return firstExisting(
    [
      path.join(here, 'web'),
      path.join(here, '..', 'web'),
      path.join(here, '..', '..', 'web', 'dist'),
    ],
    'index.html',
  );
}

/** A host as a URL writes it: an IPv6 address in brackets. */
export function hostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/**
 * The name local mode hands out, for the address it is bound to. R33 allows
 * `127.0.0.1`, `localhost` and names under `.localhost`; the server hands out one of
 * the first two. A server bound to `::1` or to `localhost` is reached as `localhost`;
 * one bound to `127.0.0.1` as that.
 */
export function localModeName(host: string): 'localhost' | '127.0.0.1' {
  return host === '127.0.0.1' ? '127.0.0.1' : 'localhost';
}

/**
 * Builds the server from its configuration: the database with its migrations, the
 * event bus, the job runner, sign-in or the local session, and the app. Nothing
 * listens yet. Sign-in is on when `TURNKEEL_PUBLIC_URL` is set; without it the server
 * runs local mode.
 */
export async function createRuntime(options: RuntimeOptions): Promise<Runtime> {
  const { config } = options;
  const logger = options.logger ?? silentLogger;
  const mode = config.signIn === null ? 'local' : 'server';
  const cleanup: (() => Promise<void> | void)[] = [];
  const runCleanup = async () => {
    for (const step of cleanup.reverse()) {
      try {
        await step();
      } catch (error) {
        logger.error(messages.log.stopping, error);
      }
    }
    cleanup.length = 0;
  };

  try {
    // --- Database ---------------------------------------------------------------
    let database: DatabaseHandle;
    if (options.database) {
      database = options.database;
    } else {
      if (config.databaseUrl === null) {
        cleanup.push(claimDataDir(config.dataDir, { warn: (line) => logger.warn(line) }));
      }
      database = await createDatabase({
        url: config.databaseUrl ?? undefined,
        directUrl: config.databaseUrlDirect ?? undefined,
        dataDir: config.databaseUrl === null ? databaseDir(config.dataDir) : undefined,
        onError: (error) => logger.error(messages.log.databaseError, safeError(error)),
      });
      cleanup.push(() => database.close());
      await runMigrations(database, { migrationsFolder: findMigrationsFolder() });
    }
    const db = database.db;

    // Sign-in on a database that only local mode has used would let nobody in.
    if (config.signIn !== null && (await isLocalOnlyInstall(db))) {
      throw new ConfigError([messages.config.localInstallWithSignIn]);
    }
    // Local mode on a database whose local owner was claimed would make a new local owner
    // who holds nothing, and the workspaces would seem gone.
    if (config.signIn === null && (await wasClaimed(db))) {
      throw new ConfigError([messages.config.claimedWithoutSignIn]);
    }
    // A token follows its preset: the scopes a preset gained in
    // this release reach its tokens before the first request is answered.
    const followed = await followTokenPresets(db);
    if (followed > 0) logger.info(messages.log.tokensFollowedPreset(followed));

    const bus = await createEventBus(database, {
      onError: (error) => logger.error(messages.log.eventBusError, safeError(error)),
      applicationName: 'turnkeel-events',
    });
    cleanup.push(() => bus.close());

    // --- Mail, sign-in, the local session --------------------------------------------
    const mailer = options.mailer ?? createMailer(config.mail, logger);
    if (!options.mailer) cleanup.push(() => mailer.close());

    let address = { host: config.host, port: config.port };
    // The address the server hands out in local mode is one it answers at.
    const loopbackUrl = () => `http://${localModeName(address.host)}:${address.port}`;
    const baseUrl = () => config.signIn?.publicUrl ?? loopbackUrl();

    const auth = config.signIn
      ? createAuth({
          signIn: config.signIn,
          db,
          mailer,
          logger,
          linkLimit: options.signInLinkLimit,
        })
      : null;
    // The secret of the local session is kept in the data folder, so the cookie outlives a
    // restart. Every local mode has a data folder, on Postgres too.
    const localSession = config.signIn
      ? null
      : createLocalSession(
          loadOrCreateLocalSessionKey(options.secretsDir ?? config.dataDir, (file, problem) =>
            logger.warn(messages.log.localSessionKeyReplaced(file, problem)),
          ),
        );
    const local = localSession
      ? {
          session: localSession,
          ownerUserId: (await prepareLocalInstall(db)).id,
          firstRun: createFirstRunNotice(),
          // "Look at the demo first" on the first screen; defined below, with the seed.
          loadDemo: () => seedDemoNow(),
        }
      : null;

    // --- Files --------------------------------------------------------------------------
    // An object store when S3_ENDPOINT is set; else a folder, whose addresses are signed
    // with a secret of this start.
    const storage: FileStorage = config.storage
      ? s3Storage(config.storage)
      : folderStorage(
          options.filesDir ?? path.join(config.dataDir, 'files'),
          randomBytes(32),
          baseUrl,
        );

    // --- Stored secrets and the assistant ---------------------------------------------------
    // `TURNKEEL_SECRETS_KEY`, or in local mode without sign-in the key file of the data
    // folder, made at the first start that finds none. Nothing reaches a
    // model host at start.
    const secrets: SecretBox | null =
      config.secretsKey !== null
        ? secretBoxFromKey(keyFromVariable(config.secretsKey))
        : mode === 'local'
          ? secretBoxFromKey(loadOrCreateKeyFile(options.secretsDir ?? config.dataDir))
          : null;
    // The connector runtime: the connectors of this server, sealed with the same key.
    const connectors = createConnectorRuntime({
      secrets,
      extra: options.connectors?.extra,
      fetch: options.connectors?.fetch,
      connect: options.connectors?.connect,
      timeoutMs: options.connectors?.timeoutMs,
      storage,
    });

    // --- The demo -------------------------------------------------------------------------
    // Local mode's first run starts empty. `turnkeel --demo` loads the demo workspace
    // at the start, and "Look at the demo first" on the first screen loads it on request.
    // Never with sign-in, and never into a database that has a workspace, a
    // deleted one included. `startServer` calls `loadDemo` once the port is bound, so a
    // start that cannot listen has seeded nothing, and its next start is still a first run.
    let demoLoaded = false;
    const loadDemo = async (): Promise<boolean> =>
      demoLoaded || !config.demo ? false : seedDemoNow();
    async function seedDemoNow(): Promise<boolean> {
      if (local === null || !(await isFirstRun(db))) return false;
      const notice = await seedDemo({
        db,
        logger,
        mailer,
        storage,
        connectors,
        settings: { mode, openSignup: false, baseUrl, publicUrl: null },
        ownerUserId: local.ownerUserId,
      });
      if (notice === null) return false;
      local.firstRun.set(notice);
      demoLoaded = true;
      return true;
    }

    // --- Jobs ---------------------------------------------------------------------------
    let jobs: JobRunner | null = null;
    if (options.jobs !== false) {
      const runner = createJobRunner(database, {
        onError: (error) => logger.error(messages.log.jobRunnerError, safeError(error)),
      });
      await runner.start();
      cleanup.push(() => runner.stop());
      await defineJobs(runner, { db, logger, storage, connectors });
      jobs = runner;
    }

    const resolve = options.assistant?.resolve;
    // Where a workspace's own base URL may point: a local address in local mode only,
    // and with open sign-up only https on port 443 to a host name.
    const ownAllowance = {
      localAllowed: mode === 'local',
      namedHttpsOnly: config.signIn?.openSignup === true,
    };
    const assistant: AssistantRuntime = {
      mode,
      install: config.assistant.default,
      installDailyCap: config.assistant.dailyCap,
      secrets,
      ownAllowance,
      hosts: {
        // A workspace names a local address only in local mode; the environment always may.
        own: createHostClient({ allowance: ownAllowance, resolve }),
        install: createHostClient({ allowance: { localAllowed: true }, resolve }),
      },
      tests: createTestLimiter(options.assistant?.testsPerMinute),
      timings: { ...defaultTimings, ...options.assistant?.timings },
      running: new Set(),
    };
    // Stopping the server ends the assistant calls that run, records each as
    // `interrupted` with its `assistant.called` and tells its page, before the database
    // closes. Cleanup runs last step first, so this comes before the database.
    const interruptCalls = async () => {
      const stops = [...assistant.running].map((stop) => stop());
      if (stops.length === 0) return;
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.allSettled(stops),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, INTERRUPT_WAIT_MS);
        }),
      ]);
      clearTimeout(timer);
    };
    cleanup.push(interruptCalls);

    // --- The app ------------------------------------------------------------------------
    const info: ServerInfo = {
      mode,
      signIn: {
        magicLink: config.signIn !== null,
        github: config.signIn?.github != null,
        google: config.signIn?.google != null,
        // A passkey is offered to a person who has added one, which needs sign-in.
        passkey: config.signIn !== null,
      },
      mail: mailer.kind,
      openSignup: config.signIn?.openSignup ?? false,
    };
    const streams = new Set<() => void>();
    cleanup.push(() => {
      for (const close of [...streams]) close();
    });

    const resolveClientAddress = createClientAddressResolver(config.trustedProxies);

    const deps: AppDeps = {
      db,
      bus,
      auth,
      local,
      agentTokens: options.agentTokens ?? createAgentTokenVerifier(db),
      mailer,
      logger,
      settings: {
        mode,
        openSignup: info.openSignup,
        baseUrl,
        publicUrl: config.signIn?.publicUrl ?? null,
      },
      info,
      // R33: `127.0.0.1`, `localhost` or a name under `.localhost`, on the port the server
      // listens on.
      hostAllowed: (host) => isLocalModeHostHeader(host, address.port),
      originAllowed: (origin) =>
        config.signIn
          ? origin.toLowerCase() === new URL(config.signIn.publicUrl).origin
          : isLocalModeOrigin(origin, address.port),
      allowedOrigins: () =>
        config.signIn
          ? [new URL(config.signIn.publicUrl).origin]
          : [`http://127.0.0.1:${address.port}`, `http://localhost:${address.port}`],
      clientAddress:
        options.clientAddress ??
        ((c) => resolveClientAddress(socketAddress(c), c.req.header(FORWARDED_FOR_HEADER) ?? null)),
      heartbeatMs: options.heartbeatMs ?? HEARTBEAT_MS,
      sessionCheckMs: options.sessionCheckMs ?? SESSION_CHECK_MS,
      webDir: options.webDir === undefined ? findWebDir() : options.webDir,
      streams,
      denials: createDeniedLimiter(),
      hookRefusals: createHookRefusals(),
      files: { storage, maxFileBytes: config.maxFileBytes },
      assistant,
      connectors,
    };

    return {
      app: createApp(deps),
      config,
      mode,
      database,
      bus,
      jobs,
      auth,
      mailer,
      localSession,
      get demoLoaded() {
        return demoLoaded;
      },
      loadDemo,
      connectors,
      setAddress(next) {
        address = next;
      },
      baseUrl,
      openStreams: () => streams.size,
      interruptCalls,
      newOneTimeUrl() {
        if (!localSession) throw new Error('A one-time URL exists in local mode only.');
        const url = new URL('/api/v1/local/session', loopbackUrl());
        url.searchParams.set('code', localSession.issueCode());
        return url.toString();
      },
      stop: runCleanup,
    };
  } catch (error) {
    await runCleanup();
    throw error;
  }
}

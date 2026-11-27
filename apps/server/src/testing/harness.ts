import { mkdtempSync, rmSync } from 'node:fs';
import { createTestDatabase, type TestDatabase } from '@turnkeel/db/testing';
import {
  countWorkspaces,
  findUserByEmail,
  findWorkspaceBySlug,
  repositories,
  workspaceScope,
  type DatabaseEngine,
} from '@turnkeel/db';
import { expect } from 'vitest';
import { loadConfig, type Config, type Environment } from '../config.js';
import { memoryLogger } from '../log.js';
import type { MailMessage, Mailer } from '../mail/mailer.js';
import { createRuntime, type Runtime, type RuntimeOptions } from '../runtime.js';

/**
 * What the API tests share: a server built on a test database, with a mailer that
 * keeps its mail, and requests made in process through Hono's `app.request`.
 * Nothing here is used when Turnkeel runs.
 */

/** The address the test server believes it is reached at. */
export const SERVER_URL = 'http://localhost:4400';
export const LOCAL_URL = 'http://127.0.0.1:4400';

/**
 * The header a test names its client address in. A request made in process has no
 * socket, so the test server reads the address from here. Unless a test sets it,
 * every request comes from an address of its own, and the limits on sign-in requests
 * per address stay out of the way of tests that are not about them.
 */
export const TEST_CLIENT_ADDRESS_HEADER = 'x-test-client-address';

let clientAddresses = 0;

/** An address no other request of this test run has used. */
function freshClientAddress(): string {
  clientAddresses += 1;
  return `10.${(clientAddresses >> 16) & 255}.${(clientAddresses >> 8) & 255}.${clientAddresses & 255}`;
}

/** A signed-in person, or the local owner: the Cookie header their requests carry. */
export interface Session {
  cookie: string;
  email: string;
}

export interface RequestOptions {
  as?: Session | undefined;
  json?: unknown;
  /** A body sent as it is, for a request whose body is not JSON. */
  rawBody?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface TestServer {
  readonly engine: DatabaseEngine;
  readonly test: TestDatabase;
  readonly runtime: Runtime;
  readonly config: Config;
  /** Every mail the server sent, oldest first. */
  readonly mail: MailMessage[];
  /** Every line the server logged. */
  readonly log: string[];
  /** The address requests are made to. */
  readonly base: string;
  request(method: string, path: string, options?: RequestOptions): Promise<Response>;
  get(path: string, as?: Session): Promise<Response>;
  post(
    path: string,
    json: unknown,
    as?: Session,
    headers?: Record<string, string>,
  ): Promise<Response>;
  patch(path: string, json: unknown, as?: Session): Promise<Response>;
  put(path: string, json: unknown, as?: Session): Promise<Response>;
  delete(path: string, as?: Session): Promise<Response>;
  /** Signs a person in with a magic link, the way a browser does: ask, read the mail, open the link. */
  signIn(email: string, name?: string): Promise<Session>;
  /** Asks for a magic link and returns the answer and the mail that went out, if one did. */
  askForLink(
    email: string,
    name?: string,
  ): Promise<{ response: Response; mail: MailMessage | undefined }>;
  /** Invites `email`, signs them in and accepts: the whole path of an invitation. Returns their session. */
  join(
    inviter: Session,
    workspace: string,
    email: string,
    role: Role,
    options?: { projectId?: string; handle?: string; name?: string },
  ): Promise<Session>;
  /** Local mode: exchanges a fresh one-time URL for the local session. */
  localSession(): Promise<Session>;
  stop(): Promise<void>;
}

export interface TestServerOptions {
  mode?: 'server' | 'local';
  env?: Environment;
  runtime?: Partial<RuntimeOptions>;
  /** A mailer that fails, to see what the server does then. */
  mailer?: Mailer;
  /**
   * Local mode: what the first run makes. `empty` (the default) is the workspace "My
   * workspace" that the local owner then makes through the API, which most tests work in;
   * `none` makes nothing, as `turnkeel` with no flag starts; `demo` is `turnkeel --demo`,
   * which loads the demo workspace.
   */
  firstRun?: 'empty' | 'none' | 'demo';
  /**
   * A second server on the database of another test server, which stands for a second
   * server process. Stopping this one leaves the database to the first.
   */
  sharing?: TestServer;
}

/** The link in a mail the server sent. */
export function linkIn(mail: MailMessage): string {
  const link = /https?:\/\/\S+/.exec(
    mail.text.split('\n').find((line) => /^https?:\/\//.test(line)) ?? '',
  );
  if (!link) throw new Error(`No link in the mail to ${mail.to}.`);
  return link[0];
}

/** The token of an invitation link. */
export function tokenIn(mail: MailMessage): string {
  const token = new URL(linkIn(mail)).searchParams.get('token');
  if (!token) throw new Error(`No token in the mail to ${mail.to}.`);
  return token;
}

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ');
}

export async function createTestServer(
  engine: DatabaseEngine,
  options: TestServerOptions = {},
): Promise<TestServer> {
  const mode = options.mode ?? 'server';
  const test = options.sharing?.test ?? (await createTestDatabase(engine));
  const config = loadConfig({
    ...(mode === 'server'
      ? {
          TURNKEEL_PUBLIC_URL: SERVER_URL,
          TURNKEEL_AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
        }
      : {}),
    TURNKEEL_DATA_DIR: '/nonexistent/turnkeel-test',
    // `demo` is `turnkeel --demo`; `none` leaves TURNKEEL_DEMO unset, the default.
    ...(mode === 'local' && options.firstRun !== 'none'
      ? { TURNKEEL_DEMO: options.firstRun === 'demo' ? 'true' : 'false' }
      : {}),
    ...options.env,
  });
  const base = mode === 'server' ? SERVER_URL : LOCAL_URL;
  const mail: MailMessage[] = [];
  const logger = memoryLogger();
  const mailer: Mailer = options.mailer ?? {
    kind: 'smtp',
    send(message) {
      mail.push(message);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };

  const filesDir = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-files-'));
  let runtime: Runtime;
  try {
    runtime = await createRuntime({
      filesDir,
      secretsDir: filesDir,
      config,
      database: test.handle,
      mailer,
      logger,
      jobs: false,
      webDir: null,
      clientAddress: (c) => c.req.header(TEST_CLIENT_ADDRESS_HEADER) ?? null,
      // The tests sign the same few people in again and again within seconds, which
      // no person does. `auth/limits.test.ts` runs with the limit as it is shipped.
      signInLinkLimit: { max: 1000, minutes: 10 },
      ...options.runtime,
    });
  } catch (error) {
    if (!options.sharing) await test.destroy();
    throw error;
  }
  // As `startServer` does once the port is bound.
  try {
    await runtime.loadDemo();
  } catch (error) {
    await runtime.stop();
    if (!options.sharing) await test.destroy();
    throw error;
  }

  const request: TestServer['request'] = (method, path, requestOptions = {}) => {
    const headers: Record<string, string> = {
      [TEST_CLIENT_ADDRESS_HEADER]: freshClientAddress(),
      ...requestOptions.headers,
    };
    if (requestOptions.as) headers.cookie = requestOptions.as.cookie;
    let body: string | undefined = requestOptions.rawBody;
    if (requestOptions.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(requestOptions.json);
    }
    return Promise.resolve(
      runtime.app.request(new URL(path, base).toString(), {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        ...(requestOptions.signal ? { signal: requestOptions.signal } : {}),
      }),
    );
  };

  const askForLink: TestServer['askForLink'] = async (email, name) => {
    const before = mail.length;
    const response = await request('POST', '/api/auth/sign-in/magic-link', {
      json: { email, callbackURL: '/', ...(name === undefined ? {} : { name }) },
      headers: { origin: SERVER_URL },
    });
    return {
      response,
      mail: mail
        .slice(before)
        .find((message) => message.to === email.toLowerCase() || message.to === email),
    };
  };

  const signIn: TestServer['signIn'] = async (email, name) => {
    const asked = await askForLink(email, name);
    expect(asked.response.status).toBe(200);
    if (!asked.mail) throw new Error(`No sign-in mail went to ${email}.`);
    const link = new URL(linkIn(asked.mail));
    const opened = await request('GET', `${link.pathname}${link.search}`);
    expect(opened.status).toBe(302);
    const cookie = cookiesOf(opened);
    if (!cookie.includes('session_token')) {
      throw new Error(`The link did not sign ${email} in: ${opened.headers.get('location') ?? ''}`);
    }
    return { cookie, email };
  };

  const localSession: TestServer['localSession'] = async () => {
    const url = new URL(runtime.newOneTimeUrl());
    const response = await request('GET', `${url.pathname}${url.search}`);
    expect(response.status).toBe(302);
    return { cookie: cookiesOf(response), email: '' };
  };

  // The workspace most local-mode tests work in, made as the welcome page makes it.
  if (
    mode === 'local' &&
    (options.firstRun ?? 'empty') === 'empty' &&
    !options.sharing &&
    (await countWorkspaces(test.db, { includeDeleted: true })) === 0
  ) {
    const made = await request('POST', '/api/v1/workspaces', {
      as: await localSession(),
      json: { name: 'My workspace', slug: 'my-workspace', handle: 'owner' },
    });
    expect(made.status).toBe(201);
  }

  return {
    engine,
    test,
    runtime,
    config,
    mail,
    log: logger.lines,
    base,
    request,
    get: (path, as) => request('GET', path, { as }),
    post: (path, json, as, headers) =>
      request('POST', path, { json, as, ...(headers ? { headers } : {}) }),
    patch: (path, json, as) => request('PATCH', path, { json, as }),
    put: (path, json, as) => request('PUT', path, { json, as }),
    delete: (path, as) => request('DELETE', path, { as }),
    askForLink,
    signIn,

    async join(inviter, workspace, email, role, joinOptions = {}) {
      const before = mail.length;
      const invited = await request('POST', `/api/v1/workspaces/${workspace}/invitations`, {
        as: inviter,
        json: {
          email,
          role,
          ...(joinOptions.projectId === undefined ? {} : { projectId: joinOptions.projectId }),
        },
      });
      expect(invited.status).toBe(201);
      const invitation = mail.slice(before).find((message) => message.to === email.toLowerCase());
      if (!invitation) throw new Error(`No invitation mail went to ${email}.`);
      const session = await signIn(email, joinOptions.name);
      const accepted = await request('POST', '/api/v1/invitations/accept', {
        as: session,
        json: {
          token: tokenIn(invitation),
          ...(joinOptions.handle === undefined ? {} : { handle: joinOptions.handle }),
        },
      });
      expect(accepted.status).toBe(200);
      return session;
    },

    localSession,

    async stop() {
      await runtime.stop();
      rmSync(filesDir, { recursive: true, force: true });
      if (!options.sharing) await test.destroy();
    },
  };
}

/** Reads an error answer and checks that it has the spec's shape. */
export async function errorOf(response: Response): Promise<ErrorBody['error']> {
  const body = (await response.json()) as ErrorBody;
  expect(Object.keys(body)).toEqual(['error']);
  expect(typeof body.error.code).toBe('string');
  expect(typeof body.error.message).toBe('string');
  return body.error;
}

/** The body of an answer, typed by the caller. */
export async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** The events of a workspace, oldest first, read straight from the table. */
export async function eventsOf(t: TestServer, slug: string): Promise<Event[]> {
  const workspace = await findWorkspaceBySlug(t.test.db, slug, { includeDeleted: true });
  if (!workspace) throw new Error(`There is no workspace ${slug}.`);
  const repos = repositories(t.test.db, workspaceScope(workspace.id));
  return repos.events.listAfter(0, 10_000);
}

/** The people and places most API tests need. */
export interface World {
  /** The slug of the workspace the tests work in. */
  ws: 'acme';
  /** The slug of a second workspace, which only `owner` and `stranger` are in. */
  otherWs: 'globex';
  owner: Session;
  admin: Session;
  member: Session;
  reviewer: Session;
  viewer: Session;
  /** Holds only the Tester role in the project `app`: no workspace role and no handle. */
  tester: Session;
  /** Has an account, and is Admin of `globex`. Holds nothing in `acme`. */
  stranger: Session;
  /** The project `app` (key `APP`) and the project `web` (key `WEB`) of `acme`. */
  app: Project;
  web: Project;
  /** User ids by the name of the session. */
  ids: Record<'owner' | 'admin' | 'member' | 'reviewer' | 'viewer' | 'tester' | 'stranger', string>;
}

/** Builds the world through the API itself: first sign-in, workspaces, invitations, projects. */
export async function buildWorld(t: TestServer): Promise<World> {
  const owner = await t.signIn('olive@example.com', 'Olive Owner');
  expect(
    (await t.post('/api/v1/workspaces', { name: 'Acme', slug: 'acme', handle: 'olive' }, owner))
      .status,
  ).toBe(201);
  expect(
    (await t.post('/api/v1/workspaces', { name: 'Globex', slug: 'globex', handle: 'olive' }, owner))
      .status,
  ).toBe(201);
  // The world's two workspaces have every planning feature on, as every workspace had before
  // 14 Nov 2026, so the tests of planning find them; written without an event, so no
  // test counts it. What a new workspace starts with is tested where it is made.
  await t.test.db.execute(
    sql`update workspaces set planning = ${JSON.stringify(planningOn)}::jsonb where slug in ('acme', 'globex')`,
  );

  const createProject = async (name: string, key: string, slug: string) => {
    const response = await t.post('/api/v1/workspaces/acme/projects', { name, key, slug }, owner);
    expect(response.status).toBe(201);
    return bodyOf<Project>(response);
  };
  const app = await createProject('App', 'APP', 'app');
  const web = await createProject('Web', 'WEB', 'web');

  const admin = await t.join(owner, 'acme', 'adam@example.com', 'admin', { name: 'Adam Admin' });
  const member = await t.join(owner, 'acme', 'mia@example.com', 'member', { name: 'Mia Member' });
  const reviewer = await t.join(owner, 'acme', 'rex@example.com', 'reviewer', {
    name: 'Rex Reviewer',
  });
  const viewer = await t.join(owner, 'acme', 'vic@example.com', 'viewer', { name: 'Vic Viewer' });
  const tester = await t.join(owner, 'acme', 'tess@example.com', 'tester', {
    name: 'Tess Tester',
    projectId: app.id,
  });
  const stranger = await t.join(owner, 'globex', 'sam@example.com', 'admin', {
    name: 'Sam Stranger',
  });

  const sessions = { owner, admin, member, reviewer, viewer, tester, stranger };
  const ids = {} as World['ids'];
  for (const [name, session] of Object.entries(sessions)) {
    const user = await findUserByEmail(t.test.db, session.email);
    if (!user) throw new Error(`No account for ${session.email}.`);
    ids[name as keyof World['ids']] = user.id;
  }
  return { ws: 'acme', otherWs: 'globex', ...sessions, app, web, ids };
}

/** One block of a server-sent event stream: a message, or a comment line. */
export interface StreamBlock {
  id?: string;
  event?: string;
  data?: string;
  comment?: string;
}

/** How long a test waits for something to arrive on a stream. Generous, for a busy machine. */
const STREAM_WAIT_MS = 20_000;

/** What one read of a response body gives. */
interface StreamChunk {
  done: boolean;
  value?: Uint8Array | undefined;
}

/** An open stream, read block by block. */
export interface OpenStream {
  readonly response: Response;
  /** The next block. Throws when none arrives in time, or the stream has ended. */
  next(timeoutMs?: number): Promise<StreamBlock>;
  /** The next block that is a message, skipping comment lines. */
  nextMessage(timeoutMs?: number): Promise<StreamBlock>;
  /** Resolves with true when no message arrives within `ms`. Comment lines do not count. */
  quiet(ms: number): Promise<boolean>;
  /** Resolves when the server has ended the stream. */
  ended(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

/** Opens `GET /workspaces/:ws/stream` the way a browser's EventSource does. */
export async function openStream(
  t: TestServer,
  workspace: string,
  as: Session | undefined,
  options: { lastEventId?: string | number; query?: string } = {},
): Promise<OpenStream> {
  const controller = new AbortController();
  const response = await t.request(
    'GET',
    `/api/v1/workspaces/${workspace}/stream${options.query ?? ''}`,
    {
      as,
      signal: controller.signal,
      headers: {
        accept: 'text/event-stream',
        ...(options.lastEventId === undefined
          ? {}
          : { 'last-event-id': String(options.lastEventId) }),
      },
    },
  );
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  let pending: Promise<StreamChunk> | null = null;

  function takeBlock(): StreamBlock | null {
    const end = buffer.indexOf('\n\n');
    if (end === -1) return null;
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    const block: StreamBlock = {};
    for (const line of raw.split('\n')) {
      if (line.startsWith(':')) block.comment = line.slice(1).trim();
      else if (line.startsWith('id:')) block.id = line.slice(3).trim();
      else if (line.startsWith('event:')) block.event = line.slice(6).trim();
      else if (line.startsWith('data:')) block.data = (block.data ?? '') + line.slice(5).trim();
    }
    return block;
  }

  /** Reads until a block is there. Returns null on a timeout, and `'end'` when the stream is over. */
  async function read(timeoutMs: number): Promise<StreamBlock | null | 'end'> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const block = takeBlock();
      if (block) return block;
      if (done || !reader) return 'end';
      pending ??= reader.read() as Promise<StreamChunk>;
      const left = deadline - Date.now();
      if (left <= 0) return null;
      let timer: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        pending,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), left);
        }),
      ]).catch((): StreamChunk => ({ done: true }));
      clearTimeout(timer);
      if (result === null) return null;
      pending = null;
      if (result.done) done = true;
      else buffer += decoder.decode(result.value, { stream: true });
    }
  }

  const next: OpenStream['next'] = async (timeoutMs = STREAM_WAIT_MS) => {
    const block = await read(timeoutMs);
    if (block === null) throw new Error('No block arrived on the stream in time.');
    if (block === 'end') throw new Error('The stream has ended.');
    return block;
  };

  return {
    response,
    next,
    async nextMessage(timeoutMs = STREAM_WAIT_MS) {
      for (;;) {
        const block = await next(timeoutMs);
        if (block.event !== undefined || block.data !== undefined) return block;
      }
    },
    async quiet(ms) {
      const deadline = Date.now() + ms;
      for (;;) {
        const block = await read(Math.max(0, deadline - Date.now()));
        if (block === null || block === 'end') return true;
        if (block.event !== undefined || block.data !== undefined) return false;
      }
    },
    async ended(timeoutMs = STREAM_WAIT_MS) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const block = await read(Math.max(1, deadline - Date.now()));
        if (block === 'end') return;
        if (block === null) throw new Error('The stream did not end in time.');
      }
    },
    async close() {
      controller.abort();
      await reader?.cancel().catch(() => {});
    },
  };
}

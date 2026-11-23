import { randomUUID } from 'node:crypto';
import { errorBody, errorStatuses, type ErrorBody } from '@turnkeel/protocol';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { LOCAL_SESSION_COOKIE, LOCAL_SESSION_MAX_AGE_SECONDS } from '../auth/local-session.js';
import { messages } from '../messages.js';
import { eventRoutes } from '../routes/events.js';
import { publicInvitationRoutes, workspaceRoutes } from '../routes/workspaces.js';
import type { AppEnv } from './context.js';
import type { AppDeps } from './deps.js';
import { HttpError, notFound } from './errors.js';
import { requireCaller, type PrincipalSources } from './principal.js';
import { createWebApp } from './static.js';

/** The header every answer carries. The events of the request carry the same id. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** The largest JSON body an API route reads. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * The largest body a sign-in route reads. Better Auth sets no limit of its own, and
 * its magic-link route stores what it is sent before anyone has signed in. A sign-in,
 * a profile change and a passkey are each far smaller than this.
 */
export const MAX_AUTH_BODY_BYTES = 64 * 1024;

/** The prefixes the server keeps for itself. Nothing under them is ever answered with the app shell. */
export const RESERVED_PREFIXES = ['/api', '/mcp', '/hooks', '/inbound', '/webhooks', '/changelog'];

function send(c: Context, body: ErrorBody): Response {
  return c.json(body, errorStatuses[body.error.code] as ContentfulStatusCode);
}

/**
 * The Hono app: every route of the server, on one port, in this order:
 *
 * 1. `/api/*` (`/api/auth/*` and `/api/v1/*`)
 * 2. `/mcp`  3. `/hooks/*`  4. `/inbound/*`  5. `/webhooks/*`  6. `/changelog/*`
 * 7. `/healthz`
 * 8. the files of the web build
 * 9. the app shell, for every other path
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const sources: PrincipalSources = {
    db: deps.db,
    auth: deps.auth,
    local: deps.local,
    agentTokens: deps.agentTokens,
  };

  // --- Every request -------------------------------------------------------------
  app.use('*', async (c, next) => {
    const requestId = randomUUID();
    c.set('requestId', requestId);
    await next();
    // Set on the finished answer, so that an error answer and an answer that Better
    // Auth made carry them too.
    c.res.headers.set(REQUEST_ID_HEADER, requestId);
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    // A route that asks for a stricter one keeps it: the public changelog's no-referrer.
    if (!c.res.headers.has('Referrer-Policy')) c.res.headers.set('Referrer-Policy', 'same-origin');
    c.res.headers.set('X-Frame-Options', 'DENY');
  });

  // R33: in local mode a request must name this server by a loopback name and its port.
  if (deps.local) {
    app.use('*', async (c, next) => {
      const named = [c.req.header('host'), new URL(c.req.url).host].filter(
        (host): host is string => host !== undefined,
      );
      if (named.some((host) => !deps.hostAllowed(host))) {
        throw new HttpError('forbidden', messages.errors.badHost, 'R33');
      }
      await next();
    });
  }

  app.onError((error, c) => {
    if (error instanceof HttpError) return send(c, error.body);
    if (error instanceof ConflictError) return send(c, errorBody(error.code, error.message));
    if (error instanceof HTTPException) {
      if (error.status === 413) {
        return send(c, errorBody('payload_too_large', error.message));
      }
      return error.getResponse();
    }
    deps.logger.error(
      messages.log.requestFailed(c.get('requestId'), c.req.method, new URL(c.req.url).pathname),
      // Never a query's parameters: one of them can be a token's hash.
      safeError(error),
    );
    return send(c, errorBody('internal', messages.errors.internal));
  });

  // --- 1. /api/* ------------------------------------------------------------------
  const { auth } = deps;
  if (auth) {
    app.use('/api/auth/*', bodyLimit({ maxSize: MAX_AUTH_BODY_BYTES }));
    // Better Auth counts sign-in requests per address. It is told the address here,
    // in a header that a client cannot set.
    app.all('/api/auth/*', (c) =>
      auth.handler(withClientAddress(c.req.raw, deps.clientAddress(c))),
    );
  }

  // The bytes of files kept in a folder: before the API's body limit.
  localFileRoutes(app, deps);

  const v1 = new Hono<AppEnv>();
  const isSync = (c: Context) =>
    c.req.method === 'POST' && SYNC_PATH.test(new URL(c.req.url).pathname);
  v1.use('*', except(isSync, bodyLimit({ maxSize: MAX_BODY_BYTES })));
  v1.use(
    '*',
    except((c: Context) => !isSync(c), bodyLimit({ maxSize: MAX_SYNC_BODY_BYTES })),
  );

  // A write from a browser must come from the app's own pages.
  v1.use('*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      const otherSite =
        (origin !== undefined && !deps.originAllowed(origin)) ||
        c.req.header('sec-fetch-site') === 'cross-site';
      if (otherSite) throw new HttpError('forbidden', messages.errors.otherSite);
    }
    await next();
  });

  // What needs no principal.
  v1.get('/server', (c) => c.json(deps.info));

  v1.get('/local/session', (c) => {
    // The one-time URL of local mode. With sign-in on there is no such thing.
    if (!deps.local) throw notFound();
    const cookie = deps.local.session.redeem(c.req.query('code') ?? '');
    if (cookie === null) throw new HttpError('unauthorized', messages.errors.localLinkUsed);
    setCookie(c, LOCAL_SESSION_COOKIE, cookie, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: LOCAL_SESSION_MAX_AGE_SECONDS,
    });
    return c.redirect('/', 302);
  });

  publicInvitationRoutes(v1, deps, sources);

  // Everything else needs a principal: a session cookie, the local session, or an agent token.
  v1.use('*', requireCaller(sources));
  v1.post('/local/demo-token', async (c) => {
    // The demo agent's token, once, for the local owner's first page after the first run.
    // Only its hash is stored; after this the value is gone from memory too.
    // It is never handed out for a demo that was removed.
    const caller = c.get('caller');
    if (!deps.local || caller.principal.kind !== 'user' || !caller.principal.local) {
      throw notFound();
    }
    const notice = deps.local.firstRun.take();
    if (notice === null) return c.json({ demo: null });
    const workspace = await findWorkspaceBySlug(deps.db, notice.workspace);
    const live = workspace !== null && workspace.deletedAt === null && workspace.demo;
    return c.json({ demo: live ? notice : null });
  });
  // "Look at the demo first" on the first screen: whether the demo can still load,
  // and loading it. Only for the local session, only while the install has no workspace
  // at all, a deleted one included, as at a first run with `--demo`.
  const localOwner = (c: Context<AppEnv>) => {
    const caller = c.get('caller');
    if (!deps.local || caller.principal.kind !== 'user' || !caller.principal.local) {
      throw notFound();
    }
    return deps.local;
  };
  v1.get('/local/demo', async (c) => {
    localOwner(c);
    return c.json({ canLoad: await isFirstRun(deps.db) });
  });
  v1.post('/local/demo', async (c) => {
    const local = localOwner(c);
    if (!(await local.loadDemo())) {
      throw new HttpError('conflict', messages.errors.demoNotLoaded);
    }
    return c.json({ workspace: DEMO_WORKSPACE, project: DEMO_PROJECT }, 201);
  });
  workspaceRoutes(v1, deps);
  agentRoutes(v1, deps);
  eventRoutes(v1, deps);
  cardRoutes(v1, deps);
  planningRoutes(v1, deps);
  sessionRoutes(v1, deps);
  fileRoutes(v1, deps);
  itemRoutes(v1, deps);
  postRoutes(v1, deps);
  releaseRoutes(v1, deps);
  moneyRoutes(v1, deps);
  assistantRoutes(v1, deps);
  launchRoutes(v1, deps);
  docRoutes(v1, deps);
  routineRoutes(v1, deps);

  app.route('/api/v1', v1);

  // --- 2. /mcp ---------------------------------------------------------------------------
  mcpRoutes(app, deps, sources);

  // --- 3. /hooks/* ----------------------------------------------------------------------
  hookRoutes(app, deps, sources);

  // --- 5. /webhooks/* ------------------------------------------------------------
  webhookRoutes(app, deps);

  // --- 6. /changelog/* ---------------------------------------------------------
  changelogRoutes(app, deps);

  // --- 2 to 6. Prefixes kept for the steps that build them --------------------------
  // Inbound mail is not built, and every other path
  // under /mcp, /hooks, /webhooks and /changelog is no route. They answer the one 404 and never the shell.
  for (const prefix of RESERVED_PREFIXES) {
    app.all(prefix, () => {
      throw notFound();
    });
    app.all(`${prefix}/*`, () => {
      throw notFound();
    });
  }

  // --- 7. /healthz ------------------------------------------------------------------
  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  // --- 8 and 9. The web build, then the shell -------------------------------------------
  const web = createWebApp(deps.webDir, () => [
    deps.files.storage.downloadOrigin(),
    ...deps.allowedOrigins(),
  ]);
  app.on(['GET', 'HEAD'], '*', async (c) => (await web.file(c)) ?? (await web.shell(c)));
  app.all('*', () => {
    throw notFound();
  });

  return app;
}

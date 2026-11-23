import { personPrincipal } from '@turnkeel/core';
import { findUserById, membershipsOf, toUser, type Database } from '@turnkeel/db';
import type { User } from '@turnkeel/protocol';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Auth } from '../auth/auth.js';
import { LOCAL_SESSION_COOKIE, type LocalSession } from '../auth/local-session.js';
import { messages } from '../messages.js';
import type { AppEnv, Caller } from './context.js';
import { unauthorized } from './errors.js';

/**
 * Turns a bearer token into an agent principal. `createRuntime` passes the one in
 * `auth/agent-tokens.ts`, which looks a token up by its hash.
 */
export interface AgentTokenVerifier {
  /** The caller a token stands for, or null when it is unknown, expired or revoked. */
  verify(token: string, request: Request): Promise<Caller | null>;
  /**
   * Whether the token of a caller still works. An open stream asks this from time to
   * time and ends when the answer is no. A person's caller is always yes.
   */
  stillValid(caller: Caller): Promise<boolean>;
}

/** A verifier that takes no token. Every bearer request is then answered with 401. */
export const noAgentTokens: AgentTokenVerifier = {
  verify: () => Promise.resolve(null),
  stillValid: (caller) => Promise.resolve(caller.principal.kind !== 'agent'),
};

/** Local mode without sign-in: the session of this start and the account of the local owner. */
export interface LocalMode {
  readonly session: LocalSession;
  readonly ownerUserId: string;
  /** The demo token of the first run, until the first page of the local session takes it. */
  readonly firstRun: FirstRunNotice;
  /**
   * Loads the demo workspace while the install has no workspace at all, a deleted one
   * included; false otherwise. "Look at the demo first" on the first screen.
   */
  readonly loadDemo: () => Promise<boolean>;
}

export interface PrincipalSources {
  db: Database;
  /** Sign-in, when it is on. */
  auth: Auth | null;
  /** Local mode, when sign-in is off. */
  local: LocalMode | null;
  agentTokens: AgentTokenVerifier;
}

const bearerPattern = /^Bearer\s+(.+)$/i;

/** Builds the caller for a person from their account and what they hold on the server. */
export async function personCaller(db: Database, user: User, local: boolean): Promise<Caller> {
  return {
    principal: personPrincipal({
      userId: user.id,
      local,
      memberships: await membershipsOf(db, user.id),
    }),
    actor: { kind: 'user', id: user.id, name: user.name },
    via: 'web',
    tokenId: null,
    user,
  };
}

/**
 * Who makes this request, or null:
 *
 * - A request with a bearer token is an agent's, or nobody's. It is never read as a
 *   person, whatever cookies it also carries.
 * - With sign-in on, a person is known by their session cookie.
 * - In local mode without sign-in, the local owner is known only by the local session
 *   cookie.
 */
export async function resolveCaller(c: Context, sources: PrincipalSources): Promise<Caller | null> {
  const authorization = c.req.header('authorization');
  if (authorization !== undefined) {
    const token = bearerPattern.exec(authorization.trim())?.[1];
    if (token === undefined) return null;
    return sources.agentTokens.verify(token, c.req.raw);
  }

  if (sources.local) {
    if (!sources.local.session.verify(getCookie(c, LOCAL_SESSION_COOKIE))) return null;
    const owner = await findUserById(sources.db, sources.local.ownerUserId);
    return owner ? personCaller(sources.db, toUser(owner), true) : null;
  }

  if (sources.auth) {
    const session = await sources.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return null;
    // Read from the table, so the account is the one the permission check will name.
    const account = await findUserById(sources.db, session.user.id);
    return account ? personCaller(sources.db, toUser(account), false) : null;
  }

  return null;
}

/** Puts the caller on the context, or answers 401 when the request has none. */
export function requireCaller(sources: PrincipalSources): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const caller = await resolveCaller(c, sources);
    if (!caller) {
      throw unauthorized(
        sources.local && c.req.header('authorization') === undefined
          ? messages.errors.unauthorizedLocal
          : messages.errors.unauthorized,
      );
    }
    c.set('caller', caller);
    await next();
  };
}

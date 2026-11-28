import { createHash, randomBytes } from 'node:crypto';
import { tokenUsable, type AgentPrincipal } from '@turnkeel/core';
import {
  findAgentTokenByHash,
  findAgentTokenById,
  repositories,
  workspaceScope,
  type AgentRow,
  type AgentTokenRow,
  type Database,
} from '@turnkeel/db';
import type { EventVia } from '@turnkeel/protocol';
import type { Caller } from '../http/context.js';
import type { AgentTokenVerifier } from '../http/principal.js';

/** Every agent token starts with this, so it is easy to recognise in a file or a log. */
export const AGENT_TOKEN_START = 'tk_';

/** How many characters of a token a person sees, to tell one from another: `tk_` and eight more. */
const PREFIX_LENGTH = 11;

/** A token is `tk_` and 43 characters of base64url: 32 random bytes. */
const tokenPattern = /^tk_[A-Za-z0-9_-]{43}$/;

/** The user agent the CLI sends. A bearer call with it is written `via: cli`. */
export const CLI_USER_AGENT = /^turnkeel\//i;

/** The SHA-256 of a token, which is all the database keeps of it. */
export function hashAgentToken(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** A new token: the value, shown once; the prefix a person sees; the hash that is stored. */
export function newAgentToken(): { value: string; prefix: string; hash: string } {
  const value = `${AGENT_TOKEN_START}${randomBytes(32).toString('base64url')}`;
  return { value, prefix: value.slice(0, PREFIX_LENGTH), hash: hashAgentToken(value) };
}

/** The channel of a bearer request: `mcp` and `hook` by path, `cli` by the CLI's user
 * agent, else `rest`. */
export function viaOf(request: Request): EventVia {
  const { pathname } = new URL(request.url);
  if (pathname === '/mcp' || pathname.startsWith('/mcp/')) return 'mcp';
  if (pathname.startsWith('/hooks/')) return 'hook';
  return CLI_USER_AGENT.test(request.headers.get('user-agent') ?? '') ? 'cli' : 'rest';
}

/**
 * Runs a lookup of the verifier. A query that fails is thrown again as an error that
 * carries no parameter of the query, because one of them is the token's hash:
 * whatever logs it upstream cannot write the hash into a log.
 */
async function lookup<T>(query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    throw safeError(error);
  }
}

/** The principal a token stands for. */
export function agentPrincipalOf(token: AgentTokenRow): AgentPrincipal {
  return {
    kind: 'agent',
    agentId: token.agentId,
    tokenId: token.id,
    workspaceId: token.workspaceId,
    scopes: token.scopes,
    projectIds: token.projectIds,
    workspaceWide: token.workspaceWide,
  };
}

function callerOf(token: AgentTokenRow, agent: AgentRow, via: EventVia): Caller {
  return {
    principal: agentPrincipalOf(token),
    actor: { kind: 'agent', id: agent.id, name: agent.name },
    via,
    tokenId: token.id,
    user: null,
  };
}

/**
 * How a bearer request becomes an agent.
 * The token is looked up by its hash. A token that is unknown, revoked or expired, of
 * an agent that is disabled, or of a workspace that is deleted gives no caller, which
 * is answered with 401. Each use is written to `lastUsedAt`, at most once a minute.
 */
export function createAgentTokenVerifier(db: Database): AgentTokenVerifier {
  return {
    async verify(value, request) {
      if (!tokenPattern.test(value)) return null;
      const found = await lookup(() => findAgentTokenByHash(db, hashAgentToken(value)));
      if (!found) return null;
      const now = new Date();
      if (!tokenUsable(found.token, found.agent, now)) return null;
      await lookup(() =>
        repositories(db, workspaceScope(found.workspace.id)).agentTokens.markUsed(
          found.token.id,
          now,
        ),
      );
      return callerOf(found.token, found.agent, viaOf(request));
    },

    async stillValid(caller) {
      if (caller.principal.kind !== 'agent') return true;
      const { tokenId } = caller.principal;
      const found = await lookup(() => findAgentTokenById(db, tokenId));
      return found !== null && tokenUsable(found.token, found.agent, new Date());
    },
  };
}

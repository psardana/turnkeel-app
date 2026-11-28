import {
  createAgentRequestSchema,
  createTokenRequestSchema,
  updateAgentRequestSchema,
  updateTokenRequestSchema,
} from '@turnkeel/protocol';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { contextOf, type AppDeps } from '../http/deps.js';
import { HttpError } from '../http/errors.js';
import { IDEMPOTENCY_HEADER, runKeyed } from '../http/idempotency.js';
import { parseBody, readJson } from '../http/validate.js';
import { messages } from '../messages.js';
import * as agents from '../services/agents.js';

/** Agents and their tokens. Handlers are thin: each calls one service function. */
export function agentRoutes(v1: Hono<AppEnv>, deps: AppDeps) {
  v1.get('/workspaces/:ws/agents', async (c) =>
    c.json(await agents.listAgents(contextOf(c, deps), c.req.param('ws'))),
  );

  v1.post('/workspaces/:ws/agents', async (c) => {
    const raw = await readJson(c);
    const body = parseBody(createAgentRequestSchema, raw);
    const check = (id: string) => agents.checkKeptCreateAgent(contextOf(c, deps), id);
    return runKeyed(c, deps.db, { status: 201, body: raw, check }, (keyed) =>
      agents.createAgent(contextOf(c, deps, keyed), c.req.param('ws'), body),
    );
  });

  v1.patch('/agents/:id', async (c) => {
    const body = parseBody(updateAgentRequestSchema, await readJson(c));
    return c.json(await agents.updateAgent(contextOf(c, deps), c.req.param('id'), body));
  });

  v1.get('/agents/:id/tokens', async (c) =>
    c.json(await agents.listTokens(contextOf(c, deps), c.req.param('id'))),
  );

  // The answer holds the token, which is shown once and kept nowhere, so it cannot be
  // kept for a repeat either: this POST takes no Idempotency-Key.
  v1.post('/agents/:id/tokens', async (c) => {
    if (c.req.header(IDEMPOTENCY_HEADER) !== undefined) {
      throw new HttpError('bad_request', messages.errors.tokenNoIdempotencyKey);
    }
    const body = parseBody(createTokenRequestSchema, await readJson(c));
    const answer = await agents.createToken(contextOf(c, deps), c.req.param('id'), body);
    c.header('Cache-Control', 'no-store');
    return c.json(answer, 201);
  });

  // The scopes of a token that already works, by an Owner.
  v1.patch('/tokens/:id', async (c) => {
    const body = parseBody(updateTokenRequestSchema, await readJson(c));
    return c.json(await agents.updateTokenScopes(contextOf(c, deps), c.req.param('id'), body));
  });

  v1.delete('/tokens/:id', async (c) =>
    c.json(await agents.revokeToken(contextOf(c, deps), c.req.param('id'))),
  );
}

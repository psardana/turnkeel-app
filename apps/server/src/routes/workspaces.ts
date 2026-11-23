import {
  acceptInvitationRequestSchema,
  createInvitationRequestSchema,
  createProjectRequestSchema,
  createWorkspaceRequestSchema,
  lookupInvitationRequestSchema,
  setProjectMemberRequestSchema,
  transferWorkspaceRequestSchema,
  updateMemberRequestSchema,
  updateProjectRequestSchema,
  updatePersonViewRequestSchema,
  updateWorkspaceRequestSchema,
} from '@turnkeel/protocol';
import type { Hono } from 'hono';
import type { AppEnv } from '../http/context.js';
import { contextOf, type AppDeps } from '../http/deps.js';
import { runKeyed } from '../http/idempotency.js';
import { resolveCaller, type PrincipalSources } from '../http/principal.js';
import { parseBody, readJson } from '../http/validate.js';
import * as invitations from '../services/invitations.js';
import * as members from '../services/members.js';
import * as projects from '../services/projects.js';
import * as workspaces from '../services/workspaces.js';

/**
 * The one route about invitations that needs no sign-in: the accept page asks what
 * the invitation is before it sends the person to sign in.
 */
export function publicInvitationRoutes(v1: Hono<AppEnv>, deps: AppDeps, sources: PrincipalSources) {
  v1.post('/invitations/lookup', async (c) => {
    const body = parseBody(lookupInvitationRequestSchema, await readJson(c));
    const caller = await resolveCaller(c, sources);
    return c.json(await invitations.lookupInvitation(deps, body.token, caller?.user ?? null));
  });
}

/** `GET /me`, `GET /home`, workspaces, members, invitations and projects. Handlers are
 * thin: each calls one service function. */
export function workspaceRoutes(v1: Hono<AppEnv>, deps: AppDeps) {
  v1.get('/me', async (c) => c.json(await workspaces.getMe(contextOf(c, deps))));
  // The home page across every workspace, a person's.
  v1.get('/home', async (c) => c.json(await homeOf(contextOf(c, deps))));

  // --- Workspaces --------------------------------------------------------------
  v1.get('/workspaces', async (c) => c.json(await workspaces.listWorkspaces(contextOf(c, deps))));

  v1.post('/workspaces', async (c) => {
    const raw = await readJson(c);
    const body = parseBody(createWorkspaceRequestSchema, raw);
    const check = (id: string) => workspaces.checkKeptInWorkspace(contextOf(c, deps), id);
    return runKeyed(c, deps.db, { status: 201, body: raw, check }, (keyed) =>
      workspaces.createWorkspaceFor(contextOf(c, deps, keyed), body),
    );
  });

  v1.get('/workspaces/:ws', async (c) =>
    c.json(await workspaces.getWorkspace(contextOf(c, deps), c.req.param('ws'))),
  );

  v1.patch('/workspaces/:ws', async (c) => {
    const body = parseBody(updateWorkspaceRequestSchema, await readJson(c));
    return c.json(await workspaces.updateWorkspace(contextOf(c, deps), c.req.param('ws'), body));
  });

  v1.delete('/workspaces/:ws', async (c) => {
    const deleted = await workspaces.deleteWorkspace(contextOf(c, deps), c.req.param('ws'));
    // Remove demo data: the token the first page has not taken goes with the demo.
    if (deleted.demo) deps.local?.firstRun.clear();
    return c.json(deleted);
  });

  v1.post('/workspaces/:ws/transfer', async (c) => {
    const raw = await readJson(c);
    const body = parseBody(transferWorkspaceRequestSchema, raw);
    const check = (id: string) => workspaces.checkKeptInWorkspace(contextOf(c, deps), id);
    return runKeyed(c, deps.db, { status: 200, body: raw, check }, (keyed) =>
      workspaces.transferWorkspace(contextOf(c, deps, keyed), c.req.param('ws'), body),
    );
  });

  // --- Onboarding and settings ---------------------------------
  v1.post('/workspaces/:ws/tabs/keep', async (c) =>
    c.json(await onboarding.keepTabs(contextOf(c, deps), c.req.param('ws'))),
  );

  v1.patch('/workspaces/:ws/me/view', async (c) => {
    const body = parseBody(updatePersonViewRequestSchema, await readJson(c));
    return c.json(await onboarding.updatePersonView(contextOf(c, deps), c.req.param('ws'), body));
  });

  v1.get('/workspaces/:ws/start', async (c) =>
    c.json(
      await onboarding.getStart(
        contextOf(c, deps),
        deps.assistant,
        c.req.param('ws'),
        c.req.query('project'),
      ),
    ),
  );

  // --- Members -----------------------------------------------------------------
  v1.get('/workspaces/:ws/members', async (c) =>
    c.json(await members.listMembers(contextOf(c, deps), c.req.param('ws'))),
  );

  v1.patch('/workspaces/:ws/members/:userId', async (c) => {
    const body = parseBody(updateMemberRequestSchema, await readJson(c));
    return c.json(
      await members.updateMember(
        contextOf(c, deps),
        c.req.param('ws'),
        c.req.param('userId'),
        body,
      ),
    );
  });

  v1.delete('/workspaces/:ws/members/:userId', async (c) => {
    await members.removeMember(contextOf(c, deps), c.req.param('ws'), c.req.param('userId'));
    return c.body(null, 204);
  });

  v1.get('/workspaces/:ws/projects/:p/members/:userId', async (c) =>
    c.json(
      await members.getProjectMember(
        contextOf(c, deps),
        c.req.param('ws'),
        c.req.param('p'),
        c.req.param('userId'),
      ),
    ),
  );

  v1.put('/workspaces/:ws/projects/:p/members/:userId', async (c) => {
    const body = parseBody(setProjectMemberRequestSchema, await readJson(c));
    return c.json(
      await members.setProjectMember(
        contextOf(c, deps),
        c.req.param('ws'),
        c.req.param('p'),
        c.req.param('userId'),
        body,
      ),
    );
  });

  v1.delete('/workspaces/:ws/projects/:p/members/:userId', async (c) => {
    await members.removeProjectMember(
      contextOf(c, deps),
      c.req.param('ws'),
      c.req.param('p'),
      c.req.param('userId'),
    );
    return c.body(null, 204);
  });

  // --- Invitations ---------------------------------------------------------------
  v1.get('/workspaces/:ws/invitations', async (c) =>
    c.json(await invitations.listInvitations(contextOf(c, deps), c.req.param('ws'))),
  );

  v1.post('/workspaces/:ws/invitations', async (c) => {
    const raw = await readJson(c);
    const body = parseBody(createInvitationRequestSchema, raw);
    const check = (id: string) => invitations.checkKeptInvitation(contextOf(c, deps), id, body);
    return runKeyed(c, deps.db, { status: 201, body: raw, check }, (keyed) =>
      invitations.createInvitation(contextOf(c, deps, keyed), c.req.param('ws'), body),
    );
  });

  v1.delete('/invitations/:id', async (c) =>
    c.json(await invitations.revokeInvitation(contextOf(c, deps), c.req.param('id'))),
  );

  v1.post('/invitations/accept', async (c) => {
    const raw = await readJson(c);
    const body = parseBody(acceptInvitationRequestSchema, raw);
    const check = (id: string) => workspaces.checkKeptInWorkspace(contextOf(c, deps), id);
    return runKeyed(c, deps.db, { status: 200, body: raw, check }, (keyed) =>
      invitations.acceptInvitation(contextOf(c, deps, keyed), body),
    );
  });

  // --- Projects ------------------------------------------------------------------
  v1.get('/workspaces/:ws/projects', async (c) =>
    c.json(
      await projects.listProjects(contextOf(c, deps), c.req.param('ws'), {
        includeArchived: c.req.query('archived') === 'true',
      }),
    ),
  );

  v1.post('/workspaces/:ws/projects', async (c) => {
    const raw = await readJson(c);
    const body = parseBody(createProjectRequestSchema, raw);
    const check = (id: string) => projects.checkKeptCreateProject(contextOf(c, deps), id);
    return runKeyed(c, deps.db, { status: 201, body: raw, check }, (keyed) =>
      projects.createProject(contextOf(c, deps, keyed), c.req.param('ws'), body),
    );
  });

  v1.get('/workspaces/:ws/projects/:p', async (c) =>
    c.json(await projects.getProject(contextOf(c, deps), c.req.param('ws'), c.req.param('p'))),
  );

  v1.patch('/workspaces/:ws/projects/:p', async (c) => {
    const body = parseBody(updateProjectRequestSchema, await readJson(c));
    return c.json(
      await projects.updateProject(contextOf(c, deps), c.req.param('ws'), c.req.param('p'), body),
    );
  });

  v1.post('/workspaces/:ws/projects/:p/archive', async (c) => {
    const raw = await readJson(c);
    const check = (id: string) =>
      projects.checkKeptArchiveProject(contextOf(c, deps), id, c.req.param('p'));
    return runKeyed(c, deps.db, { status: 200, body: raw, check }, (keyed) =>
      projects.archiveProject(contextOf(c, deps, keyed), c.req.param('ws'), c.req.param('p')),
    );
  });
}

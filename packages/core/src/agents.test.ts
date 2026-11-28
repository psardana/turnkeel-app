import {
  agentScopes,
  filePurposes,
  optInScopes,
  standardScopes,
  type AgentScope,
} from '@turnkeel/protocol';
import { describe, expect, it } from 'vitest';
import {
  actionsOfScopes,
  anyReadScopeActions,
  can,
  canReach,
  humanOnlyActions,
  humanOnlyRule,
  isHumanOnly,
  noScopeReads,
  readScopes,
  scopeTable,
  tableActions,
  tokenUsable,
  uploadScopes,
  type Action,
  isOnWordAction,
  onWordActions,
  onWordRule,
  type OnWordAction,
  personPrincipal,
  roleTable,
  type AgentPrincipal,
  type Decision,
  type PersonPrincipal,
  type TableAction,
} from './index.js';

const ws = '11111111-1111-4111-8111-111111111111';
const otherWs = '22222222-2222-4222-8222-222222222222';
const p1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const p2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const agentId = '55555555-5555-4555-8555-555555555555';
const otherAgentId = '77777777-7777-4777-8777-777777777777';

function agent(
  scopes: readonly AgentScope[],
  options: { projectIds?: string[]; workspaceWide?: boolean } = {},
): AgentPrincipal {
  return {
    kind: 'agent',
    agentId,
    tokenId: '66666666-6666-4666-8666-666666666666',
    workspaceId: ws,
    scopes,
    projectIds: options.projectIds ?? [p1],
    workspaceWide: options.workspaceWide ?? false,
  };
}

/** A person who decides decisions in `projectId` (a Reviewer there), or in the whole workspace (an Admin). */
function deciderOf(projectId: string | null): PersonPrincipal {
  return personPrincipal({
    userId: '99999999-9999-4999-8999-999999999999',
    memberships: [
      projectId === null
        ? { workspaceId: ws, role: 'admin', projectRoles: {} }
        : { workspaceId: ws, role: null, projectRoles: { [projectId]: 'reviewer' } },
    ],
  });
}

function ask(
  principal: AgentPrincipal,
  action: Action,
  resource: Record<string, unknown> = {},
): Decision {
  const check = can as (p: AgentPrincipal, a: Action, r: object) => Decision;
  return check(principal, action, { workspaceId: ws, projectId: p1, ...resource });
}

const levelOf = (action: TableAction) =>
  [
    'member.read',
    'agent.read',
    'connector.read',
    'member.manage',
    'agent.manage',
    'connector.manage',
    'project.create',
    'events.export',
    'workspace.update',
    'workspace.delete',
    'workspace.transfer',
    'assistant.manage',
  ].includes(action)
    ? 'workspace'
    : 'project';

describe('every action is in exactly one of three sets', () => {
  const byScope = new Set<string>([...Object.values(scopeTable).flat(), ...anyReadScopeActions]);
  const humanOnly = new Set<string>(humanOnlyActions);
  const noScope = new Set<string>(noScopeReads);

  it('the three sets cover the table of 6.2', () => {
    for (const action of tableActions) {
      const sets = [byScope.has(action), humanOnly.has(action), noScope.has(action)];
      expect(sets.filter(Boolean), action).toHaveLength(1);
    }
  });

  it('no set names an action the table does not have', () => {
    for (const action of [...byScope, ...humanOnly, ...noScope]) {
      expect(tableActions).toContain(action);
    }
  });

  it('has the human-only list of 6.3, with project.* and workspace.* written out', () => {
    // 43 until the second set of opt-in scopes took 15 off it; routines
    // added routine.manage, and epics epic.accept.
    expect(humanOnlyActions).toHaveLength(30);
    expect(new Set(humanOnlyActions).size).toBe(30);
    expect(humanOnlyActions).toEqual(
      expect.arrayContaining([
        'assistant.draft',
        'assistant.manage',
        'project.create',
        'project.update',
        'project.archive',
        'workspace.update',
        'workspace.delete',
        'workspace.transfer',
      ]),
    );
  });

  it('gives people.read and file.read with any read scope, and only then', () => {
    for (const scope of readScopes) {
      expect(actionsOfScopes([scope]).has('people.read'), scope).toBe(true);
      expect(actionsOfScopes([scope]).has('file.read'), scope).toBe(true);
    }
    expect(actionsOfScopes(['cards:write', 'sessions:write']).has('people.read')).toBe(false);
  });

  it('knows ten read scopes', () => {
    expect(readScopes).toHaveLength(10);
  });
});

describe('every human-only action is refused to every agent token, whatever its scopes', () => {
  const tokens: [string, AgentPrincipal][] = [
    ['every scope, both projects, workspace-wide', everything],
    ...agentScopes.map((scope): [string, AgentPrincipal] => [scope, agent([scope])]),
    ['no scope', agent([])],
  ];

  describe.each(tokens)('a token with %s', (_name, token) => {
    it.each(humanOnlyActions)('is refused %s', (action) => {
      const projectId = levelOf(action) === 'workspace' ? null : p1;
      for (const where of projectId === null ? [null] : [p1, null]) {
        let decision: Decision;
        try {
          decision = ask(token, action, { projectId: where, purpose: 'receipt' });
        } catch {
          // A project-level action asked without a project is a mistake in the caller.
          continue;
        }
        expect(decision).toMatchObject({
          allowed: false,
          kind: 'forbidden',
          rule: humanOnlyRule(action),
        });
      }
    });
  });

  it('the denial names the rule that says so for that action', () => {
    expect(humanOnlyRule('decision.decide')).toBe('R15');
    expect(humanOnlyRule('agent.manage')).toBe('R20');
    expect(humanOnlyRule('build.archive')).toBe('R39');
    expect(humanOnlyRule('asset.archive')).toBe('R39');
    expect(humanOnlyRule('link.write')).toBe('R56');
    expect(humanOnlyRule('assistant.draft')).toBe('R61');
    expect(humanOnlyRule('session.dismiss')).toBe('R13');
    expect(isHumanOnly('card.create')).toBe(false);
    // The second set of opt-in scopes took these off the list.
    for (const action of [
      'asset.decide',
      'asset.note',
      'post.approve',
      'post.send',
      'post.skip',
      'release.publish',
      'step.note',
      'step.mark',
      'card.archive',
      'inbox.triage',
      'gate.pass',
      'gate.confirm_change',
      'listing.mark',
      'money.write',
      'spend.commit',
    ] as const) {
      expect(isHumanOnly(action), action).toBe(false);
    }
  });

  it('an agent cannot create a workspace', () => {
    expect(ask(everything, 'workspace.create', { openSignup: true })).toMatchObject({
      allowed: false,
      rule: 'R44',
    });
  });

  it('an agent cannot change a handle, which belongs to a person', () => {
    expect(ask(everything, 'member.handle', { userId: agentId })).toMatchObject({
      allowed: false,
      kind: 'forbidden',
      rule: 'R13',
    });
  });
});

describe('an agent can do an action only if a scope on its token allows it', () => {
  const byScope = Object.entries(scopeTable).flatMap(([scope, actions]) =>
    actions.filter((action) => action !== 'file.upload').map((action) => ({ scope, action })),
  );

  // decision.relay is asked with what it always carries: the status and the person.
  // An action of the second set is asked on the word of an Owner, who may take it.
  const fieldsOf = (action: string) =>
    action === 'decision.relay'
      ? { status: 'accepted', onWordOf: deciderOf(p1) }
      : isOnWordAction(action as TableAction)
        ? { onWordOf: ownerOf(), pass: 'human' }
        : {};

  it.each(byScope)('$scope allows $action', ({ scope, action }) => {
    expect(ask(agent([scope as AgentScope]), action, fieldsOf(action))).toEqual({
      allowed: true,
    });
  });

  it.each(byScope)('a token without $scope is refused $action', ({ scope, action }) => {
    const others = agentScopes.filter(
      (other) => other !== scope && !scopeTable[other].includes(action),
    );
    const decision = ask(agent(others, { projectIds: [p1] }), action, {
      // An agent's own session, a decision recorded as proposed.
      agentId,
      ...fieldsOf(action),
    });
    // An action of the second set of opt-in scopes keeps the rule that kept it a
    // person's; every other action is refused with R12.
    const onWord = isOnWordAction(action) && action !== 'decision.relay';
    expect(decision).toMatchObject({
      allowed: false,
      kind: 'forbidden',
      rule: onWord ? onWordRule(action as OnWordAction) : 'R12',
    });
    if (!decision.allowed && !onWord)
      expect(decision.reason).toBe(`This token has no scope that allows ${action}.`);
  });

  it.each(noScopeReads)('no scope reads %s, not even every scope at once', (action) => {
    expect(ask(everything, action)).toMatchObject({ allowed: false, rule: 'R12' });
  });

  it('a scope name the server does not know gives nothing', () => {
    expect(ask(agent(['cards:decide' as AgentScope]), 'card.read').allowed).toBe(false);
  });

  it('people.read with any read scope, and not without one', () => {
    expect(ask(agent(['money:read']), 'people.read')).toEqual({ allowed: true });
    expect(ask(agent(['cards:write']), 'people.read')).toMatchObject({ rule: 'R12' });
  });
});

describe('an agent acts only in the projects on its token', () => {
  it('a token of another workspace learns nothing about this one', () => {
    const elsewhere = { ...everything, workspaceId: otherWs };
    for (const action of ['workspace.read', 'project.read', 'card.read', 'card.create'] as const) {
      expect(ask(elsewhere, action)).toMatchObject({ allowed: false, kind: 'not_found' });
    }
  });

  it('the token reaches its workspace and the projects on it, and nothing else', () => {
    const token = agent(['cards:read']);
    expect(canReach(token, { workspaceId: ws })).toEqual({ allowed: true });
    expect(canReach(token, { workspaceId: ws, projectId: p1 })).toEqual({ allowed: true });
    expect(canReach(token, { workspaceId: ws, projectId: p2 })).toMatchObject({
      allowed: false,
      kind: 'not_found',
      rule: 'R11',
    });
    expect(canReach(token, { workspaceId: otherWs })).toMatchObject({
      allowed: false,
      kind: 'not_found',
      rule: 'R1',
    });
  });

  it('no scope reads the workspace or a project as such, whatever the token holds', () => {
    for (const token of [agent(['cards:read']), everything]) {
      expect(ask(token, 'workspace.read', { projectId: undefined })).toMatchObject({
        allowed: false,
        kind: 'forbidden',
        rule: 'R12',
      });
      expect(ask(token, 'project.read', { projectId: p1 })).toMatchObject({
        allowed: false,
        kind: 'forbidden',
        rule: 'R12',
      });
    }
    // Out of reach is still the one 404, never a 403 that says the project exists.
    expect(ask(agent(['cards:read']), 'project.read', { projectId: p2 })).toMatchObject({
      allowed: false,
      kind: 'not_found',
    });
  });

  it('a project that is not on the token is the one 404, for reads and writes', () => {
    const token = agent(['cards:read', 'cards:write']);
    expect(ask(token, 'card.read', { projectId: p2 })).toMatchObject({ kind: 'not_found' });
    expect(ask(token, 'card.create', { projectId: p2 })).toMatchObject({ kind: 'not_found' });
    expect(ask(token, 'card.create', { projectId: p1 })).toEqual({ allowed: true });
  });

  it('an object with no project needs workspaceWide', () => {
    const narrow = agent(['decisions:read', 'decisions:propose', 'links:write']);
    expect(ask(narrow, 'decision.read', { projectId: null })).toMatchObject({
      allowed: false,
      kind: 'not_found',
    });
    expect(ask(narrow, 'decision.propose', { projectId: null })).toMatchObject({
      allowed: false,
      kind: 'forbidden',
      rule: 'R11',
    });
    expect(ask(narrow, 'link.add', { projectId: null })).toMatchObject({ rule: 'R11' });

    const wide = agent(['decisions:read', 'decisions:propose', 'links:write'], {
      workspaceWide: true,
    });
    expect(ask(wide, 'decision.read', { projectId: null })).toEqual({ allowed: true });
    expect(ask(wide, 'decision.propose', { projectId: null })).toEqual({ allowed: true });
    expect(ask(wide, 'link.add', { projectId: null })).toEqual({ allowed: true });
  });

  it('workspaceWide reaches no project that is not on the token', () => {
    const wide = agent(['cards:read'], { workspaceWide: true });
    expect(ask(wide, 'card.read', { projectId: p2 })).toMatchObject({ kind: 'not_found' });
  });

  it('a session belongs to its agent, with no project and no workspaceWide', () => {
    const hooks = agent(['sessions:write']);
    expect(ask(hooks, 'session.write', { projectId: null, agentId })).toEqual({ allowed: true });
    expect(ask(hooks, 'session.write', { projectId: p2, agentId })).toEqual({ allowed: true });
    expect(ask(hooks, 'session.write', { projectId: null })).toEqual({ allowed: true });
    // The sessions of another agent are not this token's to know about.
    expect(ask(hooks, 'session.write', { agentId: otherAgentId })).toMatchObject({
      kind: 'not_found',
    });
    // Still a scope: without sessions:write, R12.
    expect(ask(agent(['cards:write']), 'session.write', { agentId })).toMatchObject({
      rule: 'R12',
    });
  });

  it('an item with no project reaches the token only with workspaceWide, and never a session', () => {
    expect(ask(everything, 'session.read', { projectId: null })).toMatchObject({ rule: 'R12' });
  });
});

describe('an agent acts only through a token that still works', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  const fine = { revokedAt: null, expiresAt: null };
  const enabled = { disabledAt: null };

  it('a token that is not revoked, not expired, of an agent that is not disabled works', () => {
    expect(tokenUsable(fine, enabled, now)).toBe(true);
    expect(tokenUsable({ ...fine, expiresAt: '2026-11-12T00:00:00Z' }, enabled, now)).toBe(true);
  });

  it('a revoked token does not work', () => {
    expect(tokenUsable({ ...fine, revokedAt: '2026-11-10T00:00:00Z' }, enabled, now)).toBe(false);
  });

  it('a token stops working at the moment it expires', () => {
    expect(tokenUsable({ ...fine, expiresAt: now }, enabled, now)).toBe(false);
    expect(tokenUsable({ ...fine, expiresAt: new Date(now.getTime() - 1) }, enabled, now)).toBe(
      false,
    );
  });

  it('a token of a disabled agent does not work', () => {
    expect(tokenUsable(fine, { disabledAt: now }, now)).toBe(false);
  });
});

describe('the rules an agent meets on its way, by number', () => {
  it('an agent cannot approve or reject an asset, or write a reviewer’s note', () => {
    for (const action of ['asset.decide', 'asset.note'] as const) {
      expect(ask(everything, action)).toMatchObject({ allowed: false, rule: 'R14' });
    }
    expect(ask(agent(['assets:propose']), 'asset.propose')).toEqual({ allowed: true });
  });

  it('an agent records a decision as proposed and nothing else', () => {
    const token = agent(['decisions:propose'], { workspaceWide: true });
    expect(ask(token, 'decision.propose')).toEqual({ allowed: true });
    expect(ask(token, 'decision.propose', { status: 'proposed' })).toEqual({ allowed: true });
    for (const status of ['accepted', 'rejected', 'parked', 'done'] as const) {
      expect(ask(token, 'decision.propose', { status })).toMatchObject({ rule: 'R15' });
    }
    expect(ask(everything, 'decision.decide')).toMatchObject({ rule: 'R15' });
  });

  it('an agent cannot say that a decision supersedes another', () => {
    expect(
      ask(agent(['decisions:propose']), 'decision.propose', { supersedes: true }),
    ).toMatchObject({ allowed: false, kind: 'forbidden', rule: 'R15' });
  });

  it('an agent with gates:check adds evidence to every kind of gate, and can never pass one', () => {
    const checker = agent(['gates:check']);
    for (const pass of ['human', 'agent', 'check'] as const) {
      expect(ask(checker, 'gate.check', { pass })).toEqual({ allowed: true });
      expect(ask(everything, 'gate.pass', { pass })).toMatchObject({ allowed: false, rule: 'R13' });
    }
    expect(ask(everything, 'gate.confirm_change')).toMatchObject({ allowed: false, rule: 'R13' });
  });

  it('an agent’s check sets the state only on a gate with pass: agent', () => {
    const checker = agent(['gates:check']);
    expect(ask(checker, 'gate.check', { pass: 'agent', setsState: true })).toEqual({
      allowed: true,
    });
    for (const pass of ['human', 'check'] as const) {
      expect(ask(checker, 'gate.check', { pass, setsState: true })).toMatchObject({
        allowed: false,
        kind: 'forbidden',
        rule: 'R16',
      });
      expect(ask(everything, 'gate.check', { pass, setsState: true })).toMatchObject({
        rule: 'R16',
      });
    }
  });

  it('an agent cannot reopen a gate, whatever its pass', () => {
    for (const pass of ['human', 'agent', 'check'] as const) {
      expect(ask(everything, 'gate.pass', { pass, reopen: true })).toMatchObject({
        allowed: false,
        rule: 'R13',
      });
    }
  });

  it('R17, the permission part only: an agent cannot approve a post or mark one posted', () => {
    expect(ask(everything, 'post.approve')).toMatchObject({ rule: 'R17' });
    expect(ask(everything, 'post.send')).toMatchObject({ rule: 'R17' });
    expect(ask(agent(['posts:write']), 'post.write')).toEqual({ allowed: true });
    expect(ask(everything, 'post.skip')).toMatchObject({ allowed: false, rule: 'R13' });
  });

  it('an agent cannot publish or unpublish a release', () => {
    expect(ask(everything, 'release.publish')).toMatchObject({ allowed: false, rule: 'R18' });
    expect(ask(agent(['releases:write']), 'release.write')).toEqual({ allowed: true });
  });

  it('an agent cannot write a tester’s note or mark', () => {
    expect(ask(everything, 'step.note')).toMatchObject({ allowed: false, rule: 'R19' });
    expect(ask(everything, 'step.mark')).toMatchObject({ allowed: false, rule: 'R19' });
  });

  it('an agent cannot create, change or revoke tokens, members or connectors, its own token included', () => {
    for (const action of ['agent.manage', 'member.manage', 'connector.manage'] as const) {
      expect(ask(everything, action, { projectId: null })).toMatchObject({
        allowed: false,
        kind: 'forbidden',
        rule: 'R20',
      });
    }
    for (const action of ['agent.read', 'member.read', 'connector.read'] as const) {
      expect(ask(everything, action, { projectId: null })).toMatchObject({ rule: 'R13' });
    }
  });

  it('R21, the permission part only: an agent never decides an asset, so only people replace or clear the one decision', () => {
    expect(ask(everything, 'asset.decide')).toMatchObject({ allowed: false });
  });

  it('R22, the permission part only: an agent with posts:write may edit a post', () => {
    expect(ask(agent(['posts:write']), 'post.write')).toEqual({ allowed: true });
    expect(ask(agent(['posts:read']), 'post.write')).toMatchObject({ rule: 'R12' });
  });

  it('R34, the permission part only: an agent may sync gates and cannot confirm a held change', () => {
    expect(ask(agent(['gates:sync']), 'gate.sync')).toEqual({ allowed: true });
    expect(ask(agent(['gates:sync']), 'gate.confirm_change')).toMatchObject({ rule: 'R13' });
  });

  it('R37, the permission part only: an agent may write a release and cannot publish one', () => {
    expect(ask(agent(['releases:write']), 'release.write')).toEqual({ allowed: true });
    expect(ask(agent(['releases:write']), 'release.publish')).toMatchObject({ rule: 'R18' });
  });

  it('an agent edits only its own decision, and only while it is proposed', () => {
    const token = agent(['decisions:propose']);
    const own = { kind: 'agent', id: agentId } as const;
    expect(
      ask(token, 'decision.propose', { edit: { recordedBy: own, status: 'proposed' } }),
    ).toEqual({ allowed: true });
    expect(
      ask(token, 'decision.propose', { edit: { recordedBy: own, status: 'accepted' } }),
    ).toMatchObject({ rule: 'R38' });
    expect(
      ask(token, 'decision.propose', {
        edit: { recordedBy: { kind: 'user', id: agentId }, status: 'proposed' },
      }),
    ).toMatchObject({ rule: 'R38' });
    expect(
      ask(token, 'decision.propose', {
        edit: { recordedBy: { kind: 'agent', id: otherAgentId }, status: 'proposed' },
      }),
    ).toMatchObject({ rule: 'R38' });
  });

  it('an agent cannot archive a card, a build or an asset', () => {
    for (const action of ['card.archive', 'build.archive', 'asset.archive'] as const) {
      expect(ask(everything, action)).toMatchObject({ allowed: false, rule: 'R39' });
    }
  });

  it('R41, the permission part only: an agent with cards:write may change a card', () => {
    expect(ask(agent(['cards:write']), 'card.update')).toEqual({ allowed: true });
    expect(ask(agent(['cards:write']), 'card.move')).toEqual({ allowed: true });
  });

  it("an agent writes only cost, revenue, usage, subscribers, clicks, sign-ups, a post's counts and followers", () => {
    const token = agent(['signals:write']);
    for (const kind of [
      'cost',
      'revenue',
      'usage',
      'subscribers',
      'clicks',
      'signups',
      'views',
      'likes',
      'comments',
      'shares',
      'followers',
    ] as const) {
      expect(ask(token, 'signal.write', { kind })).toEqual({ allowed: true });
    }
    for (const kind of [
      'store_state',
      'ci',
      'review',
      'impressions',
      'reach',
      'video_views',
      'profile_views',
      'engagements',
      'quota',
    ] as const) {
      expect(ask(token, 'signal.write', { kind })).toMatchObject({
        allowed: false,
        kind: 'forbidden',
        rule: 'R42',
      });
    }
    expect(ask(agent(['money:read']), 'signal.write', { kind: 'cost' })).toMatchObject({
      rule: 'R12',
    });
    // A post's clicks need signals:write too; reading posts gives nothing to write.
    expect(ask(agent(['posts:read']), 'signal.write', { kind: 'clicks' })).toMatchObject({
      allowed: false,
      rule: 'R12',
    });
  });

  it('R43, the permission part only: an agent with inbox:write may add inbox items and cannot triage them', () => {
    expect(ask(agent(['inbox:write']), 'inbox.write')).toEqual({ allowed: true });
    expect(ask(everything, 'inbox.triage')).toMatchObject({ allowed: false, rule: 'R13' });
  });

  it('an agent reads a file only through an item it may read', () => {
    const token = agent(['testing:read']);
    expect(ask(token, 'file.read', { attachedTo: ['step_run'] })).toEqual({ allowed: true });
    expect(ask(token, 'file.read', { attachedTo: ['asset_variant'] })).toMatchObject({
      allowed: false,
      kind: 'not_found',
      rule: 'R46',
    });
    expect(ask(token, 'file.read', { attachedTo: ['asset_variant', 'step_run'] })).toEqual({
      allowed: true,
    });
    // Without a read scope it reads no file at all.
    expect(ask(agent(['testing:post']), 'file.read', { attachedTo: ['step_run'] })).toMatchObject({
      rule: 'R12',
    });
    // A file attached to nothing is read only by whoever uploaded it.
    expect(
      ask(token, 'file.read', { attachedTo: [], uploadedBy: { kind: 'agent', id: agentId } }),
    ).toEqual({ allowed: true });
    expect(
      ask(token, 'file.read', { attachedTo: [], uploadedBy: { kind: 'agent', id: otherAgentId } }),
    ).toMatchObject({ kind: 'not_found' });
  });

  it.each(filePurposes)('an upload for %s needs the scope that goes with it', (purpose) => {
    const scope = uploadScopes[purpose];
    if (scope === null) {
      expect(ask(everything, 'file.upload', { purpose })).toMatchObject({
        allowed: false,
        kind: 'forbidden',
        rule: 'R47',
      });
      return;
    }
    // A receipt's upload is on the word of a person who may write Money.
    const word = purpose === 'receipt' ? { onWordOf: ownerOf() } : {};
    expect(ask(agent([scope]), 'file.upload', { purpose, ...word })).toEqual({ allowed: true });
    const without = agentScopes.filter((other) => other !== scope);
    expect(ask(agent(without), 'file.upload', { purpose })).toMatchObject({
      allowed: false,
      rule: 'R47',
    });
  });

  it('an upload names its purpose', () => {
    expect(ask(everything, 'file.upload')).toMatchObject({ allowed: false, rule: 'R47' });
  });

  it('an agent adds a link to a group and does nothing else to links', () => {
    expect(ask(agent(['links:write']), 'link.add')).toEqual({ allowed: true });
    expect(ask(everything, 'link.write')).toMatchObject({ allowed: false, rule: 'R56' });
    expect(ask(everything, 'link.read')).toMatchObject({ allowed: false, rule: 'R12' });
  });

  it('no agent token starts an assistant call or reads or changes its settings', () => {
    expect(ask(everything, 'assistant.draft')).toMatchObject({ allowed: false, rule: 'R61' });
    expect(ask(everything, 'assistant.manage', { projectId: null })).toMatchObject({
      allowed: false,
      rule: 'R61',
    });
  });
});

describe("R15 as amended: decisions:decide, on a named person's word", () => {
  const relay = (token: AgentPrincipal, resource: Record<string, unknown>) =>
    ask(token, 'decision.relay', resource);
  const decider = agent(['decisions:decide']);

  it.each(['accepted', 'rejected', 'parked'])(
    'sets %s on the word of a person who may decide there',
    (status) => {
      expect(relay(decider, { status, onWordOf: deciderOf(p1) })).toEqual({ allowed: true });
    },
  );

  it('never changes a decision that supersedes another: replacing one is a person’s (409)', () => {
    expect(
      relay(decider, { status: 'accepted', replaces: true, onWordOf: deciderOf(p1) }),
    ).toMatchObject({ allowed: false, kind: 'conflict', rule: 'R15' });
  });

  it('never sets done, and never says what a decision supersedes', () => {
    for (const status of ['done', 'proposed']) {
      expect(relay(decider, { status, onWordOf: deciderOf(p1) })).toMatchObject({
        allowed: false,
        kind: 'forbidden',
        rule: 'R15',
      });
    }
    expect(
      relay(decider, { status: 'accepted', supersedes: true, onWordOf: deciderOf(p1) }),
    ).toMatchObject({ allowed: false, rule: 'R15' });
  });

  it('needs the person, and the person needs decision.decide where the decision is', () => {
    expect(relay(decider, { status: 'accepted', onWordOf: null })).toMatchObject({
      allowed: false,
      rule: 'R83',
    });
    // A Reviewer of p1 does not decide in p2, nor workspace-wide decisions.
    const both = agent(['decisions:decide'], { projectIds: [p1, p2], workspaceWide: true });
    expect(
      relay(both, { projectId: p2, status: 'accepted', onWordOf: deciderOf(p1) }),
    ).toMatchObject({ allowed: false, rule: 'R83' });
    expect(
      relay(both, { projectId: null, status: 'accepted', onWordOf: deciderOf(p1) }),
    ).toMatchObject({ allowed: false, rule: 'R83' });
    expect(relay(both, { projectId: null, status: 'accepted', onWordOf: deciderOf(null) })).toEqual(
      { allowed: true },
    );
    for (const role of ['member', 'viewer'] as const) {
      const person = personPrincipal({
        userId: '99999999-9999-4999-8999-999999999999',
        memberships: [{ workspaceId: ws, role, projectRoles: {} }],
      });
      expect(relay(decider, { status: 'accepted', onWordOf: person })).toMatchObject({
        allowed: false,
        rule: 'R83',
      });
    }
    // A person of another workspace is nobody here.
    const stranger = personPrincipal({
      userId: '99999999-9999-4999-8999-999999999999',
      memberships: [{ workspaceId: otherWs, role: 'owner', projectRoles: {} }],
    });
    expect(relay(decider, { status: 'accepted', onWordOf: stranger })).toMatchObject({
      allowed: false,
      rule: 'R83',
    });
  });

  it('without the scope everything stays as it was: R12 for the relay, R15 for decide', () => {
    const others = agentScopes.filter((scope) => scope !== 'decisions:decide');
    const token = agent(others, { projectIds: [p1, p2], workspaceWide: true });
    expect(relay(token, { status: 'accepted', onWordOf: deciderOf(p1) })).toMatchObject({
      allowed: false,
      rule: 'R12',
    });
    expect(ask(token, 'decision.decide')).toMatchObject({ allowed: false, rule: 'R15' });
    // decision.decide stays human-only even with the scope.
    expect(ask(everything, 'decision.decide')).toMatchObject({ allowed: false, rule: 'R15' });
  });

  it('reaches only the projects on the token, and a workspace decision only with workspaceWide', () => {
    expect(
      relay(decider, { projectId: p2, status: 'accepted', onWordOf: deciderOf(p2) }),
    ).toMatchObject({ allowed: false, kind: 'not_found' });
    expect(
      relay(decider, { projectId: null, status: 'accepted', onWordOf: deciderOf(null) }),
    ).toMatchObject({ allowed: false, rule: 'R11' });
  });

  it('no person takes decision.relay: a person decides with decision.decide', () => {
    const owner = personPrincipal({
      userId: '99999999-9999-4999-8999-999999999999',
      memberships: [{ workspaceId: ws, role: 'owner', projectRoles: {} }],
    });
    expect(
      can(owner, 'decision.relay', {
        workspaceId: ws,
        projectId: p1,
        status: 'accepted',
        onWordOf: owner,
      }),
    ).toMatchObject({ allowed: false, rule: 'R83' });
  });

  it('only an Owner gives or takes away an opt-in scope; an Admin makes tokens without one; R20: no agent', () => {
    const as = (role: 'owner' | 'admin' | 'member') =>
      personPrincipal({
        userId: '99999999-9999-4999-8999-999999999999',
        memberships: [{ workspaceId: ws, role, projectRoles: {} }],
      });
    expect(can(as('owner'), 'agent.manage', { workspaceId: ws, optInScopes: true })).toEqual({
      allowed: true,
    });
    expect(can(as('admin'), 'agent.manage', { workspaceId: ws, optInScopes: true })).toMatchObject({
      allowed: false,
      rule: 'R83',
    });
    expect(can(as('admin'), 'agent.manage', { workspaceId: ws })).toEqual({ allowed: true });
    expect(can(as('member'), 'agent.manage', { workspaceId: ws, optInScopes: true })).toMatchObject(
      { allowed: false },
    );
    // R20: an agent changes no token, whatever its scopes, its own included.
    expect(ask(everything, 'agent.manage', { projectId: null, optInScopes: true })).toMatchObject({
      allowed: false,
      rule: 'R20',
    });
  });

  it('decision.relay is one no role takes, and maps to the human-only decision.decide', () => {
    expect(roleTable['decision.relay'].roles).toEqual([]);
    expect(onWordActions['decision.relay']).toBe('decision.decide');
    expect(isHumanOnly('decision.decide')).toBe(true);
  });

  it('receipt.suggest: no role takes it, money:write gives it, and it takes no word', () => {
    expect(roleTable['receipt.suggest'].roles).toEqual([]);
    expect(isOnWordAction('receipt.suggest')).toBe(false);
    expect(scopeTable['money:write']).toContain('receipt.suggest');
    for (const scope of standardScopes) expect(scopeTable[scope]).not.toContain('receipt.suggest');
  });

  it('every action of an opt-in scope is taken on a word, and no standard scope gives one', () => {
    for (const scope of optInScopes) {
      for (const action of scopeTable[scope]) {
        // The upload of a receipt is a file only; attaching it is money.write.
        if (action === 'file.upload') continue;
        // A suggested receipt counts in nothing until a person confirms it: no word.
        if (action === 'receipt.suggest') continue;
        expect(isOnWordAction(action), action).toBe(true);
      }
    }
    for (const scope of standardScopes) {
      for (const action of scopeTable[scope]) expect(isOnWordAction(action)).toBe(false);
    }
    for (const [action, theirs] of Object.entries(onWordActions)) {
      if (action === 'decision.relay') continue;
      // The second set grants the person's action itself.
      expect(theirs).toBe(action);
      expect(isHumanOnly(action as TableAction)).toBe(false);
      expect(actionsOfScopes(standardScopes).has(action as TableAction), action).toBe(false);
    }
  });
});

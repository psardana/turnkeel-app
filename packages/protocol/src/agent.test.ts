import { describe, expect, it } from 'vitest';
import {
  agentNameSchema,
  agentScopes,
  createTokenRequestSchema,
  eventAreaOf,
  followedPresetOf,
  isOptInScope,
  isStandardPreset,
  optInScopes,
  presetOf,
  presetScopeHistory,
  standardPresets,
  standardScopes,
  tokenPresetScopes,
  tokenPresets,
  updateAgentRequestSchema,
  updateTokenRequestSchema,
} from './index.js';

const project = '0192f0c1-7a3e-4b1c-9d2e-4f5a6b7c8d9e';

describe('agents and tokens', () => {
  it('has the 38 scopes, each once', () => {
    // 36 until routines added routines:run, 37 until epics:write.
    expect(agentScopes).toHaveLength(38);
    expect(new Set(agentScopes).size).toBe(38);
  });

  it('decisions:decide is opt-in, and no bundle of every standard scope holds it', () => {
    // The first, and the second set.
    expect([...optInScopes]).toEqual([
      'decisions:decide',
      'cards:archive',
      'inbox:triage',
      'testing:mark',
      'money:write',
      'assets:decide',
      'posts:approve',
      'gates:pass',
      'releases:publish',
      'posts:send',
      'spend:commit',
    ]);
    expect(isOptInScope('decisions:decide')).toBe(true);
    expect(isOptInScope('decisions:propose')).toBe(false);
    for (const scope of optInScopes) expect(standardScopes).not.toContain(scope);
    expect(standardScopes).toHaveLength(27);
    expect([...standardScopes, ...optInScopes].sort()).toEqual([...agentScopes].sort());
  });

  it('the three presets are lists of scopes, each wider than the one before', () => {
    expect([...tokenPresets]).toEqual(['reporter', 'builder', 'operator']);
    const reads = standardScopes.filter((scope) => scope.endsWith(':read'));
    expect(tokenPresetScopes.reporter).toEqual(
      agentScopes.filter((scope) => [...reads, 'sessions:write', 'signals:write'].includes(scope)),
    );
    expect(tokenPresetScopes.builder).toEqual(
      agentScopes.filter((scope) =>
        [
          ...tokenPresetScopes.reporter,
          'cards:write',
          'planning:write',
          // Epics; Reporter does not hold it.
          'epics:write',
          'testing:post',
          'testing:reply',
          'releases:write',
          // Routines.
          'routines:run',
        ].includes(scope),
      ),
    );
    expect(tokenPresetScopes.operator).toEqual(
      agentScopes.filter((scope) => [...tokenPresetScopes.builder, ...optInScopes].includes(scope)),
    );
    // No opt-in scope is in Reporter or Builder; Operator holds spend:commit, so its cap.
    for (const scope of optInScopes) {
      expect(tokenPresetScopes.reporter).not.toContain(scope);
      expect(tokenPresetScopes.builder).not.toContain(scope);
    }
    expect(tokenPresetScopes.operator).toContain('spend:commit');
    // Each preset is a list the server takes as any other list.
    for (const preset of tokenPresets) {
      const request = {
        name: preset,
        scopes: [...tokenPresetScopes[preset]],
        projectIds: [project],
      };
      expect(createTokenRequestSchema.safeParse(request).success, preset).toBe(true);
    }
  });

  it('a token follows Reporter or Builder, never Operator; a request names one or sends a list', () => {
    expect([...standardPresets]).toEqual(['reporter', 'builder']);
    for (const preset of standardPresets) {
      for (const scope of optInScopes) expect(tokenPresetScopes[preset]).not.toContain(scope);
    }
    const base = { name: 'CI', projectIds: [project] };
    // A preset alone, a preset with its scopes, or a list alone; never neither.
    expect(createTokenRequestSchema.safeParse({ ...base, preset: 'builder' }).success).toBe(true);
    expect(
      createTokenRequestSchema.safeParse({
        ...base,
        preset: 'reporter',
        scopes: [...tokenPresetScopes.reporter, 'decisions:decide'],
      }).success,
    ).toBe(true);
    expect(createTokenRequestSchema.safeParse({ ...base, scopes: ['cards:read'] }).success).toBe(
      true,
    );
    expect(createTokenRequestSchema.safeParse(base).success).toBe(false);
    expect(createTokenRequestSchema.safeParse({ ...base, preset: 'operator' }).success).toBe(false);
    expect(updateTokenRequestSchema.safeParse({ preset: 'builder' }).success).toBe(true);
    expect(updateTokenRequestSchema.safeParse({ preset: 'operator' }).success).toBe(false);
    expect(updateTokenRequestSchema.safeParse({ preset: 'custom' }).success).toBe(false);
  });

  it('the lists Builder has held are those of 14, 15 and 18 Nov 2026; Reporter has held one', () => {
    const [first, second, today] = presetScopeHistory.builder;
    expect(today).toEqual(tokenPresetScopes.builder);
    expect(second).toEqual(tokenPresetScopes.builder.filter((scope) => scope !== 'epics:write'));
    expect(first).toEqual(
      tokenPresetScopes.builder.filter(
        (scope) => scope !== 'epics:write' && scope !== 'routines:run',
      ),
    );
    expect(presetScopeHistory.reporter).toEqual([tokenPresetScopes.reporter]);
  });

  it("a token made before follows the preset whose scopes it holds every one of, today's or earlier", () => {
    expect(followedPresetOf(tokenPresetScopes.builder)).toBe('builder');
    expect(followedPresetOf([...tokenPresetScopes.reporter].reverse())).toBe('reporter');
    // A Builder of before epics:write, or of before routines:run, follows Builder.
    for (const list of presetScopeHistory.builder) expect(followedPresetOf(list)).toBe('builder');
    // Extra scopes, standard or opt-in, stay: Builder plus docs:sync is Builder.
    expect(followedPresetOf([...tokenPresetScopes.builder, 'docs:sync', 'decisions:propose'])).toBe(
      'builder',
    );
    expect(followedPresetOf([...tokenPresetScopes.builder, 'decisions:decide'])).toBe('builder');
    expect(followedPresetOf([...standardScopes])).toBe('builder');
    // Reporter's every scope and part of Builder's is Reporter.
    expect(followedPresetOf([...tokenPresetScopes.reporter, 'cards:write', 'gates:sync'])).toBe(
      'reporter',
    );
    // An Operator list exactly, of today or before, follows none.
    expect(followedPresetOf(tokenPresetScopes.operator)).toBeNull();
    for (const list of presetScopeHistory.builder) {
      expect(followedPresetOf([...list, ...optInScopes])).toBeNull();
    }
    // A list that misses a scope of every preset follows none.
    expect(followedPresetOf(tokenPresetScopes.reporter.slice(1))).toBeNull();
    expect(followedPresetOf(['cards:read'])).toBeNull();
    expect(isStandardPreset('builder')).toBe(true);
    expect(isStandardPreset('operator')).toBe(false);
  });

  it('a list is a preset only when it holds exactly its scopes, in any order', () => {
    expect(presetOf([...tokenPresetScopes.builder].reverse())).toBe('builder');
    expect(presetOf(tokenPresetScopes.operator)).toBe('operator');
    expect(presetOf([...tokenPresetScopes.reporter, 'gates:sync'])).toBeNull();
    expect(presetOf(tokenPresetScopes.reporter.slice(1))).toBeNull();
    expect(presetOf([])).toBeNull();
  });

  it('a Builder token made before epics is no preset now, and Builder adds epics:write', () => {
    expect(tokenPresetScopes.reporter).not.toContain('epics:write');
    const before = tokenPresetScopes.builder.filter((scope) => scope !== 'epics:write');
    expect(presetOf(before)).toBeNull();
    expect(presetOf([...before, 'epics:write'])).toBe('builder');
  });

  it('takes an agent name of lower-case letters, digits and single hyphens', () => {
    expect(agentNameSchema.safeParse('board-keeper').success).toBe(true);
    expect(agentNameSchema.safeParse('Board').success).toBe(false);
    expect(agentNameSchema.safeParse('a').success).toBe(false);
    expect(agentNameSchema.safeParse('two--hyphens').success).toBe(false);
  });

  it('a token names at least one project', () => {
    const base = { name: 'CI', scopes: ['cards:read'] };
    expect(createTokenRequestSchema.safeParse({ ...base, projectIds: [] }).success).toBe(false);
    expect(createTokenRequestSchema.safeParse({ ...base, projectIds: [project] }).success).toBe(
      true,
    );
  });

  it('a token with a scope that is not on the scope list cannot be asked for', () => {
    const request = { name: 'CI', projectIds: [project] };
    expect(
      createTokenRequestSchema.safeParse({ ...request, scopes: ['assets:approve'] }).success,
    ).toBe(false);
    expect(createTokenRequestSchema.safeParse({ ...request, scopes: ['admin'] }).success).toBe(
      false,
    );
    expect(createTokenRequestSchema.safeParse({ ...request, scopes: [] }).success).toBe(false);
  });

  it('names each scope and each project once, and the token in one line', () => {
    expect(
      createTokenRequestSchema.safeParse({
        name: 'CI',
        scopes: ['cards:read', 'cards:read'],
        projectIds: [project],
      }).success,
    ).toBe(false);
    expect(
      createTokenRequestSchema.safeParse({
        name: 'CI',
        scopes: ['cards:read'],
        projectIds: [project, project.toUpperCase()],
      }).success,
    ).toBe(false);
    expect(
      createTokenRequestSchema.safeParse({
        name: 'two\nlines',
        scopes: ['cards:read'],
        projectIds: [project],
      }).success,
    ).toBe(false);
  });

  it('disables an agent and never enables one again', () => {
    expect(updateAgentRequestSchema.safeParse({ disabled: true }).success).toBe(true);
    expect(updateAgentRequestSchema.safeParse({ disabled: false }).success).toBe(false);
  });

  it('puts the events of agents and tokens in their own area', () => {
    for (const type of [
      'agent.created',
      'agent.updated',
      'agent.disabled',
      'token.created',
      'token.revoked',
      'access.denied',
    ] as const) {
      expect(eventAreaOf(type)).toBe('agents');
    }
  });

  it('PATCH /tokens/:id takes the standard scopes, each once and at least one', () => {
    const ok = (body: unknown) => updateTokenRequestSchema.safeParse(body).success;
    expect(ok({ scopes: ['cards:read', 'routines:run'] })).toBe(true);
    expect(ok({ scopes: [...standardScopes] })).toBe(true);
    expect(ok({ scopes: ['cards:read'], optInScopes: ['decisions:decide'] })).toBe(true);
    // At least one, each once, and none that acts on a person's word: those go in optInScopes.
    expect(ok({ scopes: [] })).toBe(false);
    expect(ok({ scopes: ['cards:read', 'cards:read'] })).toBe(false);
    expect(ok({ scopes: ['decisions:decide'] })).toBe(false);
    expect(ok({ scopes: ['admin'] })).toBe(false);
    // Something to change, and nothing else: the projects stay as made.
    expect(ok({})).toBe(false);
    expect(ok({ scopes: ['cards:read'], projectIds: [project] })).toBe(false);
  });
});

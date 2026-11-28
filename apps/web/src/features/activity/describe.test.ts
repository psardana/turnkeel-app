import { eventTypes, type EventType, type Project } from '@turnkeel/protocol';
import { describe, expect, it } from 'vitest';
import { ADA, eventOf, OLIVE, testId, WORKSPACE_ID } from '@/testing/events';
import { describeEvent, type DescribeContext, type Described } from './describe';
import { parseActivitySearch } from './search';

const PROJECT_ID = testId(20);
const stamp = { kind: 'user' as const, id: OLIVE.id };

const project: Project = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  createdAt: '2026-11-11T09:00:00.000Z',
  createdBy: stamp,
  updatedAt: '2026-11-11T09:00:00.000Z',
  updatedBy: stamp,
  name: 'Harbor app',
  key: 'HAR',
  slug: 'harbor-app',
  kind: 'app',
  launchDate: null,
  launchMilestoneId: null,
  locales: ['en'],
  repoUrl: null,
  shipsTo: [],
  changelogPublic: false,
  archivedAt: null,
};

const context: DescribeContext = {
  workspaceName: 'Acme',
  projects: new Map([[PROJECT_ID, project]]),
  people: new Map([
    [OLIVE.id, OLIVE.name],
    [ADA.id, ADA.name],
  ]),
};

/** The line as it reads, with the linked item in brackets. */
const line = (described: Described) =>
  [described.before, described.item ? `[${described.item.label}]` : '', described.after]
    .filter(Boolean)
    .join(' ');

describe('describeEvent', () => {
  it('says what happened to agents and tokens, and never shows a token', () => {
    expect(
      line(describeEvent(eventOf(1, 'agent.created', { data: { name: 'board-keeper' } }), context)),
    ).toBe('added the agent [board-keeper]');
    expect(
      line(
        describeEvent(
          eventOf(2, 'agent.updated', { data: { ownerUserId: [OLIVE.id, ADA.id] } }),
          context,
        ),
      ),
    ).toBe('changed the owner of the agent [an agent]');
    expect(
      line(
        describeEvent(eventOf(3, 'token.created', { data: { prefix: 'tk_AbCdEfGh' } }), context),
      ),
    ).toBe('made a token (tk_AbCdEfGh…) for the agent');
    expect(
      line(
        describeEvent(
          eventOf(4, 'access.denied', { data: { action: 'member.manage', rule: 'R20' } }),
          context,
        ),
      ),
    ).toBe('was refused: member.manage');
    expect(
      line(
        describeEvent(
          eventOf(5, 'access.denied', {
            data: { action: 'project.update', rule: 'R13', repeats: 99 },
          }),
          context,
        ),
      ),
    ).toBe('was refused: project.update and 99 more times since the line before');
    expect(
      line(
        describeEvent(
          eventOf(6, 'token.revoked', {
            data: { prefix: 'tk_AbCdEfGh', reason: 'member_removed' },
          }),
          context,
        ),
      ),
    ).toBe(
      'revoked a token (tk_AbCdEfGh…) of the agent, because the person who made it left the workspace',
    );
    expect(
      line(
        describeEvent(
          eventOf(7, 'token.revoked', { data: { prefix: 'tk_AbCdEfGh', reason: 'role_changed' } }),
          context,
        ),
      ),
    ).toBe(
      'revoked a token (tk_AbCdEfGh…) of the agent, because the person who made it no longer manages agents',
    );
    expect(
      line(
        describeEvent(
          eventOf(8, 'token.revoked', { data: { prefix: 'tk_AbCdEfGh', reason: 'demo_removed' } }),
          context,
        ),
      ),
    ).toBe('revoked a token (tk_AbCdEfGh…) of the agent, because the demo data was removed');
    // An Owner turned an opt-in scope on, then off.
    expect(
      line(
        describeEvent(
          eventOf(9, 'token.updated', {
            data: { prefix: 'tk_AbCdEfGh', optInScopes: [[], ['decisions:decide']] },
          }),
          context,
        ),
      ),
    ).toBe('turned on decisions:decide on the token tk_AbCdEfGh…');
    expect(
      line(
        describeEvent(
          eventOf(10, 'token.updated', {
            data: { prefix: 'tk_AbCdEfGh', optInScopes: [['decisions:decide'], []] },
          }),
          context,
        ),
      ),
    ).toBe('turned off decisions:decide on the token tk_AbCdEfGh…');
    // An Owner changed the standard scopes of a working token.
    expect(
      line(
        describeEvent(
          eventOf(11, 'token.updated', {
            data: {
              prefix: 'tk_AbCdEfGh',
              optInScopes: [[], []],
              scopes: [
                ['cards:read', 'cards:write'],
                ['cards:read', 'routines:run'],
              ],
            },
          }),
          context,
        ),
      ),
    ).toBe('turned on routines:run and turned off cards:write on the token tk_AbCdEfGh…');
    // An Owner chose a preset, and a list of the token's own made it custom.
    expect(
      line(
        describeEvent(
          eventOf(12, 'token.updated', {
            data: {
              prefix: 'tk_AbCdEfGh',
              optInScopes: [[], []],
              scopes: [['cards:read'], ['cards:read', 'routines:run']],
              preset: [null, 'builder'],
            },
          }),
          context,
        ),
      ),
    ).toBe('turned on routines:run and chose the preset Builder on the token tk_AbCdEfGh…');
    expect(
      line(
        describeEvent(
          eventOf(13, 'token.updated', {
            data: { prefix: 'tk_AbCdEfGh', optInScopes: [[], []], preset: ['builder', null] },
          }),
          context,
        ),
      ),
    ).toBe('made the scopes custom on the token tk_AbCdEfGh…');
    // The system gave a token the scope its preset gained in a release.
    expect(
      line(
        describeEvent(
          eventOf(14, 'token.updated', {
            data: {
              prefix: 'tk_AbCdEfGh',
              optInScopes: [[], []],
              scopes: [['cards:read'], ['cards:read', 'epics:write']],
              followsPreset: 'builder',
            },
          }),
          context,
        ),
      ),
    ).toBe('turned on epics:write on the token tk_AbCdEfGh…, which follows Builder');
  });

  it('says what happened to the workspace, and links to its settings', () => {
    const created = describeEvent(
      eventOf(1, 'workspace.created', { data: { name: 'Acme' } }),
      context,
    );
    expect(line(created)).toBe('created the workspace [Acme]');
    expect(created.item?.link).toEqual({ kind: 'settings' });

    const updated = describeEvent(
      eventOf(2, 'workspace.updated', {
        data: { name: ['Acme', 'Acme Ltd'], slug: ['acme', 'acme-ltd'] },
      }),
      context,
    );
    expect(line(updated)).toBe('changed the name and address of the workspace [Acme]');

    const transferred = describeEvent(
      eventOf(3, 'workspace.transferred', { data: { from: OLIVE.id, to: ADA.id } }),
      context,
    );
    expect(line(transferred)).toBe('handed the workspace [Acme] over to Ada Admin');

    // The tabs turned off, and Keep these tabs.
    const tabs = describeEvent(
      eventOf(4, 'workspace.updated', { data: { tabsOff: [[], ['releases']] } }),
      context,
    );
    expect(line(tabs)).toBe('changed the tabs of the workspace [Acme]');
    const kept = describeEvent(
      eventOf(5, 'workspace.tabs_kept', { data: { off: ['releases', 'money'] } }),
      context,
    );
    expect(line(kept)).toBe('kept the tabs of the workspace [Acme] with Releases and Money off');
    const allOn = describeEvent(eventOf(6, 'workspace.tabs_kept', { data: { off: [] } }), context);
    expect(line(allOn)).toBe('kept the tabs of the workspace [Acme] with every tab on');
    // Data of another shape names no tab.
    expect(
      describeEvent(eventOf(7, 'workspace.tabs_kept', { data: { off: 3 } }), context).before,
    ).not.toBe('');
  });

  it('names the card a call of the assistant was for, and links to it, with how it ended', () => {
    const called = describeEvent(
      eventOf(40, 'assistant.called', {
        subject: { type: 'card', id: testId(41) },
        data: { callId: testId(42), key: 'HAR-12', feature: 'catch_up', outcome: 'stopped' },
      }),
      context,
    );
    expect(line(called)).toBe('asked the assistant to catch up on [HAR-12] and stopped it');
    expect(called.item).toEqual({ label: 'HAR-12', link: { kind: 'card', key: 'HAR-12' } });
    // An event without the key names no card.
    expect(
      line(
        describeEvent(
          eventOf(43, 'assistant.called', { data: { feature: 'catch_up', outcome: 'ok' } }),
          context,
        ),
      ),
    ).toBe('asked the assistant to catch up on a card');
  });

  it('names a project by its current name and links to it by its key', () => {
    const event = eventOf(4, 'project.updated', {
      projectId: PROJECT_ID,
      data: {
        launchDate: [null, '2027-03-01'],
        locales: [['en'], ['en', 'de']],
        kind: ['app', 'web'],
      },
    });
    const described = describeEvent(event, context);
    expect(line(described)).toBe(
      'changed the launch date, languages and kind of the project [Harbor app]',
    );
    expect(described.item?.link).toEqual({ kind: 'project', key: 'HAR' });
  });

  it('falls back to what the event carries for a project the viewer cannot list', () => {
    const described = describeEvent(
      eventOf(5, 'project.created', {
        projectId: testId(99),
        data: { name: 'Gone', key: 'GON' },
      }),
      context,
    );
    expect(line(described)).toBe('created the project [Gone]');
    expect(described.item?.link).toEqual({ kind: 'project', key: 'GON' });
  });

  it('describes invitations by the address they went to', () => {
    expect(
      line(
        describeEvent(
          eventOf(6, 'member.invited', { data: { email: 'new@example.com', role: 'reviewer' } }),
          context,
        ),
      ),
    ).toBe('invited [new@example.com] as Reviewer');
    expect(
      line(
        describeEvent(
          eventOf(7, 'member.invited', {
            projectId: PROJECT_ID,
            data: { email: 'tess@example.com', role: 'tester', projectId: PROJECT_ID },
          }),
          context,
        ),
      ),
    ).toBe('invited [tess@example.com] as Tester to the project Harbor app');
    expect(
      line(
        describeEvent(
          eventOf(8, 'member.invite_revoked', {
            data: { email: 'new@example.com', role: 'reviewer', reason: 'revoked' },
          }),
          context,
        ),
      ),
    ).toBe('revoked the invitation for [new@example.com]');
    expect(
      line(
        describeEvent(
          eventOf(9, 'member.invite_revoked', {
            data: { email: 'new@example.com', role: 'reviewer', reason: 'replaced' },
          }),
          context,
        ),
      ),
    ).toBe('replaced the invitation for [new@example.com]');
  });

  it('tells a person who joined from a person who was added', () => {
    const joined = describeEvent(
      eventOf(10, 'member.joined', {
        actor: ADA,
        data: { userId: ADA.id, role: 'admin', handle: 'ada' },
      }),
      context,
    );
    expect(line(joined)).toBe('joined the workspace as Admin');
    expect(joined.item).toBeNull();

    const added = describeEvent(
      eventOf(11, 'member.joined', {
        projectId: PROJECT_ID,
        data: { userId: ADA.id, role: 'tester', projectId: PROJECT_ID },
      }),
      context,
    );
    expect(line(added)).toBe('added [Ada Admin] to the project Harbor app as Tester');
    expect(added.item?.link).toEqual({ kind: 'members' });
  });

  it('describes a change of role, of handle, and a removal', () => {
    expect(
      line(
        describeEvent(
          eventOf(12, 'member.role_changed', {
            data: { userId: ADA.id, role: ['member', 'admin'] },
          }),
          context,
        ),
      ),
    ).toBe('changed the role of [Ada Admin] from Member to Admin');
    expect(
      line(
        describeEvent(
          eventOf(13, 'member.handle_changed', {
            actor: ADA,
            data: { userId: ADA.id, handle: ['ada', 'ada-a'] },
          }),
          context,
        ),
      ),
    ).toBe('changed their handle from @ada to @ada-a');
    expect(
      line(
        describeEvent(
          eventOf(14, 'member.removed', {
            data: { userId: testId(77), role: 'viewer', handle: 'vic' },
          }),
          context,
        ),
      ),
    ).toBe('removed [@vic] from the workspace');
    expect(
      line(
        describeEvent(
          eventOf(15, 'member.removed', {
            projectId: PROJECT_ID,
            data: { userId: testId(77), role: 'tester', projectId: PROJECT_ID },
          }),
          context,
        ),
      ),
    ).toBe('removed [a person] from the project Harbor app');
  });

  it('never throws on data that has another shape', () => {
    for (const type of [
      'workspace.updated',
      'project.created',
      'member.invited',
      'member.joined',
      'member.role_changed',
      'member.handle_changed',
      'member.removed',
    ] as const) {
      const described = describeEvent(
        eventOf(20, type, { data: { role: 7, email: null } }),
        context,
      );
      expect(described.before).not.toBe('');
    }
  });

  it('says so for a type that a later step adds', () => {
    const described = describeEvent(eventOf(21, 'later.kind' as EventType), context);
    expect(described.before).toContain('later.kind');
  });

  it.each(eventTypes)('describes %s, with data and without', (type) => {
    const unknown = messages.activity.unknownEvent(type).before;
    for (const data of [{}, { title: 7, state: 'x', status: [1], name: null }]) {
      const described = describeEvent(eventOf(22, type, { data }), context);
      expect(described.before).not.toBe(unknown);
      expect(described.before).not.toBe('');
    }
  });
});

describe('the filters in the address', () => {
  it('reads project, area, actor and the range of days', () => {
    expect(
      parseActivitySearch({
        project: 'har',
        area: 'people',
        actor: OLIVE.id,
        from: '2026-11-01',
        to: '2026-11-11',
      }),
    ).toEqual({
      project: 'HAR',
      area: 'people',
      actor: OLIVE.id,
      from: '2026-11-01',
      to: '2026-11-11',
    });
  });

  it('leaves out what does not fit, and never fails', () => {
    expect(
      parseActivitySearch({
        project: 'not a key',
        area: 'ops',
        actor: 'olive',
        from: 'yesterday',
        to: 20261111,
        other: 'x',
      }),
    ).toEqual({});
    expect(parseActivitySearch({})).toEqual({});
  });
});

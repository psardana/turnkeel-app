import { QueryClient } from '@tanstack/react-query';
import type { StreamMessage } from '@turnkeel/protocol';
import { testId } from '@/testing/events';

const message = (type: StreamMessage['type']): StreamMessage => ({
  seq: 1,
  type,
  subject: { type: 'project', id: testId(20) },
  projectId: null,
  actor: { kind: 'user', id: testId(10) },
  at: '2026-11-11T09:00:00.000Z',
  fields: [],
});

describe('what a stream message makes the app read again', () => {
  it('always the Activity list of that workspace', () => {
    expect(staleKeysFor('acme', message('workspace.updated'))).toContainEqual(keys.events('acme'));
  });

  it('the projects, Your turn and the Board for an event about a project', () => {
    expect(staleKeysFor('acme', message('project.archived'))).toEqual([
      keys.events('acme'),
      keys.start('acme'),
      keys.projects('acme'),
      keys.turn('acme'),
      keys.board('acme'),
      [...keys.workspace('acme'), 'planning'],
    ]);
  });

  it('Testing and Your turn for an event about a build, a feature, a step or its feedback', () => {
    for (const type of [
      'build.posted',
      'build.archived',
      'step.noted',
      'step.replied',
      'feature.marked',
      'feedback.read',
    ] as const) {
      expect(staleKeysFor('acme', message(type)), type).toEqual([
        keys.events('acme'),
        keys.builds('acme'),
        keys.turn('acme'),
        ...(type.startsWith('build.') ? [[...keys.workspace('acme'), 'planning']] : []),
      ]);
    }
  });

  it('Launch and Your turn for an event about a gate or a listing, and the Connectors screen for an install', () => {
    for (const type of ['gate.synced', 'gate.state_changed', 'listing.row_marked'] as const) {
      expect(staleKeysFor('acme', message(type)), type).toEqual([
        keys.events('acme'),
        keys.start('acme'),
        keys.launch('acme'),
        keys.turn('acme'),
        ...(type.startsWith('gate.') ? [[...keys.workspace('acme'), 'planning']] : []),
      ]);
    }
    expect(staleKeysFor('acme', message('connector.failed'))).toEqual([
      keys.events('acme'),
      keys.start('acme'),
      keys.connectors('acme'),
      keys.launch('acme'),
      keys.review('acme'),
      keys.inbox('acme'),
      keys.releases('acme'),
      keys.money('acme'),
    ]);
  });

  it('Decisions, Releases and the Inbox, and the lines of Your turn, for their events', () => {
    expect(staleKeysFor('acme', message('decision.decided'))).toEqual([
      keys.events('acme'),
      keys.decisions('acme'),
      keys.turn('acme'),
    ]);
    expect(staleKeysFor('acme', message('inbox.carded'))).toEqual([
      keys.events('acme'),
      keys.inbox('acme'),
      keys.turn('acme'),
    ]);
    expect(staleKeysFor('acme', message('changes.received'))).toEqual([
      keys.events('acme'),
      keys.releases('acme'),
    ]);
    // A release's lanes make its Release line.
    expect(staleKeysFor('acme', message('release.updated'))).toEqual([
      keys.events('acme'),
      keys.releases('acme'),
      keys.turn('acme'),
    ]);
  });

  it('Review and Your turn for an event about an asset or a post; By hand and the Calendar too for a post', () => {
    for (const type of ['asset.proposed', 'asset.decided', 'asset_group.changed'] as const) {
      expect(staleKeysFor('acme', message(type)), type).toEqual([
        keys.events('acme'),
        keys.review('acme'),
        keys.turn('acme'),
      ]);
    }
    for (const type of ['post.approved', 'post.posted', 'post.failed'] as const) {
      expect(staleKeysFor('acme', message(type)), type).toEqual([
        keys.events('acme'),
        keys.review('acme'),
        keys.turn('acme'),
        keys.launch('acme'),
        [...keys.workspace('acme'), 'planning'],
      ]);
    }
  });

  it('the members, the invitations, the names and who the viewer is for an event about people', () => {
    expect(staleKeysFor('acme', message('member.role_changed'))).toEqual([
      keys.events('acme'),
      keys.start('acme'),
      keys.members('acme'),
      keys.invitations('acme'),
      keys.me,
      keys.people('acme'),
      keys.turn('acme'),
    ]);
  });

  it('the lines and counts of Your turn, the Board and the open cards for an event about a card', () => {
    for (const type of ['card.moved', 'card.updated', 'card.status_added'] as const) {
      expect(staleKeysFor('acme', message(type))).toEqual([
        keys.events('acme'),
        keys.turn('acme'),
        keys.board('acme'),
        keys.cards('acme'),
        keys.launch('acme'),
        [...keys.workspace('acme'), 'planning'],
      ]);
    }
    const card = keys.card('acme', testId(30));
    expect(card.slice(0, keys.cards('acme').length)).toEqual([...keys.cards('acme')]);
  });

  it('the names too when a card made a new party, which would otherwise show as "A party"', () => {
    for (const type of [
      'card.created',
      'card.moved',
      'gate.synced',
      'decision.proposed',
    ] as const) {
      expect(
        staleKeysFor('acme', { ...message(type), fields: ['owner', 'partiesCreated'] }),
      ).toContainEqual(keys.people('acme'));
    }
    expect(staleKeysFor('acme', message('card.created'))).not.toContainEqual(keys.people('acme'));
  });

  it('Get started only for the events that can change it', () => {
    for (const type of [
      'token.created',
      'connector.installed',
      'docs.synced',
      'rate.changed',
    ] as const) {
      expect(staleKeysFor('acme', message(type)), type).toContainEqual(keys.start('acme'));
    }
    for (const type of ['card.moved', 'inbox.received', 'post.updated', 'step.noted'] as const) {
      expect(staleKeysFor('acme', message(type)), type).not.toContainEqual(keys.start('acme'));
    }
  });

  it('the names, the Board and Your turn for a party that was renamed', () => {
    expect(staleKeysFor('acme', message('party.renamed'))).toEqual([
      keys.events('acme'),
      keys.people('acme'),
      keys.board('acme'),
      keys.turn('acme'),
    ]);
  });

  it('who the viewer is for an event about the workspace, whose name the header shows', () => {
    expect(staleKeysFor('acme', message('workspace.updated'))).toEqual([
      keys.events('acme'),
      keys.start('acme'),
      keys.me,
      [...keys.workspace('acme'), 'planning'],
      keys.money('acme'),
    ]);
  });

  it('Money for its own events, a time entry and the assistant’s calls', () => {
    for (const type of [
      'signals.received',
      'plan.changed',
      'cost_line.changed',
      'rate.changed',
      'model_rate.changed',
      'scenario.changed',
      'time_entry.changed',
      'assistant.called',
    ] as const) {
      expect(staleKeysFor('acme', message(type)), type).toContainEqual(keys.money('acme'));
    }
    expect(staleKeysFor('acme', message('card.moved'))).not.toContainEqual(keys.money('acme'));
  });

  it('the views of the Board, the open cards and Your turn for an event of planning', () => {
    for (const type of ['checklist.changed', 'milestone.changed', 'label.changed'] as const) {
      expect(staleKeysFor('acme', message(type)), type).toEqual([
        keys.events('acme'),
        keys.board('acme'),
        keys.cards('acme'),
        keys.turn('acme'),
        [...keys.workspace('acme'), 'planning'],
      ]);
    }
  });

  it('keeps everything of a workspace under one key, for "reset"', () => {
    const prefix = keys.workspace('acme');
    for (const key of [
      keys.projects('acme'),
      keys.projectList('acme', true),
      keys.members('acme'),
      keys.invitations('acme'),
      keys.eventList('acme', { area: 'people' }),
      keys.turn('acme'),
      keys.board('acme'),
      keys.card('acme', testId(30)),
      keys.people('acme'),
    ]) {
      expect(key.slice(0, prefix.length)).toEqual([...prefix]);
    }
    expect(keys.events('other').slice(0, 2)).not.toEqual([...prefix]);
  });
});

describe('Get started on the stream’s word', () => {
  it('reads it at once, then at most once a second, with one read after a burst', async () => {
    vi.useFakeTimers();
    try {
      const client = new QueryClient();
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      const startReads = () =>
        invalidate.mock.calls.filter(
          ([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(keys.start('acme')),
        ).length;
      // Fifty projects made at once.
      for (let index = 0; index < 50; index += 1) {
        applyStreamMessage(client, 'acme', message('project.created'));
      }
      expect(startReads()).toBe(1);
      // Projects are still read for each event.
      expect(
        invalidate.mock.calls.filter(
          ([filters]) =>
            JSON.stringify(filters?.queryKey) === JSON.stringify(keys.projects('acme')),
        ),
      ).toHaveLength(50);
      await vi.advanceTimersByTimeAsync(START_READ_MS);
      expect(startReads()).toBe(2);
      await vi.advanceTimersByTimeAsync(START_READ_MS * 5);
      expect(startReads()).toBe(2);
      // Another workspace has its own pace.
      applyStreamMessage(client, 'globex', message('project.created'));
      expect(
        invalidate.mock.calls.filter(
          ([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(keys.start('globex')),
        ),
      ).toHaveLength(1);
      // Quiet for a second: the next event reads it at once.
      applyStreamMessage(client, 'acme', message('member.joined'));
      expect(startReads()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  eventAreaOf,
  eventAreas,
  eventPageSchema,
  eventSchema,
  eventTypes,
  listEventsQuerySchema,
  streamMessageSchema,
  toStreamMessage,
  type Event,
} from './index.js';

const id = '0192f0c1-7a3e-4b1c-9d2e-4f5a6b7c8d9e';
const at = '2026-11-11T09:30:00.000Z';

const event: Event = {
  seq: 7,
  id,
  workspaceId: id,
  projectId: null,
  at,
  actor: { kind: 'user', id, name: 'Ana Example' },
  via: 'web',
  tokenId: null,
  sessionId: null,
  requestId: id,
  type: 'workspace.updated',
  subject: { type: 'workspace', id },
  data: { name: ['Example', 'Example Co'] },
};

describe('eventSchema', () => {
  it('accepts an event', () => {
    expect(eventSchema.parse(event)).toEqual(event);
  });

  it('accepts the system as actor and a subject that belongs to one person', () => {
    const parsed = eventSchema.parse({
      ...event,
      actor: { kind: 'system', id: '00000000-0000-0000-0000-000000000000', name: 'System' },
      via: 'job',
      subject: { type: 'member', id, owner: { kind: 'user', id } },
    });
    expect(parsed.actor.kind).toBe('system');
    expect(parsed.subject.owner).toEqual({ kind: 'user', id });
  });

  it('rejects a type, a channel or a subject it does not know', () => {
    expect(eventSchema.safeParse({ ...event, type: 'workspace.exploded' }).success).toBe(false);
    expect(eventSchema.safeParse({ ...event, via: 'fax' }).success).toBe(false);
    expect(eventSchema.safeParse({ ...event, subject: { type: 'secret', id } }).success).toBe(
      false,
    );
  });

  it('rejects a seq that is not a positive whole number', () => {
    expect(eventSchema.safeParse({ ...event, seq: 0 }).success).toBe(false);
    expect(eventSchema.safeParse({ ...event, seq: 1.5 }).success).toBe(false);
  });
});

describe('event types', () => {
  it('has the types of every area, and those of routines', () => {
    expect([...eventTypes].sort()).toEqual(
      [
        'import.item',
        // Routines.
        'routine.changed',
        'routine_run.created',
        'routine_run.started',
        'routine_run.finished',
        'routine_run.missed',
        'routine_run.seen',
        'assistant.called',
        'assistant.settings_changed',
        'release.created',
        'release.updated',
        'release.published',
        'release.unpublished',
        'changes.received',
        'inbox.received',
        'inbox.carded',
        'signals.received',
        'signals.removed',
        'spend.committed',
        'spend.dismissed',
        'plan.changed',
        'cost_line.changed',
        'rate.changed',
        'model_rate.changed',
        'scenario.changed',
        'inbox.archived',
        'card.archived',
        'card.created',
        'card.moved',
        'card.status_added',
        'card.updated',
        'party.renamed',
        'card.planned',
        'checklist.changed',
        'milestone.changed',
        'label.changed',
        'epic.changed',
        'view.changed',
        'recurrence.changed',
        'time_entry.changed',
        'build.milestone_changed',
        'access.denied',
        'agent.created',
        'agent.disabled',
        'agent.updated',
        'token.created',
        'token.revoked',
        'token.updated',
        'member.claimed',
        'member.handle_changed',
        'member.invite_revoked',
        'member.invited',
        'member.joined',
        'member.removed',
        'member.role_changed',
        'project.archived',
        'project.created',
        'project.updated',
        'workspace.created',
        'workspace.deleted',
        'workspace.transferred',
        'workspace.updated',
        'workspace.tabs_kept',
        'gate.synced',
        'gate.checked',
        'gate.state_changed',
        'gate.change_held',
        'gate.change_confirmed',
        'gate.file_change_made',
        'gate.file_change_withdrawn',
        'gate.file_change_delivered',
        'listing.synced',
        'listing.row_marked',
        'connector.installed',
        'connector.updated',
        'connector.removed',
        'connector.failed',
        'connector.recovered',
        'build.posted',
        'build.archived',
        'build.testers_changed',
        'step.noted',
        'step.marked',
        'feature.marked',
        'step.replied',
        'feedback.read',
        'asset_group.changed',
        'asset.proposed',
        'asset.changed',
        'asset.decided',
        'asset.decision_cleared',
        'asset.noted',
        'asset.archived',
        'post.created',
        'post.updated',
        'post.submitted',
        'post.approved',
        'post.unapproved',
        'post.skipped',
        'post.restored',
        'post.sending',
        'post.posted',
        'post.unposted',
        'post.failed',
        'decision.proposed',
        'decision.decided',
        'decision.updated',
        'session.started',
        'session.updated',
        'session.needs_you',
        'session.linked',
        'session.ended',
        'session.dismissed',
        'file.uploaded',
        'docs.synced',
        'links.changed',
      ].sort(),
    );
  });

  it('puts every type in exactly one area', () => {
    expect(new Set(eventTypes).size).toBe(eventTypes.length);
    for (const type of eventTypes) {
      expect(eventAreas).toContain(eventAreaOf(type));
    }
    expect(eventAreaOf('project.archived')).toBe('workspace');
    expect(eventAreaOf('member.invited')).toBe('people');
    expect(eventAreaOf('card.status_added')).toBe('board');
    expect(eventAreaOf('party.renamed')).toBe('board');
  });
});

describe('toStreamMessage', () => {
  it('carries the names of the changed fields and none of the values', () => {
    const message = toStreamMessage(event);
    expect(message).toEqual({
      seq: 7,
      type: 'workspace.updated',
      subject: { type: 'workspace', id },
      projectId: null,
      actor: { kind: 'user', id },
      at,
      fields: ['name'],
    });
    expect(JSON.stringify(message)).not.toContain('Example');
    expect(streamMessageSchema.parse(message)).toEqual(message);
  });

  it('the message schema has no place for data or for the name of the actor', () => {
    const message = toStreamMessage(event);
    expect(streamMessageSchema.safeParse({ ...message, data: event.data }).success).toBe(false);
    expect(
      streamMessageSchema.safeParse({ ...message, actor: { ...message.actor, name: 'Ana' } })
        .success,
    ).toBe(false);
  });
});

describe('the event list', () => {
  it('reads its filters from a query string', () => {
    expect(
      listEventsQuerySchema.parse({ area: 'people', before: '120', limit: '10', project: id }),
    ).toEqual({ area: 'people', before: 120, limit: 10, project: id });
    expect(listEventsQuerySchema.parse({})).toEqual({ limit: 50 });
  });

  it('rejects an area it does not know', () => {
    expect(listEventsQuerySchema.safeParse({ area: 'weather' }).success).toBe(false);
  });

  it('pages by seq', () => {
    expect(eventPageSchema.parse({ items: [event], nextBefore: 7 })).toEqual({
      items: [event],
      nextBefore: 7,
    });
    expect(eventPageSchema.parse({ items: [], nextBefore: null }).nextBefore).toBeNull();
  });
});

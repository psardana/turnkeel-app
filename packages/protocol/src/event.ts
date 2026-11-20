import { z } from 'zod';
import { idSchema, timestampSchema } from './ids.js';
import { pageLimitSchema, DEFAULT_PAGE_SIZE } from './pagination.js';
import { actorSchema, principalKinds } from './principal.js';
import { refSchema } from './ref.js';

/**
 * The event types that exist so far, by the area they belong to. A new object adds
 * its types here. The Activity view filters by area.
 */
export const eventTypesByArea = {
  workspace: [
    'workspace.created',
    'workspace.updated',
    'workspace.transferred',
    'workspace.deleted',
    // An Owner or Admin pressed Keep these tabs.
    'workspace.tabs_kept',
    'project.created',
    'project.updated',
    'project.archived',
  ],
  people: [
    'member.invited',
    'member.invite_revoked',
    'member.joined',
    'member.role_changed',
    'member.handle_changed',
    'member.removed',
    // Written by `turnkeel owner claim`, which gives the local owner an address to sign in
    // with, in each workspace they are in.
    'member.claimed',
  ],
  agents: [
    'agent.created',
    'agent.updated',
    'agent.disabled',
    'token.created',
    'token.revoked',
    'token.updated',
    'access.denied',
  ],
  board: [
    'card.created',
    'card.updated',
    'card.moved',
    'card.status_added',
    'card.archived',
    'party.renamed',
  ],
  launch: [
    'gate.synced',
    'gate.checked',
    'gate.state_changed',
    'gate.change_held',
    'gate.change_confirmed',
    // A gate made or edited in the app waits as a file change until a sync brings it.
    'gate.file_change_made',
    'gate.file_change_withdrawn',
    'gate.file_change_delivered',
    'listing.synced',
    'listing.row_marked',
  ],
  testing: [
    'build.posted',
    'build.archived',
    'build.testers_changed',
    'build.milestone_changed',
    'step.noted',
    'step.marked',
    'feature.marked',
    'step.replied',
    'feedback.read',
  ],
  review: [
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
  ],
  decisions: ['decision.proposed', 'decision.decided', 'decision.updated'],
  releases: [
    'release.created',
    'release.updated',
    'release.published',
    'release.unpublished',
    'changes.received',
  ],
  inbox: ['inbox.received', 'inbox.carded', 'inbox.archived'],
  money: [
    'signals.received',
    'signals.removed',
    'plan.changed',
    'cost_line.changed',
    'rate.changed',
    'model_rate.changed',
    'scenario.changed',
    // spend:commit: an agent's spend on a person's word, and an Owner
    // clearing the line of one that was refused for the cap.
    'spend.committed',
    'spend.dismissed',
  ],
  sessions: [
    'session.started',
    'session.updated',
    'session.needs_you',
    'session.linked',
    'session.ended',
    'session.dismissed',
  ],
  files: ['file.uploaded'],
  docs: ['docs.synced', 'links.changed'],
  connectors: [
    'connector.installed',
    'connector.updated',
    'connector.removed',
    'connector.failed',
    'connector.recovered',
  ],
  assistant: ['assistant.called', 'assistant.settings_changed'],
  planning: [
    'card.planned',
    'checklist.changed',
    'milestone.changed',
    'label.changed',
    // Epics: made, proposed, changed, accepted, dropped or removed.
    'epic.changed',
    'view.changed',
    'recurrence.changed',
    'time_entry.changed',
  ],
  // Routines: a routine made, changed, paused, resumed or removed;
  // a run made by the job, started and finished by its agent, missed, and seen by a person.
  routines: [
    'routine.changed',
    'routine_run.created',
    'routine_run.started',
    'routine_run.finished',
    'routine_run.missed',
    'routine_run.seen',
  ],
  // One event for each row the importer writes, with the system as actor and
  // `via: cli`. Its subject is the new row, named as the ordinary events of that row name
  // it, and `data.object` says which kind of row it is.
  import: ['import.item'],
} as const;

export type EventArea = keyof typeof eventTypesByArea;

export const eventAreas = Object.keys(eventTypesByArea) as [EventArea, ...EventArea[]];

export type EventType = (typeof eventTypesByArea)[EventArea][number];

export const eventTypes = Object.values(eventTypesByArea).flat() as [EventType, ...EventType[]];

/** The area an event type belongs to. */
export function eventAreaOf(type: EventType): EventArea {
  for (const area of eventAreas) {
    if ((eventTypesByArea[area] as readonly string[]).includes(type)) return area;
  }
  throw new Error(`Unknown event type: ${type}`);
}

/**
 * The channel a write came through. `web` is a person's session, `cli` a
 * bearer call from the CLI, `rest` any other bearer call, `mcp` and `hook` the calls
 * to `/mcp` and `/hooks/*`, and `connector` and `job` the system.
 */
export const eventVias = ['web', 'rest', 'mcp', 'cli', 'hook', 'connector', 'job'] as const;

export type EventVia = (typeof eventVias)[number];

/** What an event can be about, so far. A step that adds an object adds its type here. */
export const subjectTypes = [
  'workspace',
  'project',
  'member',
  'project_member',
  'invitation',
  'agent',
  'token',
  'card',
  'party',
  'session',
  'build',
  'feature',
  'step',
  'gate',
  // A pending file change of a gate made or edited in the app.
  'gate_file_change',
  'listing',
  'connector_install',
  'asset',
  'asset_group',
  'post',
  'decision',
  'file',
  'milestone',
  'label',
  'epic',
  'saved_view',
  'recurrence_rule',
  'time_entry',
  'release',
  'inbox_item',
  'plan',
  'cost_line',
  'scenario',
  'link_group',
  'link',
  // A spend of spend:commit.
  'spend',
  // Routines and their runs.
  'routine',
  'routine_run',
] as const;

export type SubjectType = (typeof subjectTypes)[number];

/**
 * What an event is about. `owner` is set when the subject belongs to one person, such
 * as a tester's note; the stream uses it to keep one tester's notes from another.
 */
export const eventSubjectSchema = z.strictObject({
  type: z.enum(subjectTypes),
  id: idSchema,
  owner: refSchema.optional(),
});

export type EventSubject = z.infer<typeof eventSubjectSchema>;

/**
 * What changed: `{ field: [before, after] }` for an update, the new values for a
 * creation. It never holds a secret, a token, a token's hash or a sign-in link.
 */
export const eventDataSchema = z.record(z.string(), z.unknown());

export type EventData = z.infer<typeof eventDataSchema>;

/** One row of the event log. `(workspaceId, seq)` is unique, and `seq` order is commit order. */
export const eventSchema = z.strictObject({
  seq: z.number().int().positive(),
  id: idSchema,
  workspaceId: idSchema,
  projectId: idSchema.nullable(),
  at: timestampSchema,
  actor: actorSchema,
  via: z.enum(eventVias),
  tokenId: idSchema.nullable(),
  sessionId: idSchema.nullable(),
  requestId: idSchema,
  type: z.enum(eventTypes),
  subject: eventSubjectSchema,
  data: eventDataSchema,
});

export type Event = z.infer<typeof eventSchema>;

/**
 * The data of one `event: change` message on the stream. `fields` are the
 * names of what changed, never the values, and `actor` carries no name.
 */
export const streamMessageSchema = z.strictObject({
  seq: z.number().int().positive(),
  type: z.enum(eventTypes),
  subject: eventSubjectSchema,
  projectId: idSchema.nullable(),
  /** Who acted. A Tester's stream names the actor of a Testing event by kind alone. */
  actor: z.strictObject({ kind: z.enum(principalKinds), id: idSchema.optional() }),
  at: timestampSchema,
  fields: z.array(z.string()),
});

export type StreamMessage = z.infer<typeof streamMessageSchema>;

/**
 * The message a stream carries for an event: the names of the changed fields and no
 * values. With `actorId: false` the actor is named by kind alone.
 */
export function toStreamMessage(event: Event, options: { actorId?: boolean } = {}): StreamMessage {
  return {
    seq: event.seq,
    type: event.type,
    subject: event.subject,
    projectId: event.projectId,
    actor:
      options.actorId === false
        ? { kind: event.actor.kind }
        : { kind: event.actor.kind, id: event.actor.id },
    at: event.at,
    fields: Object.keys(event.data),
  };
}

/** When a client is this many events behind, the stream sends `event: reset` instead of
 * replaying. */
export const STREAM_REPLAY_LIMIT = 1000;

/**
 * The query of `GET /workspaces/:ws/events`. The list is newest first
 * and pages by `seq`: `before` is the lowest `seq` of the page before.
 */
export const listEventsQuerySchema = z.strictObject({
  project: idSchema.optional(),
  area: z.enum(eventAreas).optional(),
  actor: idSchema.optional(),
  subject: idSchema.optional(),
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: pageLimitSchema.default(DEFAULT_PAGE_SIZE),
});

export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

/** One page of events, newest first. `nextBefore` is null when there is nothing older. */
export const eventPageSchema = z.strictObject({
  items: z.array(eventSchema),
  nextBefore: z.number().int().positive().nullable(),
});

export type EventPage = z.infer<typeof eventPageSchema>;

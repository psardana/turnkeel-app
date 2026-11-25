import { queryOptions, type QueryClient } from '@tanstack/react-query';
import {
  eventPageSchema,
  invitationSchema,
  meSchema,
  projectSchema,
  serverInfoSchema,
  workspacePersonSchema,
  type Me,
  type StreamMessage,
} from '@turnkeel/protocol';
import { z } from 'zod';
import { api, ApiError, seg } from './api';

/** The filters of the Activity view as the server takes them. */
export interface EventFilters {
  project?: string | undefined;
  area?: string | undefined;
  actor?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  /** The item the events are about, such as a card's id (its History). */
  subject?: string | undefined;
}

/**
 * Query keys. Everything a workspace holds is under `['ws', slug]`, so one call
 * refetches all of it when the stream says `reset`.
 */
export const keys = {
  server: ['server'] as const,
  me: ['me'] as const,
  passkeys: ['passkeys'] as const,
  workspace: (ws: string) => ['ws', ws] as const,
  projects: (ws: string) => ['ws', ws, 'projects'] as const,
  projectList: (ws: string, archived: boolean) => ['ws', ws, 'projects', { archived }] as const,
  members: (ws: string) => ['ws', ws, 'members'] as const,
  invitations: (ws: string) => ['ws', ws, 'invitations'] as const,
  events: (ws: string) => ['ws', ws, 'events'] as const,
  eventList: (ws: string, filters: EventFilters) => ['ws', ws, 'events', filters] as const,
  /** Every answer of `GET /workspaces/:ws/turn`: the lines, the groups and the counts. */
  turn: (ws: string) => ['ws', ws, 'turn'] as const,
  /** Every Board of the workspace, of any project and filter. */
  board: (ws: string) => ['ws', ws, 'board'] as const,
  /** Every open card of the workspace that a page has read. */
  cards: (ws: string) => ['ws', ws, 'card'] as const,
  card: (ws: string, id: string) => ['ws', ws, 'card', id.toLowerCase()] as const,
  /** The names of people, agents and parties. */
  people: (ws: string) => ['ws', ws, 'people'] as const,
  /** Every build of the workspace a page has read, and the lists of builds. */
  builds: (ws: string) => ['ws', ws, 'builds'] as const,
  /** Launch of every project: its answer, its gates and its listings. */
  launch: (ws: string) => ['ws', ws, 'launch'] as const,
  /** Review of every project: its assets and its posts. */
  review: (ws: string) => ['ws', ws, 'review'] as const,
  /** The Decisions log of every scope, and the decisions read one by one. */
  decisions: (ws: string) => ['ws', ws, 'decisions'] as const,
  /** Releases of every project, and their Changes. */
  releases: (ws: string) => ['ws', ws, 'releases'] as const,
  /** The Inbox of every project, and the items read one by one. */
  inbox: (ws: string) => ['ws', ws, 'inbox'] as const,
  /** Money of every project. */
  money: (ws: string) => ['ws', ws, 'money'] as const,
  /** The docs of every project, and the docs read one by one. */
  docs: (ws: string) => ['ws', ws, 'docs'] as const,
  /** The link groups of every project and of the workspace. */
  links: (ws: string) => ['ws', ws, 'links'] as const,
  /** The connector installs of the workspace. */
  connectors: (ws: string) => ['ws', ws, 'connectors'] as const,
  /** Whether the assistant is available, and its settings under it. */
  assistant: (ws: string) => ['ws', ws, 'assistant'] as const,
  assistantSettings: (ws: string) => ['ws', ws, 'assistant', 'settings'] as const,
  /** Get started of every project: its steps follow almost any change. */
  start: (ws: string) => ['ws', ws, 'start'] as const,
};

/** What this server offers. It does not change while the server runs. */
export const serverQuery = queryOptions({
  queryKey: keys.server,
  queryFn: ({ signal }) => api('GET', '/server', serverInfoSchema, { signal }),
  staleTime: Infinity,
});

/** Who is signed in, or null when nobody is. */
export const meQuery = queryOptions({
  queryKey: keys.me,
  queryFn: async ({ signal }): Promise<Me | null> => {
    try {
      return await api('GET', '/me', meSchema, { signal });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  staleTime: 30_000,
});

export const projectsQuery = (ws: string, archived = false) =>
  queryOptions({
    queryKey: keys.projectList(ws, archived),
    queryFn: ({ signal }) =>
      api(
        'GET',
        `/workspaces/${seg(ws)}/projects${archived ? '?archived=true' : ''}`,
        z.array(projectSchema),
        { signal },
      ),
  });

/** One project, by its key or its slug. An archived one is found too. */
export const projectQuery = (ws: string, project: string) =>
  queryOptions({
    queryKey: [...keys.projects(ws), 'one', project.toLowerCase()] as const,
    queryFn: ({ signal }) =>
      api('GET', `/workspaces/${seg(ws)}/projects/${seg(project)}`, projectSchema, { signal }),
  });

export const membersQuery = (ws: string) =>
  queryOptions({
    queryKey: keys.members(ws),
    queryFn: ({ signal }) =>
      api('GET', `/workspaces/${seg(ws)}/members`, z.array(workspacePersonSchema), { signal }),
  });

export const invitationsQuery = (ws: string) =>
  queryOptions({
    queryKey: keys.invitations(ws),
    queryFn: ({ signal }) =>
      api('GET', `/workspaces/${seg(ws)}/invitations`, z.array(invitationSchema), { signal }),
  });

/** How many events one page of the Activity view asks for. */
export const EVENT_PAGE_SIZE = 50;

/** One page of events, newest first. `before` is the `nextBefore` of the page before it. */
export function fetchEvents(
  ws: string,
  filters: EventFilters,
  before: number | null,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (typeof value === 'string' && value !== '') query.set(name, value);
  }
  if (before !== null) query.set('before', String(before));
  query.set('limit', String(EVENT_PAGE_SIZE));
  return api('GET', `/workspaces/${seg(ws)}/events?${query.toString()}`, eventPageSchema, {
    signal,
  });
}

/** The objects whose events change what Get started says. */
const startObjects = [
  'workspace',
  'project',
  'member',
  'agent',
  'token',
  'gate',
  'listing',
  'docs',
  'connector',
  'import',
  'signals',
  'rate',
  'assistant',
];

/**
 * What a stream message makes stale. A message names what
 * changed and carries no values, so the app reads the new values through the ordinary
 * reads.
 */
export function staleKeysFor(ws: string, message: StreamMessage): (readonly unknown[])[] {
  const stale: (readonly unknown[])[] = [keys.events(ws)];
  const [object] = message.type.split('.');
  // Get started reads the workspace, its projects, people, agents and tokens,
  // the launch plan, installs, imports, amounts, rates and the assistant: only their
  // events make it stale, so a busy Board or Inbox does not read it again and again.
  if (startObjects.includes(object ?? '')) stale.push(keys.start(ws));
  if (object === 'project') stale.push(keys.projects(ws), keys.turn(ws), keys.board(ws));
  if (object === 'member') {
    stale.push(keys.members(ws), keys.invitations(ws), keys.me, keys.people(ws), keys.turn(ws));
  }
  if (object === 'workspace') stale.push(keys.me);
  // A card changed: the lines and counts of Your turn, the Board, and the open card.
  // Its blockers and the cards it unblocks show its
  // turn too, so every open card is read again.
  if (object === 'card') {
    stale.push(keys.turn(ws), keys.board(ws), keys.cards(ws), keys.launch(ws));
  }
  // A gate or a listing changed: Launch and the Gate and Listing lines.
  if (object === 'gate' || object === 'listing') stale.push(keys.launch(ws), keys.turn(ws));
  // An asset, its group or a post changed: Review and the Asset and Post lines of Your
  // turn. A post is also a row of By hand and an entry of the Calendar.
  if (object === 'asset' || object === 'asset_group' || object === 'post') {
    stale.push(keys.review(ws), keys.turn(ws));
  }
  if (object === 'post') stale.push(keys.launch(ws), [...keys.workspace(ws), 'planning']);
  // An install changed or ran: the Connectors screen, and when Launch's checks last ran.
  // An install of the outbound webhook decides whether a post is sent or marked posted.
  // The Inbox names its sources with when each last ran, and Releases whether the project
  // has a `github` install.
  if (object === 'connector') {
    stale.push(
      keys.connectors(ws),
      keys.launch(ws),
      keys.review(ws),
      keys.inbox(ws),
      keys.releases(ws),
    );
  }
  // Decisions and the Inbox: their tabs and their lines of Your turn.
  if (object === 'decision') stale.push(keys.decisions(ws), keys.turn(ws));
  if (object === 'inbox') stale.push(keys.inbox(ws), keys.turn(ws));
  // A release, or the pull requests a connector brought in. A release's lanes
  // make its Release line of Your turn.
  if (object === 'release' || object === 'changes') stale.push(keys.releases(ws));
  if (object === 'release') stale.push(keys.turn(ws));

  // A card created or moved with `party:Name`, a decision, or a gate sync whose file names
  // a new party made one; its name is in the people list, which would
  // otherwise show "A party" until the page is reloaded.
  if (
    (object === 'card' || object === 'gate' || object === 'decision') &&
    message.fields.includes('partiesCreated')
  ) {
    stale.push(keys.people(ws));
  }
  // A party's name shows on tiles, lines and fields.
  if (object === 'party') stale.push(keys.people(ws), keys.board(ws), keys.turn(ws));
  // A session changed: the Agents tab and the Session lines of Your turn.
  if (object === 'session') stale.push([...keys.workspace(ws), 'sessions'], keys.turn(ws));
  // A build, a feature, a step or its feedback changed: Testing and the Steps lines of
  // Your turn. A Tester's stream carries only what they may read (9.3).
  if (['build', 'feature', 'step', 'feedback'].includes(object ?? '')) {
    stale.push(keys.builds(ws), keys.turn(ws));
  }
  // An agent or a token changed: Agents and tokens, and the names of agents.
  if (object === 'agent' || object === 'token') {
    stale.push([...keys.workspace(ws), 'agents'], keys.people(ws));
  }
  // Planning: its own events make the Board's views, the settings of planning,
  // the open cards and Your turn stale. What the views also show (cards, gates, builds,
  // a project's launch date, the switches) makes them stale after the rest.
  if (planningObjects.includes(object ?? '') || message.type === 'build.milestone_changed') {
    stale.push(keys.board(ws), keys.cards(ws), keys.turn(ws));
  }
  if (
    planningObjects.includes(object ?? '') ||
    ['card', 'gate', 'build', 'project', 'workspace'].includes(object ?? '')
  ) {
    stale.push([...keys.workspace(ws), 'planning']);
  }
  // Money: its own events, a connector's run, a workspace's currency, the
  // assistant's calls and hours, which it shows beside the figures.
  if (
    ['signals', 'plan', 'cost_line', 'rate', 'model_rate', 'scenario', 'connector'].includes(
      object ?? '',
    ) ||
    message.type === 'workspace.updated' ||
    message.type === 'assistant.called' ||
    object === 'time_entry'
  ) {
    stale.push(keys.money(ws));
  }
  // Docs and Links: a sync of the docs, and a change of a group or a link.
  if (object === 'docs') stale.push(keys.docs(ws));
  if (object === 'links') stale.push(keys.links(ws));
  // The assistant's settings changed: whether to draw its controls.
  if (message.type === 'assistant.settings_changed') stale.push(keys.assistant(ws));
  return stale;
}

/** The first word of the types of planning's own events. */
const planningObjects = [
  'checklist',
  'milestone',
  'label',
  'epic',
  'view',
  'recurrence',
  'time_entry',
];

/** Refetches what a stream message made stale. */
export function applyStreamMessage(client: QueryClient, ws: string, message: StreamMessage): void {
  const start = JSON.stringify(keys.start(ws));
  for (const queryKey of staleKeysFor(ws, message)) {
    if (JSON.stringify(queryKey) === start) readStartAgain(client, ws);
    else void client.invalidateQueries({ queryKey });
  }
}

/** The shortest time between two reads of Get started on the stream's word. */
export const START_READ_MS = 1000;

/**
 * Get started is worked out on the server from a dozen counts, and many events can
 * change it. A burst of them, such as an import or a script that makes
 * fifty projects, would read it again for each, cancelling the read before; so it is read
 * at most once a second, and once more after the last event of a burst.
 */
function readStartAgain(client: QueryClient, ws: string): void {
  let byWorkspace = startReads.get(client);
  if (!byWorkspace) {
    byWorkspace = new Map();
    startReads.set(client, byWorkspace);
  }
  const entry = byWorkspace.get(ws) ?? { last: -Infinity, timer: null };
  byWorkspace.set(ws, entry);
  if (entry.timer !== null) return;
  const read = () => {
    entry.timer = null;
    entry.last = Date.now();
    void client.invalidateQueries({ queryKey: keys.start(ws) });
  };
  const wait = entry.last + START_READ_MS - Date.now();
  if (wait <= 0) read();
  else entry.timer = setTimeout(read, wait);
}

/** After `event: reset`: the app refetches everything it shows of the workspace. */
export function applyStreamReset(client: QueryClient, ws: string): void {
  void client.invalidateQueries({ queryKey: keys.workspace(ws) });
  void client.invalidateQueries({ queryKey: keys.me });
}

import {
  agentKinds,
  decisionStatuses,
  gateStates,
  inboxSources,
  roles,
  sessionStates,
  type Event,
  type Project,
  type Role,
} from '@turnkeel/protocol';
import { messages } from '@/messages';

/** Where the item of a line leads. */
export type ItemLink =
  | { kind: 'project'; key: string }
  | { kind: 'members' }
  | { kind: 'settings' }
  | { kind: 'card'; key: string }
  | { kind: 'agents' }
  /** A decision in the Decisions log. */
  | { kind: 'decision'; id: string }
  /** A release, or an inbox item, of a project. */
  | { kind: 'release'; project: string; id: string }
  | { kind: 'inbox'; project: string; id: string }
  /** The docs of a project, and the links of a project or of the workspace. */
  | { kind: 'docs'; project: string }
  | { kind: 'links'; project: string | null }
  /** Settings, Routines. */
  | { kind: 'routines' };

/** One line of the Activity view, without its actor: words, the item as a link, more words. */
export interface Described {
  before: string;
  item: { label: string; link: ItemLink | null } | null;
  after: string;
}

/** What is needed to name the things an event points at. */
export interface DescribeContext {
  workspaceName: string;
  /** Every project of the workspace the viewer can see, archived ones included, by id. */
  projects: ReadonlyMap<string, Project>;
  /** People by user id, when the viewer may read the member list. */
  people: ReadonlyMap<string, string>;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const role = (value: unknown): Role | null =>
  typeof value === 'string' && (roles as readonly string[]).includes(value)
    ? (value as Role)
    : null;

/** An update carries `[before, after]`; a creation carries the value. */
const change = (value: unknown): [unknown, unknown] =>
  Array.isArray(value) && value.length === 2 ? [value[0], value[1]] : [null, value];

/** `value` when it is one of `options`, else null. */
const oneOf = <T extends string>(options: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : null;

/**
 * Says what an event did, in the words of the catalogue. Event data is read
 * defensively: a field that is missing or has another shape leaves a shorter sentence.
 * An agent's action on a person's word ends with "on <person>'s
 * word", whatever its type; the actor of the line is the agent.
 */
export function describeEvent(event: Event, context: DescribeContext): Described {
  const described = describeWhat(event, context);
  const onWordOf = event.data.onWordOf;
  // decision.decided says it in its own words.
  if (event.type === 'decision.decided' || typeof onWordOf !== 'object' || onWordOf === null) {
    return described;
  }
  const id = text((onWordOf as { id?: unknown }).id);
  const person = (id === null ? undefined : context.people.get(id)) ?? messages.activity.aPerson;
  const after = [described.after, messages.activity.onWordOf(person)].filter(Boolean).join(' ');
  return { ...described, after };
}

function describeWhat(event: Event, context: DescribeContext): Described {
  const { data } = event;
  const sentences = messages.activity.event;

  const project = event.projectId === null ? undefined : context.projects.get(event.projectId);
  const projectName = project?.name ?? text(data.name) ?? null;
  const projectItem = () => {
    const key = project?.key ?? text(data.key);
    return {
      label: projectName ?? messages.activity.aProject,
      link: key === null ? null : ({ kind: 'project', key } as const),
    };
  };
  const workspaceItem = { label: context.workspaceName, link: { kind: 'settings' } as const };
  const person = (userId: unknown, handle?: unknown) => {
    const id = text(userId);
    const known = id === null ? undefined : context.people.get(id);
    const fallback = text(handle);
    return {
      label: known ?? (fallback === null ? messages.activity.aPerson : `@${fallback}`),
      link: { kind: 'members' } as const,
    };
  };
  /** An agent, by its name in the event. */
  const agentItem = (name: unknown) => ({
    label: text(name) ?? messages.activity.anAgent,
    link: null,
  });
  /** The project a people event is about, by name, or null for the whole workspace. */
  const inProject = event.projectId === null ? null : (projectName ?? messages.activity.theProject);

  switch (event.type) {
    case 'workspace.created':
      return { ...sentences['workspace.created'](), item: workspaceItem };
    case 'workspace.updated':
      return { ...sentences['workspace.updated'](Object.keys(data)), item: workspaceItem };
    case 'workspace.transferred':
      return {
        ...sentences['workspace.transferred'](person(data.to).label),
        item: workspaceItem,
      };
    case 'workspace.deleted':
      return { ...sentences['workspace.deleted'](), item: workspaceItem };
    case 'workspace.tabs_kept': {
      // An event of before the six tabs names Review and Agents, which are no tabs now.
      const names: Record<string, string> = {
        ...messages.onboarding.tabNames,
        ...messages.activity.oldTabNames,
      };
      const off = Array.isArray(data.off)
        ? data.off.flatMap((tab) => (typeof tab === 'string' ? [names[tab] ?? tab] : []))
        : [];
      return { ...sentences['workspace.tabs_kept'](off), item: workspaceItem };
    }

    case 'project.created':
      return { ...sentences['project.created'](), item: projectItem() };
    case 'project.updated':
      return { ...sentences['project.updated'](Object.keys(data)), item: projectItem() };
    case 'project.archived':
      return { ...sentences['project.archived'](), item: projectItem() };

    case 'member.invited':
      return {
        ...sentences['member.invited']({ role: role(data.role), project: inProject }),
        item: { label: text(data.email) ?? messages.activity.someone, link: { kind: 'members' } },
      };
    case 'member.invite_revoked':
      return {
        ...sentences['member.invite_revoked'](data.reason === 'replaced'),
        item: { label: text(data.email) ?? messages.activity.someone, link: { kind: 'members' } },
      };
    case 'member.joined': {
      const self = data.userId === event.actor.id;
      return {
        ...sentences['member.joined']({ self, role: role(data.role), project: inProject }),
        item: self ? null : person(data.userId, data.handle),
      };
    }
    case 'member.role_changed': {
      const [from, to] = change(data.role);
      return {
        ...sentences['member.role_changed']({ from: role(from), to: role(to), project: inProject }),
        item: person(data.userId),
      };
    }
    case 'member.handle_changed': {
      const [from, to] = change(data.handle);
      return {
        ...sentences['member.handle_changed']({ from: text(from), to: text(to) }),
        item: null,
      };
    }
    case 'member.claimed':
      return { ...sentences['member.claimed'](), item: person(data.userId, data.handle) };
    case 'member.removed':
      return {
        ...sentences['member.removed'](inProject),
        item: person(data.userId, data.handle),
      };

    case 'agent.created':
      return { ...sentences['agent.created'](), item: agentItem(change(data.name)[1]) };
    case 'agent.updated':
      return {
        ...sentences['agent.updated'](Object.keys(data)),
        item: agentItem(change(data.name)[1]),
      };
    case 'agent.disabled':
      return { ...sentences['agent.disabled'](), item: agentItem(data.name) };
    case 'token.created':
      return { ...sentences['token.created'](text(data.prefix)), item: null };
    case 'token.revoked':
      return {
        ...sentences['token.revoked']({ prefix: text(data.prefix), reason: text(data.reason) }),
        item: null,
      };
    case 'token.updated': {
      // The opt-in scopes turned on and off, as [before, after].
      const [before, after] = Array.isArray(data.optInScopes)
        ? (data.optInScopes as unknown[][])
        : [[], []];
      const names = (list: unknown[] | undefined) =>
        (list ?? []).filter((one): one is string => typeof one === 'string');
      // The standard scopes, as [before, after], when they changed.
      const [standardBefore, standardAfter] = Array.isArray(data.scopes)
        ? (data.scopes as unknown[][])
        : [[], []];
      const added = (from: unknown[] | undefined, to: unknown[] | undefined) =>
        names(to).filter((one) => !names(from).includes(one));
      // The monthly cap of spend:commit, as [before, after], when it changed.
      const cap = Array.isArray(data.spendCap) ? (data.spendCap as unknown[])[1] : undefined;
      const capAfter =
        typeof cap === 'object' &&
        cap !== null &&
        typeof (cap as { amount?: unknown }).amount === 'number' &&
        typeof (cap as { currency?: unknown }).currency === 'string'
          ? (cap as { amount: number; currency: string })
          : null;
      // The preset the token follows, as [before, after], when it changed, and the
      // preset whose new scopes the system gave it at a start.
      const presetName = (value: unknown) =>
        value === 'reporter' || value === 'builder' ? value : null;
      const presetAfter = Array.isArray(data.preset)
        ? presetName((data.preset as unknown[])[1])
        : undefined;
      return {
        ...sentences['token.updated']({
          prefix: text(data.prefix),
          on: [...added(standardBefore, standardAfter), ...added(before, after)],
          off: [...added(standardAfter, standardBefore), ...added(after, before)],
          spendCap: capAfter === null ? null : formatAmount(capAfter.amount, capAfter.currency),
          ...(presetAfter === undefined ? {} : { preset: presetAfter }),
          follows: presetName(data.followsPreset),
        }),
        item: null,
      };
    }
    case 'access.denied':
      return {
        ...sentences['access.denied']({
          action: text(data.action),
          rule: text(data.rule),
          repeats: typeof data.repeats === 'number' ? data.repeats : 0,
        }),
        item: null,
      };

    case 'card.created':
    case 'card.updated':
    case 'card.moved':
    case 'card.status_added':
    case 'card.archived': {
      // Only the creation names the card's number; the other events name it by id.
      const key = text(data.key);
      const words = {
        'card.created': messages.activity.card.created,
        'card.updated': messages.activity.card.updated,
        'card.moved': messages.activity.card.moved,
        // A line saved from a suggestion says so in words.
        'card.status_added':
          text(data.draft) === null
            ? messages.activity.card.statusAdded
            : messages.activity.card.statusAddedDrafted,
        'card.archived': messages.activity.card.archived,
      }[event.type];
      return {
        before:
          key === null ? words.replace(/the card$/, '') + messages.activity.card.aCard : words,
        item: key === null ? null : { label: key, link: { kind: 'card', key } },
        after: '',
      };
    }
    case 'party.renamed': {
      const [from, to] = change(data.name);
      return {
        before: messages.activity.card.partyRenamed(text(from), text(to)),
        item: null,
        after: '',
      };
    }

    // Agent sessions: named by their title, linked to Agent sessions in Settings.
    case 'session.started':
    case 'session.updated':
    case 'session.needs_you':
    case 'session.linked':
    case 'session.ended':
    case 'session.dismissed': {
      const verbs = messages.activity.verb;
      const words =
        event.type === 'session.started'
          ? verbs['session.started'](oneOf(agentKinds, data.tool))
          : event.type === 'session.updated'
            ? verbs['session.updated']({
                state: oneOf(sessionStates, change(data.state)[1]),
                renamed: 'title' in data,
              })
            : event.type === 'session.linked'
              ? verbs['session.linked'](
                  'cardId' in data
                    ? 'card'
                    : 'gateId' in data
                      ? 'gate'
                      : 'buildId' in data
                        ? 'build'
                        : null,
                )
              : verbs[event.type]();
      return itemLine(
        messages.activity.noun.session,
        nameAfter(data.title),
        { kind: 'agents' },
        words,
      );
    }

    // Gates: named by their title, which only a creation or a new title carries.
    case 'gate.synced': {
      const [removedBefore, removedAfter] = Array.isArray(data.removedAt)
        ? change(data.removedAt)
        : [null, null];
      const how =
        data.created === true
          ? 'added'
          : removedAfter !== null && removedAfter !== undefined
            ? 'removed'
            : removedBefore !== null && removedBefore !== undefined
              ? 'restored'
              : 'changed';
      const words = messages.activity.verb['gate.synced'](
        how,
        changedFields(data, ['commit', 'branch', 'partiesCreated', 'removedAt']),
      );
      return itemLine(messages.activity.noun.gate, nameAfter(data.title), null, words);
    }
    case 'gate.checked':
      return itemLine(
        messages.activity.noun.gate,
        null,
        null,
        messages.activity.verb['gate.checked'](oneOf(['pass', 'fail'], data.result)),
      );
    case 'gate.state_changed':
      return itemLine(
        messages.activity.noun.gate,
        null,
        null,
        messages.activity.verb['gate.state_changed'](oneOf(gateStates, change(data.state)[1])),
      );
    case 'gate.change_held':
      return itemLine(
        messages.activity.noun.gate,
        null,
        null,
        messages.activity.verb['gate.change_held'](data.remove === true),
      );
    case 'gate.change_confirmed':
      return itemLine(
        messages.activity.noun.gate,
        null,
        null,
        messages.activity.verb['gate.change_confirmed'](data.removed === true),
      );

    // A gate made in the app: named by the key of the gate it made or edited.
    case 'gate.file_change_made':
      return itemLine(
        messages.activity.noun.gate,
        text(data.key),
        null,
        messages.activity.verb['gate.file_change_made'](data.made === true),
      );
    case 'gate.file_change_withdrawn':
    case 'gate.file_change_delivered': {
      const keys = Array.isArray(data.keys)
        ? data.keys.filter((key) => typeof key === 'string')
        : [];
      return itemLine(
        messages.activity.noun.gate,
        keys.length === 0 ? null : keys.join(', '),
        null,
        messages.activity.verb[event.type](),
      );
    }

    // Listings: named by their key, which every sync carries when it adds one.
    case 'listing.synced': {
      const [removedBefore, removedAfter] = Array.isArray(data.removedAt)
        ? change(data.removedAt)
        : [null, null];
      const how =
        data.created === true
          ? 'added'
          : removedAfter !== null && removedAfter !== undefined
            ? 'removed'
            : removedBefore !== null && removedBefore !== undefined
              ? 'restored'
              : 'changed';
      const untick = Array.isArray(data.untick) ? data.untick.length : 0;
      return itemLine(
        messages.activity.noun.listing,
        text(data.key),
        null,
        messages.activity.verb['listing.synced'](how, untick),
      );
    }
    case 'listing.row_marked':
      return itemLine(
        messages.activity.noun.listing,
        null,
        null,
        messages.activity.verb['listing.row_marked'](text(data.row), data.done === true),
      );

    // Connector installs: named by their name. A secret is never in an event.
    case 'connector.installed':
      return itemLine(
        messages.activity.noun.install,
        text(data.name),
        null,
        messages.activity.verb['connector.installed'](text(data.connector)),
      );
    case 'connector.updated':
      return itemLine(
        messages.activity.noun.install,
        text(data.name),
        null,
        messages.activity.verb['connector.updated']({
          disabled: typeof data.disabled === 'boolean' ? data.disabled : null,
          changed: Array.isArray(data.changed)
            ? data.changed.filter((name): name is string => typeof name === 'string')
            : [],
        }),
      );
    case 'connector.removed':
    case 'connector.failed':
    case 'connector.recovered':
      return itemLine(
        messages.activity.noun.install,
        text(data.name),
        null,
        messages.activity.verb[event.type](),
      );

    // Builds, their steps and features, and the feedback an agent read.
    case 'build.posted': {
      const scenario = data.scenario as { change?: unknown } | undefined;
      const change = scenario?.change;
      return itemLine(
        messages.activity.noun.build,
        text(data.title) ?? text(data.key),
        null,
        change === 'added' || change === 'changed' || change === 'removed'
          ? messages.activity.verb.scenario(change)
          : messages.activity.verb['build.posted'](data.created === false),
      );
    }
    case 'build.archived':
    case 'build.testers_changed':
    case 'feedback.read':
      return itemLine(
        messages.activity.noun.build,
        null,
        null,
        messages.activity.verb[event.type](),
      );
    case 'step.noted':
      return { before: messages.activity.step.noted, item: null, after: '' };
    case 'step.marked':
    case 'feature.marked': {
      const done = change(data.done)[1];
      const said = typeof done === 'boolean' ? done : null;
      return {
        before:
          event.type === 'step.marked'
            ? messages.activity.step.marked(said)
            : messages.activity.step.featureMarked(said),
        item: null,
        after: '',
      };
    }
    case 'step.replied':
      return { before: messages.activity.step.replied, item: null, after: '' };

    // Assets and their groups.
    case 'asset_group.changed':
      return itemLine(
        messages.activity.noun.asset_group,
        nameAfter(data.title) ?? text(data.key),
        null,
        messages.activity.verb['asset_group.changed']({
          created: data.created === true,
          fields: changedFields(data, ['created']),
        }),
      );
    case 'asset.proposed':
    case 'asset.changed':
      return itemLine(
        messages.activity.noun.asset,
        text(data.title) ?? text(data.key),
        null,
        messages.activity.verb[event.type](),
      );
    case 'asset.decided':
      return itemLine(
        messages.activity.noun.asset,
        null,
        null,
        messages.activity.verb['asset.decided'](
          oneOf(['waiting', 'approved', 'changes'], change(data.status)[1]),
        ),
      );
    case 'asset.decision_cleared':
    case 'asset.noted':
    case 'asset.archived':
      return itemLine(
        messages.activity.noun.asset,
        null,
        null,
        messages.activity.verb[event.type](),
      );

    // Posts, named by their title or else their channel. What a post says is not
    // shown here.
    case 'post.created':
    case 'post.submitted':
    case 'post.approved':
    case 'post.unapproved':
    case 'post.skipped':
    case 'post.restored':
    case 'post.sending':
    case 'post.unposted':
    case 'post.failed':
      return itemLine(
        messages.activity.noun.post,
        nameAfter(data.title) ?? nameAfter(data.channel),
        null,
        messages.activity.verb[event.type](),
      );
    case 'post.updated':
      return itemLine(
        messages.activity.noun.post,
        nameAfter(data.title) ?? nameAfter(data.channel),
        null,
        messages.activity.verb['post.updated'](text(data.draft) !== null || data.draft === true),
      );
    case 'post.posted':
      return itemLine(
        messages.activity.noun.post,
        nameAfter(data.title) ?? nameAfter(data.channel),
        null,
        messages.activity.verb['post.posted'](event.actor.kind === 'system'),
      );

    // Decisions, named by their title.
    case 'decision.proposed':
      return itemLine(
        messages.activity.noun.decision,
        text(data.title),
        decisionLink,
        messages.activity.verb['decision.proposed'](),
      );
    case 'decision.decided':
      return itemLine(
        messages.activity.noun.decision,
        null,
        decisionLink,
        messages.activity.verb['decision.decided']({
          status: oneOf(decisionStatuses, change(data.status)[1]),
          replaces: text(data.supersedes) !== null,
          // An agent's change on a person's word names that person.
          onWordOf:
            typeof data.onWordOf === 'object' && data.onWordOf !== null
              ? person((data.onWordOf as { id?: unknown }).id).label
              : null,
        }),
      );
    case 'decision.updated':
      return itemLine(
        messages.activity.noun.decision,
        nameAfter(data.title),
        decisionLink,
        messages.activity.verb['decision.updated'](changedFields(data, ['rev'])),
      );

    // Releases, named by their version, linked to the release in Releases. A
    // changelog's text is not shown here.
    case 'release.created':
      return itemLine(
        messages.activity.noun.release,
        text(data.version),
        projectLink('release'),
        messages.activity.verb['release.created'](),
      );
    case 'release.updated':
      return itemLine(
        messages.activity.noun.release,
        nameAfter(data.version),
        projectLink('release'),
        messages.activity.verb['release.updated']({
          fields: changedFields(data, ['rev', 'draft', 'changelogEdited', 'changelogDraft']),
          drafted: text(data.draft) !== null,
        }),
      );
    case 'release.published':
      return itemLine(
        messages.activity.noun.release,
        text(data.publishedVersion),
        projectLink('release'),
        messages.activity.verb['release.published'](data.again === true),
      );
    case 'release.unpublished':
      return itemLine(
        messages.activity.noun.release,
        text(data.publishedVersion),
        projectLink('release'),
        messages.activity.verb['release.unpublished'](),
      );
    case 'changes.received':
      return {
        before: messages.activity.changesReceived(
          typeof data.count === 'number' ? data.count : null,
        ),
        item: null,
        after: '',
      };

    // The Inbox, linked to the item. What a sender wrote is not shown here.
    case 'inbox.received': {
      const source = oneOf(inboxSources, data.source);
      return itemLine(
        messages.activity.noun.inbox,
        null,
        projectLink('inbox'),
        messages.activity.verb['inbox.received'](
          source,
          source === 'manual' && event.actor.kind !== 'system',
        ),
      );
    }
    case 'inbox.carded': {
      const line = itemLine(
        messages.activity.noun.inbox,
        null,
        projectLink('inbox'),
        messages.activity.verb['inbox.carded'](),
      );
      const key = text(data.cardKey);
      // The card it became, by its key, after the item.
      return key === null
        ? line
        : { ...line, after: `${messages.activity.cardMade} ${key}`.trim() };
    }
    case 'inbox.archived':
      return itemLine(
        messages.activity.noun.inbox,
        null,
        projectLink('inbox'),
        messages.activity.verb['inbox.archived'](),
      );

    // Docs and Links. A sync names what changed by count; a link by its label.
    case 'docs.synced': {
      const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
      return {
        before: messages.activity.docs.synced,
        item: {
          label: messages.activity.docs.theDocs,
          link: project ? { kind: 'docs', project: project.key } : null,
        },
        after: messages.activity.docs.counts(
          count(data.created),
          count(data.updated),
          count(data.removed),
        ),
      };
    }
    case 'links.changed': {
      // A link by its label, a group by its title, as they are now. An event of an earlier
      // version may hold a changed one as [before, after].
      const name = nameAfter(data.label) ?? nameAfter(data.title);
      const words = messages.activity.docs.linkChange(text(data.change));
      return name === null
        ? { before: words.unnamed, item: null, after: '' }
        : {
            before: words.named,
            item: { label: name, link: { kind: 'links', project: project?.key ?? null } },
            after: '',
          };
    }

    // Money. Amounts and names are in Money, not here.
    case 'signals.received':
      return {
        before: messages.activity.money.signals(
          typeof data.count === 'number' ? data.count : null,
          event.actor.kind === 'system',
          data.csv === true,
        ),
        item: null,
        after: '',
      };
    case 'signals.removed':
      return { before: messages.activity.money.removed, item: null, after: '' };
    case 'plan.changed':
    case 'cost_line.changed':
    case 'scenario.changed':
      return {
        before: messages.activity.money.changed(event.type, text(data.change), text(data.name)),
        item: null,
        after: '',
      };
    case 'rate.changed':
      return { before: messages.activity.money.rates, item: null, after: '' };
    case 'spend.committed':
    case 'spend.dismissed': {
      // The amount in its currency, and what the agent said it is for.
      const amount =
        typeof data.amount === 'number' && text(data.currency) !== null
          ? formatAmount(data.amount, text(data.currency) ?? '')
          : null;
      return {
        before:
          event.type === 'spend.committed'
            ? messages.activity.money.spendCommitted(amount, text(data.what))
            : messages.activity.money.spendDismissed(amount),
        item: null,
        after: '',
      };
    }
    case 'model_rate.changed':
      return {
        before: messages.activity.money.modelRate(text(data.model)),
        item: null,
        after: '',
      };

    case 'assistant.called': {
      // The card it was for, by its key, which the event carries.
      const key = text(data.key);
      const outcome = text(data.outcome);
      // Some features name their item: an asset or a release by its key or
      // version, an inbox item as a link.
      const feature = typeof data.feature === 'string' ? data.feature : '';
      const words = messages.activity.assistant.featureCalled[feature];
      if (words !== undefined) {
        const after = messages.activity.assistant.calledAfter(outcome);
        if (feature === 'translate_post') {
          return { before: [words, after].filter(Boolean).join(' '), item: null, after: '' };
        }
        if (feature === 'draft_card' || feature === 'draft_reply') {
          return {
            before: words,
            item: { label: messages.activity.noun.inbox.unnamed, link: projectLink('inbox') },
            after,
          };
        }
        const noun =
          feature === 'draft_changelog'
            ? messages.activity.noun.release
            : messages.activity.noun.asset;
        return {
          before: key === null ? words : `${words} ${noun.named}`,
          item: {
            label: key ?? noun.unnamed,
            link: feature === 'draft_changelog' ? projectLink('release') : null,
          },
          after,
        };
      }
      // Summarise feedback names the build by its key.
      if (data.feature === 'summarise_feedback') {
        return key === null
          ? {
              before: messages.activity.assistant.summarisedNoBuild(outcome),
              item: null,
              after: '',
            }
          : {
              before: messages.activity.assistant.summarised,
              item: { label: key, link: null },
              after: messages.activity.assistant.calledAfter(outcome),
            };
      }
      return key === null
        ? { before: messages.activity.assistant.calledNoCard(outcome), item: null, after: '' }
        : {
            before: messages.activity.assistant.called,
            item: { label: key, link: { kind: 'card', key } },
            after: messages.activity.assistant.calledAfter(outcome),
          };
    }
    case 'assistant.settings_changed':
      return {
        before: messages.activity.assistant.settingsChanged(Object.keys(data)),
        item: null,
        after: '',
      };

    // Planning. Card keys link to the card; what people typed (an
    // item's text, a label's or a milestone's name, a note) is not shown here.
    case 'card.planned':
    case 'checklist.changed':
    case 'time_entry.changed': {
      const key = text(data.key) ?? text(data.card);
      const change = text(data.change);
      const verb =
        event.type === 'card.planned'
          ? 'planned'
          : event.type === 'checklist.changed'
            ? 'changed the checklist of'
            : change === 'removed'
              ? 'removed time from'
              : change === 'changed'
                ? 'changed time on'
                : 'recorded time on';
      return key === null || key === ''
        ? { before: `${verb} a card`, item: null, after: '' }
        : {
            before: `${verb} the card`,
            item: { label: key, link: { kind: 'card', key } },
            after: '',
          };
    }
    case 'milestone.changed':
    case 'label.changed':
    case 'epic.changed':
    case 'view.changed':
    case 'recurrence.changed': {
      const noun = {
        'milestone.changed': 'a milestone',
        'label.changed': 'a label',
        'epic.changed': 'an epic',
        'view.changed': 'a shared view of the Board',
        'recurrence.changed': 'a recurrence rule',
      }[event.type];
      const change = text(data.change);
      const verb =
        change === 'created'
          ? event.type === 'view.changed'
            ? 'shared'
            : 'added'
          : change === 'removed'
            ? 'removed'
            : change === 'proposed' || change === 'accepted' || change === 'dropped'
              ? change
              : change === 'paused'
                ? 'paused'
                : change === 'resumed'
                  ? 'resumed'
                  : 'changed';
      return { before: `${verb} ${noun}`, item: null, after: '' };
    }
    // Routines: the routine by its name where the event has it,
    // linked to Settings, Routines; what the agent wrote is read in the run itself.
    case 'routine.changed': {
      const words = messages.activity.routines;
      const name = text(data.name) ?? text(change(data.name)[1]);
      return {
        before: words.changed(text(data.change)),
        item: name === null ? null : { label: name, link: { kind: 'routines' } },
        after: '',
      };
    }
    case 'routine_run.created':
    case 'routine_run.started':
    case 'routine_run.finished':
    case 'routine_run.missed':
    case 'routine_run.seen': {
      const words = messages.activity.routines;
      const name = text(data.name);
      const state = change(data.state)[1];
      return {
        before: words.run(event.type, state === 'failed'),
        item: { label: name ?? words.aRoutine, link: { kind: 'routines' } },
        after: '',
      };
    }
    case 'build.milestone_changed':
      return itemLine(messages.activity.noun.build, text(data.key), null, {
        verb: 'set the milestone of',
        after: '',
      });

    case 'import.item': {
      // One line for each row the importer wrote. A card links to the card, a
      // link group to the links; the rest is named in words.
      const words = messages.activity.imported;
      const object = text(data.object);
      const label = text(data.label);
      const key = text(data.key);
      const link: ItemLink | null =
        (object === 'card' || object === 'status_line') && key !== null
          ? { kind: 'card', key }
          : object === 'link_group' || object === 'link'
            ? { kind: 'links', project: project?.key ?? null }
            : null;
      const shown = object === 'status_line' ? key : label;
      // A later `--repo` run's change to a row it wrote earlier is not a second import.
      const change = text(data.change);
      if (change === 'files' || change === 'versions') {
        const said = words.changed[change];
        return {
          before: said.before,
          item: shown === null ? null : { label: shown, link },
          after: said.after,
        };
      }
      // A done mark on a whole feature, not on a step.
      const noun =
        object === 'step_mark' && text(data.on) === 'feature'
          ? words.featureMark
          : words.noun(object);
      return {
        before: `${words.verb} ${noun}`,
        item: shown === null ? null : { label: shown, link },
        after: words.after,
      };
    }

    case 'file.uploaded':
      return itemLine(
        messages.activity.noun.file,
        text(data.name),
        null,
        messages.activity.verb['file.uploaded'](),
      );
  }
  // A type that a later version adds and this one does not describe.
  return { ...messages.activity.unknownEvent(String(event.type)), item: null };
}

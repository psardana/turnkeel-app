import { agentScopes, type AgentScope, type FilePurpose } from '@turnkeel/protocol';
import type { Action, HumanOnlyAction, TableAction } from './actions.js';
import type { RuleId } from '@turnkeel/protocol';

/**
 * What each scope allows. An agent can do an action only when a scope on its
 * token names it. `file.upload` is named by five scopes, each for its own purpose
 * only (`uploadScopes`).
 */
export const scopeTable: Readonly<Record<AgentScope, readonly TableAction[]>> = {
  'cards:read': ['card.read'],
  // An agent that writes cards may propose an epic for a person to accept.
  'cards:write': ['card.create', 'card.update', 'card.move', 'card.status.add', 'epic.propose'],
  'planning:write': ['milestone.write', 'label.write'],
  // Making and changing epics directly; Builder holds it, Reporter does not.
  'epics:write': ['epic.write'],
  'testing:read': ['build.read', 'step.notes.read', 'feedback.read'],
  'testing:post': ['build.post', 'file.upload'],
  'testing:reply': ['step.reply'],
  'assets:read': ['asset.read'],
  'assets:propose': ['asset.propose', 'file.upload'],
  'posts:read': ['post.read'],
  'posts:write': ['post.write'],
  'gates:read': ['gate.read', 'listing.read'],
  'gates:check': ['gate.check', 'file.upload'],
  'gates:sync': ['gate.sync', 'listing.sync', 'file.upload'],
  'decisions:read': ['decision.read'],
  'decisions:propose': ['decision.propose'],
  'decisions:decide': ['decision.relay'],
  'releases:read': ['release.read'],
  'releases:write': ['release.write'],
  'inbox:read': ['inbox.read'],
  'inbox:write': ['inbox.write'],
  'signals:write': ['signal.write'],
  'money:read': ['money.read'],
  'docs:read': ['doc.read'],
  'docs:sync': ['doc.sync', 'file.upload'],
  // The groups' names and ids, so an agent finds the group it adds to.
  'links:write': ['link.add', 'link_group.read'],
  'sessions:write': ['session.write'],
  // A token sees and reports the runs of its own agent's routines.
  'routines:run': ['routine.run'],
  // The second set of opt-in scopes. Each grants the
  // person's action itself, taken only on the word of a person who may take it there.
  'cards:archive': ['card.archive'],
  'inbox:triage': ['inbox.triage'],
  'testing:mark': ['step.mark', 'step.note'],
  // A suggested receipt is the scope's too, and takes no person's word.
  'money:write': ['money.write', 'file.upload', 'receipt.suggest'],
  'assets:decide': ['asset.decide', 'asset.note'],
  'posts:approve': ['post.approve', 'post.skip'],
  'gates:pass': ['gate.pass', 'gate.confirm_change', 'listing.mark'],
  'releases:publish': ['release.publish'],
  'posts:send': ['post.send'],
  'spend:commit': ['spend.commit'],
};

/**
 * The actions of the opt-in scopes (`optInScopes` in the protocol). Each lets an agent do,
 * on the word of a named person, what is otherwise that
 * person's action, and the person must hold that action themselves: the value is that
 * action. `decision.relay` is an action of its own, which no role takes, because it is
 * narrower than `decision.decide` (never `done`, never `supersedesId`). The second
 * set grants the person's action itself, so it left the human-only list. A
 * later opt-in scope adds its row here, its scope to `scopeTable` and `optInScopes`, and
 * takes its action off `humanOnlyActions`.
 */
export const onWordActions = {
  'decision.relay': 'decision.decide',
  'card.archive': 'card.archive',
  'inbox.triage': 'inbox.triage',
  'step.mark': 'step.mark',
  'step.note': 'step.note',
  'money.write': 'money.write',
  'asset.decide': 'asset.decide',
  'asset.note': 'asset.note',
  'post.approve': 'post.approve',
  'post.skip': 'post.skip',
  'gate.pass': 'gate.pass',
  'gate.confirm_change': 'gate.confirm_change',
  'listing.mark': 'listing.mark',
  'release.publish': 'release.publish',
  'post.send': 'post.send',
  'spend.commit': 'spend.commit',
} as const satisfies Partial<Record<TableAction, TableAction>>;

/** The read scopes. Any one of them also gives `people.read` and `file.read`. */
export const readScopes: readonly AgentScope[] = agentScopes.filter((scope) =>
  scope.endsWith(':read'),
);

/** What any read scope gives besides its own reads. */
export const anyReadScopeActions = ['people.read', 'file.read'] as const satisfies TableAction[];

/**
 * The reads that no scope gives: no agent token reads links, sessions, time entries or
 * routines; `links:write` lists the groups' names (`link_group.read`); an agent reads its
 * own runs under `routine.run`.
 */
export const noScopeReads = [
  'link.read',
  'session.read',
  'time.read',
  'routine.read',
] as const satisfies TableAction[];

/**
 * Which scope lets a token upload a file for each purpose. No scope
 * goes with `post_media`, so an agent token uploads none. A receipt goes with the
 * opt-in scope `money:write`, on a person's word.
 */
export const uploadScopes: Readonly<Record<FilePurpose, AgentScope | null>> = {
  step_run: 'testing:post',
  asset_variant: 'assets:propose',
  gate_evidence: 'gates:check',
  listing_file: 'gates:sync',
  doc_image: 'docs:sync',
  post_media: null,
  // A receipt goes with money:write, on a person's word.
  receipt: 'money:write',
};

/** The read action of the item each kind of file is attached to. */
export const fileReadActions: Readonly<Record<FilePurpose, TableAction>> = {
  step_run: 'build.read',
  asset_variant: 'asset.read',
  gate_evidence: 'gate.read',
  doc_image: 'doc.read',
  listing_file: 'listing.read',
  post_media: 'post.read',
  receipt: 'money.read',
};

/** True when `value` is the name of a scope. A token stored with any other name gets nothing from it. */
export function isScope(value: string): value is AgentScope {
  return (agentScopes as readonly string[]).includes(value);
}

/** True when the scopes hold at least one read scope. */
export function hasReadScope(scopes: readonly string[]): boolean {
  return scopes.some((scope) => isScope(scope) && readScopes.includes(scope));
}

/**
 * Every action the scopes allow, with `people.read` and `file.read` when one of them
 * is a read scope. `file.upload` is in it when a scope allows an upload for some
 * purpose; which purpose is asked of `uploadScopes`.
 */
export function actionsOfScopes(scopes: readonly string[]): ReadonlySet<Action> {
  const allowed = new Set<Action>();
  for (const scope of scopes) {
    if (!isScope(scope)) continue;
    for (const action of scopeTable[scope]) allowed.add(action);
  }
  if (hasReadScope(scopes)) for (const action of anyReadScopeActions) allowed.add(action);
  return allowed;
}

/**
 * The rule that refuses a human-only action to an agent: the one that names
 * the action, and R13 for the rest of the list.
 */
export function humanOnlyRule(action: HumanOnlyAction): RuleId {
  switch (action) {
    case 'decision.decide':
      return 'R15';
    case 'member.manage':
    case 'agent.manage':
    case 'connector.manage':
      return 'R20';
    case 'build.archive':
    case 'asset.archive':
      return 'R39';
    case 'link.write':
      return 'R56';
    case 'assistant.draft':
    case 'assistant.manage':
      return 'R61';
    case 'planning.remove':
      return 'R75';
    case 'time.write':
    case 'time.manage':
      return 'R76';
    case 'recurrence.write':
      return 'R78';
    case 'view.share':
      return 'R80';
    case 'routine.manage':
      return 'R84';
    case 'epic.accept':
      return 'R85';
    default:
      return 'R13';
  }
}

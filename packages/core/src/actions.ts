/**
 * Every action of the role table, by its name. `can` knows each
 * of them; an action whose rule is not built yet is denied (role-table.ts).
 */
export const tableActions = [
  // Reads
  'card.read',
  'gate.read',
  'listing.read',
  'asset.read',
  'post.read',
  'decision.read',
  'release.read',
  'inbox.read',
  'money.read',
  'doc.read',
  'link.read',
  // The names and ids of link groups, not their links.
  'link_group.read',
  'session.read',
  'routine.read',
  'people.read',
  'build.read',
  'step.notes.read',
  'feedback.read',
  'file.read',
  'member.read',
  'agent.read',
  'connector.read',
  'events.read',
  'events.export',
  // Board
  'card.create',
  'card.update',
  'card.move',
  'card.archive',
  'card.status.add',
  // Planning
  'milestone.write',
  'label.write',
  'planning.remove',
  'view.share',
  'recurrence.write',
  'time.read',
  'time.write',
  'time.manage',
  // Epics: made and changed under epic.write, proposed by an
  // agent under epic.propose, and accepted or dropped by a person under epic.accept.
  'epic.write',
  'epic.propose',
  'epic.accept',
  // Launch
  'gate.sync',
  'gate.check',
  'gate.pass',
  'gate.confirm_change',
  'listing.sync',
  'listing.mark',
  // Testing
  'build.post',
  'build.archive',
  'build.testers',
  'step.reply',
  'step.note',
  'step.mark',
  // Review
  'asset.propose',
  'asset.archive',
  'asset.decide',
  'asset.note',
  'asset_group.write',
  'post.write',
  'post.skip',
  'post.approve',
  'post.send',
  // Decisions, releases, inbox
  'decision.propose',
  'decision.decide',
  'decision.relay',
  'release.write',
  'release.publish',
  'inbox.write',
  'inbox.triage',
  // Docs, links, files
  'doc.sync',
  'link.add',
  'link.write',
  'file.upload',
  // Money and signals
  'signal.write',
  'money.write',
  'spend.commit',
  'receipt.suggest',
  // Sessions
  'session.write',
  'session.dismiss',
  // Routines
  'routine.manage',
  'routine.run',
  // Workspace, projects, people, agents, connectors
  'project.create',
  'project.update',
  'project.archive',
  'member.manage',
  'agent.manage',
  'connector.manage',
  'workspace.update',
  'workspace.delete',
  'workspace.transfer',
  // The assistant
  'assistant.manage',
  'assistant.draft',
] as const;

export type TableAction = (typeof tableActions)[number];

/**
 * Four checks that are not rows of the role table, because no role grants them:
 * seeing a workspace or a project at all, creating a workspace,
 * and a person changing their own handle. `can` answers them like any other action.
 */
export const membershipActions = [
  'workspace.read',
  'workspace.create',
  'project.read',
  'member.handle',
] as const;

export type MembershipAction = (typeof membershipActions)[number];

export const actions = [...tableActions, ...membershipActions] as const;

export type Action = TableAction | MembershipAction;

/**
 * The actions only a person may take. No scope grants them and no token
 * can hold them. `project.*` and `workspace.*` are written out. The actions of the
 * second set of opt-in scopes left this list: an agent takes each only on a person's
 * word, under a scope only an Owner gives.
 */
export const humanOnlyActions = [
  'assistant.draft',
  'assistant.manage',
  'asset.archive',
  'asset_group.write',
  'build.archive',
  'build.testers',
  'decision.decide',
  'link.write',
  'session.dismiss',
  'project.create',
  'project.update',
  'project.archive',
  'member.read',
  'member.manage',
  'agent.read',
  'agent.manage',
  'connector.read',
  'connector.manage',
  'events.read',
  'events.export',
  'workspace.update',
  'workspace.delete',
  'workspace.transfer',
  // Planning: each because a rule requires it
  'planning.remove',
  'recurrence.write',
  'time.write',
  'time.manage',
  'view.share',
  // Epics: a proposed epic is accepted or dropped by a person
  'epic.accept',
  // Routines: a routine is a person's instruction to an agent
  'routine.manage',
] as const satisfies readonly TableAction[];

export type HumanOnlyAction = (typeof humanOnlyActions)[number];

const actionSet: ReadonlySet<string> = new Set(actions);
const humanOnlySet: ReadonlySet<string> = new Set(humanOnlyActions);

/** True when `value` is the name of an action `can` knows. */
export function isAction(value: string): value is Action {
  return actionSet.has(value);
}

/** True when only a person may take the action. */
export function isHumanOnly(action: Action): action is HumanOnlyAction {
  return humanOnlySet.has(action);
}

/** True when the action changes nothing. `events.export` is a read of the whole log. */
export function isRead(action: Action): boolean {
  return action.endsWith('.read') || action === 'events.export';
}

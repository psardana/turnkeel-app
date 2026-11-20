import type { Role } from '@turnkeel/protocol';
import type { TableAction } from './actions.js';

/**
 * Which role judges an action (the Level column).
 *
 * - `project`: the person's role in that project, which is the project role when there
 *   is one and the workspace role otherwise.
 * - `workspace`: the workspace role only. A project role never grants the action.
 * - `either`: `project` when the object has a project, `workspace` when it has none.
 */
export type Level = 'project' | 'workspace' | 'either';

export interface RoleRule {
  readonly level: Level;
  /** The roles with a tick in the table. */
  readonly roles: readonly Role[];
}

const ownerAdmin = ['owner', 'admin'] as const;

/**
 * The role table, one row per action. `money.write` has two rows: plans,
 * cost lines and scenarios at the level `either`, and rates at the level `workspace`.
 * This is the first; `can` judges rates by the workspace role (`levelOf` in can.ts).
 *
 * The test that walks the whole table (`matrix.test.ts`) holds this against its own
 * copy of the table, written out by hand, so a change here without a change there fails.
 */
export const roleTable: Readonly<Record<TableAction, RoleRule>> = {
  // Reads of the items in a project, or of the workspace's items that have none
  'card.read': either(readers),
  'gate.read': either(readers),
  'listing.read': either(readers),
  'asset.read': either(readers),
  'post.read': either(readers),
  'decision.read': either(readers),
  'release.read': either(readers),
  'inbox.read': either(readers),
  'money.read': either(readers),
  'doc.read': either(readers),
  'link.read': either(readers),
  'link_group.read': either(readers),
  'session.read': either(readers),
  // Routines: every role that reads the project sees its routines and their runs.
  'routine.read': project(readers),
  'people.read': either(readers),
  'build.read': project(everyone),
  'step.notes.read': project(readers),
  'feedback.read': project(ownerAdminMember),
  'file.read': project(everyone),
  'member.read': workspace(ownerAdmin),
  'agent.read': workspace(ownerAdmin),
  'connector.read': workspace(ownerAdmin),
  'events.read': either(readers),
  'events.export': workspace(ownerAdmin),

  // Board
  'card.create': project(ownerAdminMember),
  'card.update': project(ownerAdminMember),
  'card.move': project(ownerAdminMember),
  'card.archive': project(ownerAdminMember),
  'card.status.add': project(writers),

  // Planning. `time.read` is everyone's time; each person reads their own
  // without it, by design (Owner and Admin only).
  'milestone.write': project(ownerAdminMember),
  'label.write': project(ownerAdminMember),
  'planning.remove': project(ownerAdminMember),
  // Epics: whoever may plan cards makes them, proposes them and decides
  // on a proposed one.
  'epic.write': project(ownerAdminMember),
  'epic.propose': project(ownerAdminMember),
  'epic.accept': project(ownerAdminMember),
  'view.share': project(ownerAdminMember),
  'recurrence.write': project(ownerAdminMember),
  'time.read': project(ownerAdmin),
  'time.write': project(ownerAdminMember),
  'time.manage': project(ownerAdmin),

  // Launch
  'gate.sync': project(ownerAdminMember),
  'gate.check': project(ownerAdminMember),
  'gate.pass': project(ownerAdminMember),
  'gate.confirm_change': project(ownerAdminMember),
  'listing.sync': project(ownerAdminMember),
  'listing.mark': project(ownerAdminMember),

  // Testing
  'build.post': project(ownerAdminMember),
  'build.archive': project(ownerAdminMember),
  'build.testers': project(ownerAdminMember),
  'step.reply': project(ownerAdminMember),
  'step.note': project(['owner', 'admin', 'member', 'tester']),
  'step.mark': project(['owner', 'admin', 'member', 'tester']),

  // Review
  'asset.propose': project(ownerAdminMember),
  'asset.archive': project(ownerAdminMember),
  'asset.decide': project(ownerAdminReviewer),
  'asset.note': project(ownerAdminReviewer),
  'asset_group.write': project(ownerAdminMember),
  'post.write': project(ownerAdminMember),
  'post.skip': project(ownerAdminMember),
  'post.approve': project(ownerAdminReviewer),
  'post.send': project(ownerAdminMember),

  // Decisions, releases, inbox
  'decision.propose': either(writers),
  'decision.decide': either(ownerAdminReviewer),
  // No role: a person decides with decision.decide. Only an agent with the opt-in scope
  // decisions:decide sets a status on a person's word.
  'decision.relay': either([]),
  'release.write': project(ownerAdminMember),
  'release.publish': project(ownerAdmin),
  'inbox.write': project(ownerAdminMember),
  'inbox.triage': project(ownerAdminMember),

  // Docs, links, files
  'doc.sync': project(ownerAdminMember),
  'link.add': either(ownerAdminMember),
  'link.write': either(ownerAdminMember),
  'file.upload': project(ownerAdminMember),

  // Money and signals
  'signal.write': either(ownerAdmin),
  'money.write': either(ownerAdmin),
  'spend.commit': either(ownerAdmin),
  // No role: a person enters a receipt with money.write. Only an agent with the opt-in
  // scope money:write suggests one from a mail, which counts in nothing until a person
  // confirms it, so it takes no person's word.
  'receipt.suggest': either([]),

  // Sessions
  'session.write': either(ownerAdminMember),
  'session.dismiss': either(ownerAdminMember),

  // Routines. An Owner or Admin makes, changes and removes a
  // routine and marks its runs seen. No role runs one: only the routine's agent, with
  // the scope routines:run, starts and finishes its runs.
  'routine.manage': project(ownerAdmin),
  'routine.run': project([]),

  // Workspace, projects, people, agents, connectors
  'project.create': workspace(ownerAdmin),
  'project.update': project(ownerAdmin),
  'project.archive': project(ownerAdmin),
  'member.manage': workspace(ownerAdmin),
  'agent.manage': workspace(ownerAdmin),
  'connector.manage': workspace(ownerAdmin),
  'workspace.update': workspace(ownerAdmin),
  'workspace.delete': workspace(['owner']),
  'workspace.transfer': workspace(['owner']),

  // The assistant
  'assistant.manage': workspace(ownerAdmin),
  'assistant.draft': project(ownerAdminMember),
};

import type { Executor } from '../database.js';
import { assertScope, type WorkspaceScope } from '../scope.js';
import { eventsRepository } from './events.js';
import { invitationsRepository } from './invitations.js';
import { membersRepository, projectMembersRepository } from './members.js';
import { projectsRepository } from './projects.js';
import { workspaceRepository } from './workspace.js';

/**
 * The repositories of one workspace. This is the only way to reach them, and it
 * throws `MissingScopeError` without a scope, so no query on a workspace's tables can
 * run unscoped: repositories take a scope and cannot run without one.
 *
 * `executor` is the database for reads, or the transaction of a write. A write appends
 * its event through `events.append` in that same transaction.
 */
export function repositories(executor: Executor, scope: WorkspaceScope) {
  assertScope(scope);
  const frozen: WorkspaceScope = { workspaceId: scope.workspaceId.toLowerCase() };
  return {
    scope: frozen,
    workspace: workspaceRepository(executor, frozen),
    projects: projectsRepository(executor, frozen),
    members: membersRepository(executor, frozen),
    projectMembers: projectMembersRepository(executor, frozen),
    invitations: invitationsRepository(executor, frozen),
    agents: agentsRepository(executor, frozen),
    agentTokens: agentTokensRepository(executor, frozen),
    events: eventsRepository(executor, frozen),
    parties: partiesRepository(executor, frozen),
    cards: cardsRepository(executor, frozen),
    statusLines: statusLinesRepository(executor, frozen),
    sessions: agentSessionsRepository(executor, frozen),
    files: filesRepository(executor, frozen),
    builds: buildsRepository(executor, frozen),
    gates: gatesRepository(executor, frozen),
    gateFiles: gateFilesRepository(executor, frozen),
    gateFileChanges: gateFileChangesRepository(executor, frozen),
    assets: assetsRepository(executor, frozen),
    decisions: decisionsRepository(executor, frozen),
    assistantSettings: assistantSettingsRepository(executor, frozen),
    assistantCalls: assistantCallsRepository(executor, frozen),
    listings: listingsRepository(executor, frozen),
    connectorInstalls: connectorInstallsRepository(executor, frozen),
    milestones: milestonesRepository(executor, frozen),
    labels: labelsRepository(executor, frozen),
    epics: epicsRepository(executor, frozen),
    checklist: checklistRepository(executor, frozen),
    savedViews: savedViewsRepository(executor, frozen),
    recurrenceRules: recurrenceRulesRepository(executor, frozen),
    timeEntries: timeEntriesRepository(executor, frozen),
    posts: postsRepository(executor, frozen),
    reviewSeen: reviewSeenRepository(executor, frozen),
    postSuggestionsHidden: postSuggestionsHiddenRepository(executor, frozen),
    releases: releasesRepository(executor, frozen),
    changes: changesRepository(executor, frozen),
    inbox: inboxRepository(executor, frozen),
    signals: signalsRepository(executor, frozen),
    pricePlans: pricePlansRepository(executor, frozen),
    costLines: costLinesRepository(executor, frozen),
    currencyRates: currencyRatesRepository(executor, frozen),
    modelRates: modelRatesRepository(executor, frozen),
    scenarios: scenariosRepository(executor, frozen),
    spends: spendsRepository(executor, frozen),
    /** Routines and their runs. */
    routines: routinesRepository(executor, frozen),
    routineRuns: routineRunsRepository(executor, frozen),
    docs: docsRepository(executor, frozen),
    linkGroups: linkGroupsRepository(executor, frozen),
    links: linksRepository(executor, frozen),
    /** What the importer of the project hub finds again by `source.ref`. */
    imports: importsRepository(executor, frozen),
    /** One person's view state: hidden tabs, intros seen, Get started. */
    personViews: personViewsRepository(executor, frozen),
    /** The counts Get started is worked out from. */
    startCounts: (projectIds: readonly string[], now: Date) =>
      startCountsOf(executor, frozen, projectIds, now),
    /** What the first lines of Your turn read of one project. */
    firstCounts: (projectId: string) => firstCountsOf(executor, frozen, projectId),
    /** Whether the one question of the first run made the workspace. */
    madeWithFirstProject: () => madeWithFirstProjectOf(executor, frozen),
    /** The assistant's calls of a project by provider, model and month. */
    assistantUsage: (projectId: string, since: Date) =>
      assistantUsageOf(executor, frozen, projectId, since),
  };
}

export type Repositories = ReturnType<typeof repositories>;

export type { AgentPatch, NewAgentToken } from './agents.js';
export type { EventFilter } from './events.js';
export type { NewInvitation } from './invitations.js';
export type { MemberWithUser, ProjectMemberWithUser } from './members.js';
export type { NewProject, ProjectPatch } from './projects.js';
export type { WorkspacePatch } from './workspace.js';
export type {
  DocBriefRow,
  DocRow,
  DocValues,
  LinkGroupPatch,
  LinkGroupRow,
  LinkPatch,
  LinkRow,
} from './docs.js';

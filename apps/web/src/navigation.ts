import type { LinkProps } from '@tanstack/react-router';
import type { WorkspaceAbilities } from '@/lib/permissions';
import { messages } from '@/messages';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The view takes the whole width under the header and scrolls inside. */
    fullBleed?: boolean;
  }
}

/** One place a person can go inside a workspace. */
export interface NavItem {
  id: string;
  label: string;
  /** A route under `/w/$ws`. */
  to: NonNullable<LinkProps['to']>;
  /** Whether the person's role opens it. The server decides again on every request. */
  visible: (abilities: WorkspaceAbilities) => boolean;
  /** For a tab: the icon of its cell in the bottom bar on a phone. */
  icon?: LucideIcon;
}

/** A view: a tab with no sections, a section of Ship or Marketing, or a page of Reference. */
export interface ViewItem extends NavItem {
  id: ViewId;
}

const someView = (views: readonly ViewItem[]) => (abilities: WorkspaceAbilities) =>
  views.some((view) => view.visible(abilities));

const activity: NavItem = {
  id: 'activity',
  label: nav.activity,
  to: '/w/$ws/activity',
  visible: (abilities) => abilities.readSomeEvents,
  icon: HistoryIcon,
};

const reference: NavItem = {
  id: 'reference',
  label: nav.reference,
  to: '/w/$ws/reference',
  visible: someView(referencePages),
  icon: LibraryIcon,
};

/**
 * What the workspace menu opens. Activity is not a tab; it is opened
 * from here, as Connectors is, and so are Reference and the agents'
 * sessions, which are in Settings beside Agents and tokens.
 */
export const workspaceMenu: readonly NavItem[] = [
  activity,
  reference,
  {
    id: 'projects',
    label: nav.projects,
    to: '/w/$ws/settings/projects',
    visible: (abilities) => !abilities.onlyTester,
  },
  {
    id: 'members',
    label: nav.members,
    to: '/w/$ws/settings/members',
    visible: (abilities) => abilities.readMembers,
  },
  {
    id: 'agents-and-tokens',
    label: nav.agentsAndTokens,
    to: '/w/$ws/settings/agents',
    visible: (abilities) => abilities.readAgents,
  },
  {
    id: 'sessions',
    label: nav.sessions,
    to: '/w/$ws/settings/sessions',
    visible: (abilities) => abilities.readSomeSessions,
  },
  {
    id: 'connectors',
    label: nav.connectors,
    to: '/w/$ws/settings/connectors',
    visible: (abilities) => abilities.readConnectors,
  },
  {
    id: 'assistant',
    label: nav.assistant,
    to: '/w/$ws/settings/assistant',
    visible: (abilities) => abilities.manageAssistant,
  },
  {
    id: 'settings',
    label: nav.settings,
    to: '/w/$ws/settings',
    visible: (abilities) => !abilities.onlyTester,
  },
];

/**
 * The views inside a workspace that a Tester may open: Ship's Testing, and Your turn, Ship
 * and the workspace's own address, which send them there, and the old address of Testing,
 * which moves to it. Any other address is the one 404 for them.
 */
export function testerMayOpen(pathname: string, slug: string): boolean {
  const base = `/w/${slug}`;
  const rest = pathname.toLowerCase().replace(/\/+$/, '').slice(base.length);
  if (!pathname.toLowerCase().startsWith(base)) return false;
  return ['', '/turn', '/ship', '/ship/testing', '/testing'].includes(rest);
}

/**
 * The sections of Settings, in their order. Each is its own page
 * under `/w/$ws/settings`, listed at the side, or in a select on a phone. A section that
 * the person's role does nothing in is not listed; the server decides again on every
 * request.
 */
export const settingsSections: readonly SettingsSection[] = [
  {
    id: 'workspace',
    label: section.workspace.label,
    line: section.workspace.line,
    to: '/w/$ws/settings/workspace',
    visible: () => true,
    group: 'workspace',
  },
  {
    id: 'projects',
    label: section.projects.label,
    line: section.projects.line,
    to: '/w/$ws/settings/projects',
    visible: () => true,
    group: 'workspace',
  },
  {
    id: 'members',
    label: section.members.label,
    line: section.members.line,
    to: '/w/$ws/settings/members',
    visible: (abilities) => abilities.readMembers,
    group: 'workspace',
  },
  {
    id: 'agents-and-tokens',
    label: section.agents.label,
    line: section.agents.line,
    to: '/w/$ws/settings/agents',
    visible: (abilities) => abilities.readAgents,
    group: 'workspace',
  },
  {
    id: 'sessions',
    label: section.sessions.label,
    line: section.sessions.line,
    to: '/w/$ws/settings/sessions',
    visible: (abilities) => abilities.readSomeSessions,
    group: 'workspace',
  },
  {
    id: 'routines',
    label: section.routines.label,
    line: section.routines.line,
    to: '/w/$ws/settings/routines',
    visible: (abilities) => abilities.manageSomeRoutines,
    group: 'workspace',
  },
  {
    id: 'connectors',
    label: section.connectors.label,
    line: section.connectors.line,
    to: '/w/$ws/settings/connectors',
    visible: (abilities) => abilities.readConnectors,
    group: 'workspace',
  },
  {
    id: 'import',
    label: section.import.label,
    line: section.import.line,
    to: '/w/$ws/settings/import',
    visible: (abilities) => abilities.updateWorkspace || abilities.syncSomeGates,
    group: 'workspace',
  },
  {
    id: 'tabs',
    label: section.tabs.label,
    line: section.tabs.line,
    to: '/w/$ws/settings/tabs',
    visible: (abilities) => abilities.updateWorkspace,
    group: 'workspace',
  },
  {
    id: 'planning',
    label: section.planning.label,
    line: section.planning.line,
    to: '/w/$ws/settings/planning',
    visible: (abilities) => abilities.updateWorkspace,
    group: 'workspace',
  },
  {
    id: 'money',
    label: section.money.label,
    line: section.money.line,
    to: '/w/$ws/settings/money',
    visible: (abilities) => abilities.updateWorkspace,
    group: 'workspace',
  },
  {
    id: 'assistant',
    label: section.assistant.label,
    line: section.assistant.line,
    to: '/w/$ws/settings/assistant',
    visible: (abilities) => abilities.manageAssistant,
    group: 'workspace',
  },
  {
    id: 'danger',
    label: section.danger.label,
    line: section.danger.line,
    to: '/w/$ws/settings/danger',
    visible: (abilities) => abilities.deleteWorkspace,
    group: 'workspace',
  },
  {
    id: 'profile',
    label: section.profile.label,
    line: section.profile.line,
    to: '/w/$ws/settings/profile',
    visible: () => true,
    group: 'yours',
  },
  {
    id: 'theme',
    label: section.theme.label,
    line: section.theme.line,
    to: '/w/$ws/settings/theme',
    visible: () => true,
    group: 'yours',
  },
  {
    id: 'my-tabs',
    label: section.myTabs.label,
    line: section.myTabs.line,
    to: '/w/$ws/settings/my-tabs',
    visible: () => true,
    group: 'yours',
  },
  {
    id: 'start',
    label: section.start.label,
    line: section.start.line,
    to: '/w/$ws/settings/start',
    visible: (abilities) => abilities.readSomeCards,
    group: 'yours',
  },
];

/** The views this person sees: on for the workspace and not hidden by them. */
export interface TabChoice {
  off: readonly ViewId[];
  hidden: readonly ViewId[];
}

/**
 * What the tab bar at the top and the bottom bar on a phone hold: the tabs the person's
 * role opens, each while one of its views is on and not hidden. A role that opens
 * none of them gets empty bars, and the shell then draws neither bar.
 */
export function headerNavigation(
  abilities: WorkspaceAbilities,
  choice: TabChoice = noChoice,
): TabItem[] {
  return tabs.filter(
    (tab) =>
      tab.visible(abilities) &&
      (abilities.onlyTester || tabShown(tab.id, choice.off, choice.hidden)) &&
      tab.views.some((view) => viewOpen(view, abilities, choice)),
  );
}

/**
 * The sections of Ship or Marketing, or the pages of Reference, this person sees in its
 * bar of sections: those their role opens that are on and not hidden. A section they hid,
 * or one turned off, still opens from its address; while it is open it is listed too, so
 * the bar always says where they are.
 */
export function sectionNavigation(
  group: readonly ViewItem[],
  abilities: WorkspaceAbilities,
  choice: TabChoice = noChoice,
  open: ViewId | null = null,
): ViewItem[] {
  return group.filter(
    (view) => view.visible(abilities) && (view.id === open || viewOpen(view, abilities, choice)),
  );
}

/** Where a workspace opens: its first tab. */
export function workspaceHome(abilities: WorkspaceAbilities): NavItem | null {
  return headerNavigation(abilities)[0] ?? null;
}

/** Whether a view sits in a bar of sections: Ship's, Marketing's or Reference's. */
export function inSectionBar(view: ViewId): boolean {
  const tab = tabOfView(view);
  return tab === null || tab === 'ship' || tab === 'marketing';
}

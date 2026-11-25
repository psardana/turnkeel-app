import type {
  AppMetricGroup,
  CostGroup,
  ByHandGroup,
  ConnectorScheduleValue,
  GateCheck,
  GatePassValue,
  ListingStore,
  AgentKind,
  AssistantFeature,
  AgentScope,
  OptInScope,
  StandardPreset,
  TokenPreset,
  DecisionStatus,
  decisionSourceKinds,
  GateState,
  InboxSource,
  InboxStatus,
  ReleaseItemKind,
  ReleaseStatus,
  SessionState,
  BoardGroupName,
  CardColumn,
  CardPriority,
  EventArea,
  EventVia,
  PostStatus,
  LaunchTemplate,
  ProjectKind,
  Role,
  StartStepId,
  TabId,
  ViewId,
  ConnectorReason,
  TurnKind,
  RoutineEvent,
  RoutineRunState,
} from '@turnkeel/protocol';

/** `a`, `a and b`, `a, b and c`. */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

const agentKindNames: Record<AgentKind, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  script: 'Script',
  other: 'Other',
};

const roleNames: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  reviewer: 'Reviewer',
  tester: 'Tester',
  viewer: 'Viewer',
};

const roleNotes: Record<Role, string> = {
  owner: 'Everything, and the only role that can delete or hand over the workspace.',
  admin: 'Members, projects and settings. Cannot change an Owner.',
  member: 'Works in every project.',
  reviewer: 'Approves or rejects, and reads everything.',
  tester: 'Sees only Testing, in one project.',
  viewer: 'Reads everything and changes nothing.',
};

/** The names of the six tabs and of every view. */
const tabNameOf = {
  turn: 'Your turn',
  board: 'Board',
  ship: 'Ship',
  marketing: 'Marketing',
  launch: 'Launch',
  testing: 'Testing',
  releases: 'Releases',
  listings: 'Store listings',
  assets: 'Assets',
  posts: 'Posts',
  analytics: 'Analytics',
  money: 'Money',
  inbox: 'Inbox',
  decisions: 'Decisions',
  docs: 'Docs',
  links: 'Links',
} as const satisfies Record<TabId | ViewId, string>;

const kindNames: Record<ProjectKind, string> = {
  app: 'App',
  web: 'Website',
  extension: 'Extension',
  library: 'Library',
  other: 'Other',
};

const viaNames: Record<EventVia, string> = {
  web: 'Web app',
  rest: 'REST',
  mcp: 'MCP',
  cli: 'CLI',
  hook: 'Hook',
  connector: 'Connector',
  job: 'Job',
};

const areaNames: Record<EventArea, string> = {
  workspace: 'Workspace and projects',
  people: 'People',
  agents: 'Agents and tokens',
  board: 'Board',
  launch: 'Launch',
  testing: 'Testing',
  review: 'Marketing',
  decisions: 'Decisions',
  releases: 'Releases',
  inbox: 'Inbox',
  money: 'Money',
  docs: 'Docs and links',
  sessions: 'Agent sessions',
  files: 'Files',
  connectors: 'Connectors',
  assistant: 'The assistant',
  planning: 'Planning',
  routines: 'Routines',
  import: 'Import',
};

/** The fields of the assistant's settings, as Activity names them. */
const assistantFieldNames: Record<string, string> = {
  source: 'provider source',
  provider: 'provider',
  baseUrl: 'base URL',
  model: 'model',
  dailyCap: 'daily cap',
  onForHost: 'on or off',
  apiKey: 'key',
};

/** How the Activity view names a field that changed. A field that is not here shows by its own name. */
const fieldNames: Record<string, string> = {
  name: 'name',
  slug: 'address',
  key: 'key',
  kind: 'kind',
  launchDate: 'launch date',
  locales: 'languages',
  repoUrl: 'repository address',
  shipsTo: 'stores',
  changelogPublic: 'public changelog',
  baseCurrency: 'base currency',
  ownerUserId: 'owner',
  // Gates, asset groups and decisions.
  title: 'title',
  body: 'text',
  pass: 'how it passes',
  check: 'check',
  due: 'due date',
  area: 'area',
  order: 'order',
  waitsOnKind: 'who it waits on',
  waitsOnId: 'who it waits on',
  byHand: 'by hand',
  where: 'where',
  link: 'link',
  sourceFile: 'source file',
  heldChange: 'change from the repository',
  droppedHeldChange: 'change from the repository',
  intro: 'introduction',
  hidden: 'visibility',
  words: 'words',
  context: 'context',
  source: 'source',
  tags: 'tags',
  decidedBy: 'who decided',
  decidedOn: 'date decided',
  // Releases.
  version: 'version',
  changelog: 'changelog',
  notes: 'store notes',
  stores: 'store lanes',
  releasedOn: 'release date',
  rolloutPercent: 'rollout',
  items: 'items',
  // Tabs, the time zone and planning.
  tabsOff: 'tabs',
  timeZone: 'time zone',
  planning: 'planning features',
};

const gateStateNames: Record<GateState, string> = {
  open: 'Open',
  passed: 'Passed',
  failed: 'Failed',
  na: 'Not applicable',
};

const fields = (names: readonly string[]) =>
  listOf([...new Set(names.map((name) => fieldNames[name] ?? name))]) || 'settings';

/** What each template of `turnkeel init` writes, for Get started. */
const templateWhat: Record<LaunchTemplate, string> = {
  'app-launch': 'Writes gates, listings and docs for the App Store and Google Play.',
  'saas-launch': 'Writes gates, listings and docs for a web launch.',
  'browser-extension':
    'Writes gates, listings and docs for the Chrome Web Store and Firefox Add-ons.',
};

/**
 * Every string the web app shows. English only; all strings go through here
 * (plain sentences, no numbers that were not measured).
 */
export const messages = {
  appName: 'Turnkeel',

  common: {
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    retry: 'Retry',
    loading: 'Loading',
    edit: 'Edit',
    remove: 'Remove',
    back: 'Back',
    saved: 'Saved.',
    optional: 'optional',
    none: 'None',
    you: 'you',
    skipToContent: 'Skip to the content',
    messagesRegion: 'Messages',
  },

  /** The names of holder marks. */
  holder: {
    you: 'You',
    system: 'System',
    unassigned: 'Unassigned',
    blocked: 'Blocked',
    blockedBy: 'Blocked by',
    until: (date: string) => `Until ${date}`,
    done: (date: string) => `Done ${date}`,
    anyone: (action: string) => `Anyone who may ${capabilityWords[action] ?? action}`,
    someone: 'Someone',
    aParty: 'A party',
    anAgent: 'An agent',
  },

  roles: {
    name: (role: Role) => roleNames[role],
    note: (role: Role) => roleNotes[role],
    projectOnly: 'Project roles only',
  },

  errors: {
    network: 'The server did not answer. Check that it is running and that you are connected.',
    unexpected: 'Something went wrong in the app.',
    badResponse: 'The server sent an answer this version of the app cannot read. Reload the page.',
    status: (status: number) =>
      `The server could not do this (error ${status}). Try again, or look at the server's log.`,
    notFoundTitle: 'There is nothing at this address',
    notFoundBody: 'The page does not exist, or it is not yours to open.',
    goHome: 'Go to the start page',
    forbiddenTitle: 'Your role cannot open this',
    loadFailed: (what: string) => `${what} could not be loaded.`,
    /** Followed by the request id, in mono. */
    requestId: 'Request',
    rolledBack: (reason: string) => `The change was not saved and has been undone. ${reason}`,
    pageCrashed: 'This page stopped working.',
    thisPage: 'This page',
    reload: 'Reload',
  },

  validation: {
    required: 'This is needed.',
    nameLength: 'Use 1 to 80 characters.',
    slug: 'Use 2 to 40 lower-case letters, digits and single hyphens.',
    handle: 'Use 2 to 32 lower-case letters, digits and single hyphens.',
    key: 'Use 2 to 6 letters.',
    email: 'This is not an email address.',
    locales: 'Use language tags such as en or pt-BR, with commas between them.',
    date: 'This is not a date.',
  },

  dates: {
    today: 'Today',
    yesterday: 'Yesterday',
  },

  theme: {
    label: 'Theme',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
  },

  nav: {
    /** The bottom bar on a phone. */
    label: 'Main',
    /** The tab bar at the top. */
    tabBarLabel: 'Project',
    more: 'More',
    /** A tab's name with its count in words. */
    withCount: (label: string, count: number) =>
      count > 0 ? `${label}, ${count} waiting on you` : label,
    demoData: 'Demo data',
    activity: 'Activity',
    yourTurn: 'Your turn',
    board: 'Board',
    ship: 'Ship',
    marketing: 'Marketing',
    testing: 'Testing',
    launch: 'Launch',
    storeListings: 'Store listings',
    assets: 'Assets',
    posts: 'Posts',
    analytics: 'Analytics',
    reference: 'Reference',
    decisions: 'Decisions',
    releases: 'Releases',
    inbox: 'Inbox',
    money: 'Money',
    docs: 'Docs',
    links: 'Links',
    connectors: 'Connectors',
    agentsAndTokens: 'Agents and tokens',
    sessions: 'Agent sessions',
    /** The bar of sections of Ship, Marketing or Reference. */
    sectionsLabel: (tab: string) => `${tab} sections`,
    assistant: 'Assistant',
    settings: 'Settings',
    projects: 'Projects',
    members: 'Members',
    general: 'General',
    settingsLabel: 'Settings sections',
    workspaceMenu: (name: string) => `Workspace ${name}`,
    workspaces: 'Workspaces',
    newWorkspace: 'New workspace',
    /** The home page across every workspace. */
    home: 'Home',
    removeDemo: 'Remove demo data',
    removeDemoTitle: 'Remove the demo data?',
    removeDemoBody:
      'The demo workspace disappears and cannot be opened again. Its data stays in the local database but is never shown; for none at all, start with an empty data folder. Then Turnkeel asks what you are shipping.',
    removeDemoConfirm: 'Remove demo data',
    accountMenu: 'Account',
    accountSettings: 'Account settings',
    signOut: 'Sign out',
    localOwner: 'Local mode. No accounts.',
  },

  /** The home page across every workspace and product. */
  home: {
    title: 'Home',
    intro: 'What waits on you, and how each product does this month, in every workspace.',
    what: 'the home page',
    noWorkspacesTitle: 'You are in no workspace yet',
    noWorkspacesBody: 'Make one, or ask for an invitation to a workspace.',
    makeWorkspace: 'Make a workspace',
    /** The count of a workspace or a project, the number beside Your turn there. */
    waiting: (count: number) =>
      count === 0
        ? 'Nothing waits on you'
        : count === 1
          ? '1 thing waits on you'
          : `${count} things wait on you`,
    /** A project's count takes in the lines of the whole workspace, as Your turn does. */
    ofWorkspace: (count: number) =>
      count === 1
        ? '1 of them is for the whole workspace'
        : `${count} of them are for the whole workspace`,
    allProjects: 'Across all projects',
    workspaceLines: 'For the whole workspace',
    more: (count: number) => (count === 1 ? '1 more in Your turn' : `${count} more in Your turn`),
    noProjectsTitle: 'No projects yet',
    noProjectsBody: 'This workspace has no project you can open. Open the workspace to make one.',
    noProjectsReadBody: 'This workspace has no project you can open yet.',
    /** Money of a project this month, as Money's front page says it. */
    money: (month: string) => `Money in ${month}, projected`,
    openMoney: 'Open Money',
    openMoneyOf: (project: string) => `Open Money of ${project}`,
    moneyOff: 'Money is turned off in this workspace.',
    /** How long a line has waited: "just now", "4 min", "2 days". */
    waited: (minutes: number) => agoWords(minutes),
  },

  projectSwitcher: {
    label: 'Project',
    button: (name: string) => `Switch project, now ${name}`,
    all: 'All projects',
    none: 'No projects yet',
    newProject: 'New project',
    manage: 'Manage projects',
  },

  signIn: {
    title: 'Sign in to Turnkeel',
    emailLabel: 'Email address',
    sendLink: 'Send a sign-in link',
    linkSentTitle: 'Check your mail',
    linkSent: (email: string) =>
      `If ${email} can sign in, a link is on its way. It works once, for 10 minutes.`,
    mailNotConfigured: 'Mail is not configured. The link is in the server log.',
    useOtherAddress: 'Use another address',
    or: 'or',
    github: 'Continue with GitHub',
    google: 'Continue with Google',
    githubName: 'GitHub',
    googleName: 'Google',
    passkey: 'Sign in with a passkey',
    passkeyFailed: 'The passkey sign-in did not finish.',
    invitationOnly: 'This server takes new accounts by invitation only.',
    linkInvalid: 'This sign-in link was already used or has expired. Ask for a new one.',
    failed: 'The sign-in did not finish. Try again.',
    tooMany: 'Too many sign-in requests came from this network. Wait a minute, then try again.',
    openSignup: 'Anyone who can reach this server can create an account.',
    localTitle: 'This install runs in local mode',
    localBody:
      'Local mode has no accounts or passwords: a browser gets in with a one-time address. Press Enter in the terminal where turnkeel runs to get one, and open it here. An address works once. If turnkeel was started without a terminal, start it again.',
    localRetry: 'I opened it. Try again',
  },

  welcome: {
    /** The first run's one question. */
    title: 'What are you shipping?',
    intro:
      'Name your first product and say what it is. Turnkeel makes your workspace and a project for this product. Add your other products as projects later.',
    firstIntro:
      'You are the first person on this server, so you become the Owner of its first workspace.',
    productLabel: 'Name',
    productHint: 'The name of the product, such as Field Notes.',
    nameLabel: 'Workspace name',
    nameHint: 'Your company, or your own name. It holds all your products.',
    slugLabel: 'Address',
    slugHint: 'Part of every link to this workspace.',
    keyLabel: 'Card key',
    keyHint: '2 to 6 letters. Card numbers start with it, such as FN-12.',
    handleLabel: 'Your handle',
    handleHint: 'How people and agents name you here, written @handle.',
    yourNameLabel: 'Your name',
    kindLabel: 'What it is',
    /** Which tabs start off for the kind chosen. */
    kindHint: (off: readonly ViewId[]) =>
      off.length === 0
        ? 'Every tab starts on. Settings, Tabs turns off the ones you do not use.'
        : `${listOf(viewNames(off))} start off. Settings, Tabs turns them on.`,
    more: 'More',
    create: 'Create workspace',
    /** "Look at the demo first": local mode, while the install has no workspace. */
    demoTitle: 'Not ready to name it?',
    demoBody:
      'The demo is an invented app with invented people, with something in every tab. Remove demo data, in the workspace menu, brings you back here.',
    demo: 'Look at the demo first',
    demoFailed: (reason: string) => `The demo could not be loaded: ${reason}`,
    noneTitle: 'You are not in a workspace on this server',
    noneBody:
      'Accounts here join through an invitation. Ask an Owner or Admin of a workspace to invite the address you signed in with.',
    signedInAs: (email: string) => `You are signed in as ${email}.`,
    newTitle: 'New workspace',
  },

  invitation: {
    title: 'Invitation',
    toWorkspace: (input: { inviter: string; workspace: string; role: Role }) =>
      `${input.inviter} invited you to the workspace ${input.workspace} as ${roleNames[input.role]}.`,
    toProject: (input: { inviter: string; workspace: string; project: string; role: Role }) =>
      `${input.inviter} invited you to the project ${input.project} in the workspace ${input.workspace} as ${roleNames[input.role]}.`,
    sentTo: (email: string) => `The invitation was sent to ${email}. Sign in with that address.`,
    expires: (when: string) => `It works once, until ${when}.`,
    accept: 'Accept the invitation',
    wrongAccount: (input: { signedIn: string; invited: string }) =>
      `You are signed in as ${input.signedIn}, and the invitation is for ${input.invited}. Sign out, then sign in with the invited address.`,
    invalidTitle: 'This invitation cannot be used',
    invalidBody:
      'It was already used, was revoked or has expired, or the link is incomplete. Ask whoever invited you for a new one.',
    missingToken: 'The link has no invitation in it.',
    localMode: 'This install runs in local mode, which has no sign-in and no invitations.',
    joined: (workspace: string) => `You joined ${workspace}.`,
  },

  workspace: {
    settingsTitle: 'Workspace settings',
    settingsIntro: 'The name and the address of this workspace.',
    nameLabel: 'Name',
    slugLabel: 'Address',
    slugHint: 'Part of every link to this workspace. Changing it breaks links people saved.',
    readOnly: 'Only an Owner or Admin can change these.',
    signInTitle: 'Sign-in',
    providersUnverified: (providers: string[]) => {
      const names = providers.join(' and ');
      return `Sign-in with ${names} is turned on for this server. It is built and has not been run against ${names} yet, so it is unverified. Sign-in by link is the tested way in.`;
    },
    nothingHereTitle: 'Nothing to show yet',
    testerBody:
      'Your role here is Tester, and a Tester sees only Testing, in the projects they are asked to test.',
    noAccessBody: 'Your role has no tab to show here. Ask an Owner or Admin for another role.',
  },

  projects: {
    title: 'Projects',
    intro:
      'A project is one product: an app, a website, an extension or a library. Make one for each product you run.',
    new: 'New project',
    newTitle: 'New project',
    editTitle: (name: string) => `Project ${name}`,
    emptyTitle: 'No projects yet',
    emptyBody: 'Create the first project to give its work a place.',
    emptyBodyReadOnly: 'An Owner or Admin creates projects. None exists yet.',
    showArchived: 'Show archived projects',
    archivedBadge: 'Archived',
    columns: {
      name: 'Name',
      key: 'Key',
      kind: 'Kind',
      locales: 'Languages',
      launchDate: 'Launch date',
    },
    noLaunchDate: 'Not set',
    nameLabel: 'Name',
    keyLabel: 'Key',
    keyHint: '2 to 6 letters. Card numbers start with it, such as APP-12.',
    slugLabel: 'Address',
    slugHint: 'Part of every link to this project.',
    kindLabel: 'Kind',
    kind: (kind: ProjectKind) => kindNames[kind],
    /** Where an app ships. */
    shipsLabel: 'Where it ships',
    shipsHint: 'Get started suggests the store connectors and the launch files that fit.',
    ships: {
      unsaid: 'Not decided yet',
      appstore: 'App Store',
      play: 'Google Play',
      both: 'App Store and Google Play',
      web: 'The web',
    },
    localesLabel: 'Languages',
    localesHint: 'Language tags with commas between them, such as en, de, pt-BR.',
    launchDateLabel: 'Launch date',
    launchFollows: (milestone: string | null) =>
      `${milestone === null ? 'Follows the launch milestone' : `Follows the milestone ${milestone}`}. A new date moves the milestone; clearing the date unlinks it, and the milestone stays.`,
    create: 'Create project',
    created: (name: string) => `Created the project ${name}.`,
    archive: 'Archive project',
    archiveTitle: (name: string) => `Archive ${name}?`,
    archiveBody:
      'An archived project is read-only and leaves the project switcher. Its data and events are kept. A project cannot be deleted, and archiving cannot be undone here.',
    archived: (name: string) => `Archived the project ${name}.`,
    archivedNotice: (when: string) => `This project was archived on ${when} and is read-only.`,
    readOnly: 'Only an Owner or Admin can change a project.',
    changelogPublicLabel: 'Public changelog',
    changelogPublicHint: (path: string) =>
      `When it is on, the releases an Owner or Admin publishes are shown at ${path}, with an Atom feed, to anyone and without sign-in. Only the published text, version and date are shown. It is off until someone turns it on.`,
    changelogPublicOn: 'On',
    changelogPublicOff: 'Off',
    backToList: 'All projects',
    what: 'The projects',
  },

  members: {
    title: 'Members',
    intro: 'Everyone who holds a role in this workspace or in one of its projects.',
    what: 'The members',
    columns: { person: 'Person', handle: 'Handle', role: 'Role', projects: 'Project roles' },
    roleLabel: (name: string) => `Role of ${name}`,
    noHandle: 'No handle',
    projectRole: (input: { project: string; role: Role }) =>
      `${roleNames[input.role]} in ${input.project}`,
    remove: 'Remove',
    removeLabel: (name: string) => `Remove ${name}`,
    removeTitle: (name: string) => `Remove ${name}?`,
    removeBody:
      'This takes away their role in the workspace and in every project of it. Their account stays, and what they did stays in the event log.',
    removed: (name: string) => `Removed ${name}.`,
    roleChanged: (input: { name: string; role: Role }) =>
      `${input.name} is now ${roleNames[input.role]}.`,
    invite: 'Invite',
    inviteTitle: 'Invite someone',
    inviteIntro: 'They get a link by mail. It works once, for 7 days, for that address only.',
    emailLabel: 'Email address',
    roleFieldLabel: 'Role',
    scopeLabel: 'Access to',
    wholeWorkspace: 'The whole workspace',
    scopeProject: (name: string) => `Only the project ${name}`,
    send: 'Send invitation',
    mailSent: (email: string) => `Invitation sent to ${email}.`,
    mailLogged: (email: string) =>
      `Invitation for ${email} created. Mail is not configured. The link is in the server log.`,
    mailFailed: (email: string) =>
      `The invitation for ${email} exists, but the mail could not be sent. Check the mail settings of the server, then invite again to send a new link.`,
    mailNotConfigured: 'Mail is not configured. The link is in the server log.',
    localMode:
      'Local mode has no sign-in, so nobody can be invited. To work with others, run a server with sign-in. To take this local install there, stop Turnkeel and run turnkeel owner claim --email <your address> first.',
    pendingTitle: 'Pending invitations',
    pendingWhat: 'The invitations',
    pendingEmpty: 'No invitation is waiting to be accepted.',
    pendingColumns: { email: 'Sent to', role: 'Role', expires: 'Works until' },
    pendingScope: (project: string | null) => (project === null ? 'Workspace' : project),
    revoke: 'Revoke',
    revokeLabel: (email: string) => `Revoke the invitation for ${email}`,
    revokeTitle: (email: string) => `Revoke the invitation for ${email}?`,
    revokeBody: 'The link in their mail stops working.',
    revoked: (email: string) => `Revoked the invitation for ${email}.`,
    onlyYou: 'You are the only person here.',
    projectRoles: 'Project roles',
    projectRolesLabel: (name: string) => `Project roles of ${name}`,
    projectRolesTitle: (name: string) => `Project roles of ${name}`,
    projectRolesIntro:
      'A role in a project replaces the workspace role in that project. An Owner stays Owner everywhere.',
    projectField: 'Project',
    projectRoleField: 'Role in this project',
    noProjectRole: 'No role of its own',
    noProjectRoleNote: 'The workspace role holds here, if they have one.',
    projectRoleSaved: (input: { name: string; project: string; role: Role }) =>
      `${input.name} is now ${roleNames[input.role]} in ${input.project}.`,
    projectRoleRemoved: (input: { name: string; project: string }) =>
      `${input.name} no longer has a role of their own in ${input.project}.`,
  },

  account: {
    title: 'Account',
    intro: 'Your account on this server.',
    nameLabel: 'Display name',
    nameHint: 'Shown next to what you do.',
    emailLabel: 'Email address',
    localNote:
      'This install runs in local mode, which has no sign-in. The name and passkeys belong to sign-in, so only your handle can be changed here.',
    handlesTitle: 'Handles',
    handlesIntro: 'How people and agents name you in each workspace, written @handle.',
    handleLabel: (workspace: string) => `Handle in ${workspace}`,
    noHandles: 'You hold only project roles, so you have no handle.',
    passkeysTitle: 'Passkeys',
    passkeysIntro:
      'A passkey signs you in with your device instead of a link by mail. Add one here after you have signed in another way.',
    passkeysWhat: 'Your passkeys',
    noPasskeys: 'You have no passkey yet.',
    passkeyNameLabel: 'Name for the new passkey',
    passkeyNameHint: 'Such as the device it is on.',
    addPasskey: 'Add a passkey',
    adding: 'Waiting for your device',
    passkeyAdded: 'Passkey added.',
    passkeyFailed: 'The passkey was not added.',
    passkeyUnnamed: 'Passkey',
    passkeyAddedOn: (when: string) => `Added ${when}`,
    removePasskeyLabel: (name: string) => `Remove the passkey ${name}`,
    removePasskeyTitle: (name: string) => `Remove the passkey ${name}?`,
    removePasskeyBody: 'You can no longer sign in with it. You can add it again later.',
    passkeyRemoved: 'Passkey removed.',
    passkeysUnsupported: 'This browser does not support passkeys.',
  },

  activity: {
    // Routines: "made the routine Weekly post", "finished a run of …".
    routines: {
      changed: (change: string | null) =>
        change === 'created'
          ? 'made the routine'
          : change === 'removed'
            ? 'removed the routine'
            : change === 'paused'
              ? 'paused the routine'
              : change === 'resumed'
                ? 'resumed the routine'
                : change === 'blocked'
                  ? 'cancelled the waiting runs of the routine'
                  : change === 'ended'
                    ? 'ended the one-time routine'
                    : 'changed the routine',
      run: (type: string, failed: boolean) =>
        type === 'routine_run.created'
          ? 'made a run of the routine'
          : type === 'routine_run.started'
            ? 'started a run of the routine'
            : type === 'routine_run.finished'
              ? failed
                ? 'said a run failed, of the routine'
                : 'finished a run of the routine'
              : type === 'routine_run.missed'
                ? 'marked missed a run of the routine'
                : 'marked seen a run of the routine',
      aRoutine: 'a routine',
    },
    /** The tabs of before the six tabs that events written then still name. */
    oldTabNames: { review: 'Review', agents: 'Agents' } as Record<string, string>,
    title: 'Activity',
    intro: 'What happened in this workspace, newest first.',
    what: 'The activity',
    export: 'Export',
    exportHint: 'Download the whole event log as NDJSON',
    filtersLabel: 'Filters',
    filtersToggle: (active: number) => (active === 0 ? 'Filters' : `Filters (${active})`),
    filtersToggleLabel: (active: number) =>
      active === 0 ? 'Filters' : active === 1 ? 'Filters, 1 set' : `Filters, ${active} set`,
    newLines: (count: number) => (count === 1 ? '1 new line' : `${count} new lines`),
    channel: 'Channel',
    areaLabel: 'Area',
    allAreas: 'All areas',
    area: (area: EventArea) => areaNames[area],
    actorLabel: 'Who',
    anyone: 'Anyone',
    fromLabel: 'From',
    toLabel: 'To',
    clear: 'Clear filters',
    /** An `import.item`: which kind of row the importer wrote, by `data.object`. */
    imported: {
      verb: 'imported',
      after: 'from the project hub',
      noun: (object: string | null): string =>
        ({
          card: 'the card',
          status_line: 'a status line of',
          party: 'the party',
          agent: 'the agent',
          build: 'the build',
          feature: 'a feature of a build',
          step: 'a step of a build',
          step_note: 'a note on the step',
          step_mark: 'a done mark on the step',
          step_reply: 'a reply under the step',
          asset_group: 'the asset group',
          asset: 'the asset',
          asset_variant: 'a variant of an asset',
          asset_decision: 'a decision on an asset',
          asset_note: 'a note on an asset',
          post: 'the post',
          link_group: 'the link group',
          link: 'the link',
          cost_line: 'the cost line',
          file: 'the file',
        })[object ?? ''] ?? 'a row',
      featureMark: 'a done mark on the feature',
      /** A later run with `--repo` that changed a row an earlier run wrote. */
      changed: {
        files: { before: 'added the files of the post', after: 'from the checkout' },
        versions: {
          before: 'recorded again the versions of the imported decision on',
          after: 'with the files from the checkout',
        },
      },
    },
    emptyTitle: 'Nothing has happened yet',
    emptyBody:
      'A line appears here when someone creates or changes a project, invites a person or changes a setting.',
    emptyFilteredTitle: 'Nothing matches these filters',
    emptyFilteredBody: 'Widen the dates or clear a filter to see more.',
    older: 'Show older',
    end: 'This is where the log begins.',
    via: (via: EventVia) => viaNames[via],
    viaLabel: (via: EventVia) => `Through: ${viaNames[via]}`,
    agent: 'Agent',
    system: 'System',
    times: (count: number) => `${count} saves, shown as one line`,
    live: 'Live',
    liveHint: 'New lines appear by themselves.',
    paused: 'Not live',
    pausedHint: 'The live connection is down. The app is trying again.',
    needsProjectTitle: 'Pick a project',
    needsProjectBody: 'You hold roles in single projects, so Activity shows one project at a time.',
    someone: 'someone',
    aPerson: 'a person',
    /** An agent's action on a person's word: "on Sam's word". */
    onWordOf: (person: string) => `on ${possessive(person)} word`,
    theProject: 'the project',
    aProject: 'a project',
    anAgent: 'an agent',
    /** One function per event type: the words before the linked item, and the words after it. */
    event: {
      'workspace.created': () => ({ before: 'created the workspace', after: '' }),
      'workspace.updated': (changed: readonly string[]) => ({
        before: `changed the ${fields(changed)} of the workspace`,
        after: '',
      }),
      'workspace.transferred': (to: string) => ({
        before: 'handed the workspace',
        after: `over to ${to}`,
      }),
      'workspace.deleted': () => ({ before: 'deleted the workspace', after: '' }),
      'workspace.tabs_kept': (off: readonly string[]) => ({
        before: 'kept the tabs of the workspace',
        after: off.length === 0 ? 'with every tab on' : `with ${listOf([...off])} off`,
      }),
      'project.created': () => ({ before: 'created the project', after: '' }),
      'project.updated': (changed: readonly string[]) => ({
        before: `changed the ${fields(changed)} of the project`,
        after: '',
      }),
      'project.archived': () => ({ before: 'archived the project', after: '' }),
      'member.invited': (input: { role: Role | null; project: string | null }) => ({
        before: 'invited',
        after: [
          input.role === null ? '' : `as ${roleNames[input.role]}`,
          input.project === null ? '' : `to the project ${input.project}`,
        ]
          .filter(Boolean)
          .join(' '),
      }),
      'member.invite_revoked': (replaced: boolean) => ({
        before: replaced ? 'replaced the invitation for' : 'revoked the invitation for',
        after: '',
      }),
      'member.joined': (input: { self: boolean; role: Role | null; project: string | null }) => {
        const where = input.project === null ? 'the workspace' : `the project ${input.project}`;
        const as = input.role === null ? '' : ` as ${roleNames[input.role]}`;
        return input.self
          ? { before: `joined ${where}${as}`, after: '' }
          : { before: 'added', after: `to ${where}${as}` };
      },
      'member.role_changed': (input: {
        from: Role | null;
        to: Role | null;
        project: string | null;
      }) => ({
        before: 'changed the role of',
        after: [
          input.from === null || input.to === null
            ? ''
            : `from ${roleNames[input.from]} to ${roleNames[input.to]}`,
          input.project === null ? '' : `in the project ${input.project}`,
        ]
          .filter(Boolean)
          .join(' '),
      }),
      'member.handle_changed': (input: { from: string | null; to: string | null }) => ({
        before:
          input.from === null || input.to === null
            ? 'changed their handle'
            : `changed their handle from @${input.from} to @${input.to}`,
        after: '',
      }),
      'member.claimed': () => ({ before: 'gave a sign-in address to', after: '' }),
      'member.removed': (project: string | null) => ({
        before: 'removed',
        after: project === null ? 'from the workspace' : `from the project ${project}`,
      }),
      'agent.created': () => ({ before: 'added the agent', after: '' }),
      'agent.updated': (changed: readonly string[]) => ({
        before: `changed the ${fields(changed)} of the agent`,
        after: '',
      }),
      'agent.disabled': () => ({ before: 'disabled the agent', after: '' }),
      'token.created': (prefix: string | null) => ({
        before: 'made a token',
        after: prefix === null ? 'for the agent' : `(${prefix}…) for the agent`,
      }),
      'token.updated': (input: {
        prefix: string | null;
        on: readonly string[];
        off: readonly string[];
        /** The monthly cap of spend:commit after the change, formatted, when it changed. */
        spendCap?: string | null;
        /** The preset the token follows after the change, when it changed; null for Custom. */
        preset?: 'reporter' | 'builder' | null;
        /** The preset whose new scopes the system gave the token at a start. */
        follows?: 'reporter' | 'builder' | null;
      }) => {
        const presetName = (preset: 'reporter' | 'builder') =>
          preset === 'reporter' ? 'Reporter' : 'Builder';
        const on = input.on.length > 0 ? `turned on ${input.on.join(', ')}` : '';
        return {
          before:
            [
              on,
              input.off.length > 0 ? `turned off ${input.off.join(', ')}` : '',
              input.spendCap ? `set the monthly spending cap to ${input.spendCap}` : '',
              input.preset === undefined
                ? ''
                : input.preset === null
                  ? 'made the scopes custom'
                  : `chose the preset ${presetName(input.preset)}`,
            ]
              .filter(Boolean)
              .join(' and ') || 'changed the scopes that act on your word',
          after: [
            input.prefix === null ? 'on a token of the agent' : `on the token ${input.prefix}…`,
            input.follows ? `, which follows ${presetName(input.follows)}` : '',
          ].join(''),
        };
      },
      'token.revoked': (input: { prefix: string | null; reason: string | null }) => ({
        before: 'revoked a token',
        after: [
          input.prefix === null ? 'of the agent' : `(${input.prefix}…) of the agent`,
          input.reason === 'member_removed'
            ? 'because the person who made it left the workspace'
            : input.reason === 'role_changed'
              ? 'because the person who made it no longer manages agents'
              : input.reason === 'demo_removed'
                ? 'because the demo data was removed'
                : '',
        ]
          .filter(Boolean)
          .join(', '),
      }),
      'access.denied': (input: {
        action: string | null;
        rule: string | null;
        repeats: number;
      }) => ({
        // The rule stays in the event's data and the export, not in the line (COPY-PASS I2).
        before: `was refused: ${input.action ?? 'an action'}`,
        after:
          input.repeats <= 0
            ? ''
            : `and ${input.repeats} more ${input.repeats === 1 ? 'time' : 'times'} since the line before`,
      }),
    },
    card: {
      created: 'created the card',
      updated: 'changed the card',
      moved: 'moved the card',
      statusAdded: 'added a status line to the card',
      statusAddedDrafted: 'added a status line, drafted by the assistant, to the card',
      archived: 'archived the card',
      aCard: 'a card',
      partyRenamed: (from: string | null, to: string | null) =>
        from === null || to === null ? 'renamed a party' : `renamed the party ${from} to ${to}`,
    },
    /** The assistant's events. Never the prompt, the answer or the key. */
    assistant: {
      /** Followed by the card's key as a link, then `calledAfter`. */
      called: 'asked the assistant to catch up on',
      calledAfter: (outcome: string | null) => assistantOutcome(outcome),
      calledNoCard: (outcome: string | null) => {
        const how = assistantOutcome(outcome);
        return `asked the assistant to catch up on a card${how === '' ? '' : ` ${how}`}`;
      },
      /** Summarise feedback: followed by the build's key, then `calledAfter`. */
      summarised: 'asked the assistant to summarise the feedback on the build',
      summarisedNoBuild: (outcome: string | null) => {
        const how = assistantOutcome(outcome);
        return `asked the assistant to summarise the feedback on a build${how === '' ? '' : ` ${how}`}`;
      },
      /** The features that name an item, followed by the item's key, version or noun. */
      featureCalled: {
        translate_asset: 'asked the assistant for a translation of',
        translate_post: 'asked the assistant for a translation of a post',
        draft_card: 'asked the assistant to draft a card from',
        draft_reply: 'asked the assistant to draft a reply to',
        draft_changelog: 'asked the assistant to draft the changelog of',
        draft_posts: 'asked the assistant to draft posts',
      } as Record<string, string>,
      settingsChanged: (changed: readonly string[]) =>
        `changed the assistant’s ${listOf(changed.map((name) => assistantFieldNames[name] ?? name)) || 'settings'}`,
    },
    /** The nouns of the items; `named` goes before the item's link. */
    noun: itemNouns,
    /**
     * The events of the items: the verb, which the item's noun follows, and the words after
     * the item. What people or agents wrote (notes, replies, evidence, a decision's
     * words) is never part of the line; only an item's own name is, as its link.
     */
    verb: {
      'session.started': (tool: AgentKind | null) => ({
        verb: 'started',
        after: tool === null ? '' : `in ${agentKindNames[tool]}`,
      }),
      'session.updated': (input: { state: SessionState | null; renamed: boolean }) =>
        input.state !== null
          ? { verb: 'set', after: `to ${sessionStateNames[input.state]}` }
          : { verb: input.renamed ? 'renamed' : 'changed', after: '' },
      'session.needs_you': () => ({ verb: 'marked', after: 'as needing you' }),
      'session.linked': (to: 'card' | 'gate' | 'build' | null) => ({
        verb: 'linked',
        after: to === null ? '' : `to a ${to}`,
      }),
      'session.ended': () => ({ verb: 'ended', after: '' }),
      'session.dismissed': () => ({ verb: 'dismissed', after: '' }),
      'gate.synced': (
        how: 'added' | 'removed' | 'restored' | 'changed',
        changed: readonly string[],
      ) => ({
        verb:
          how === 'added'
            ? 'added'
            : how === 'removed'
              ? 'removed'
              : how === 'restored'
                ? 'brought back'
                : changed.length === 0
                  ? 'synced'
                  : `changed the ${fields(changed)} of`,
        after: '',
      }),
      'gate.checked': (result: 'pass' | 'fail' | null) => ({
        verb: 'checked',
        after: result === 'pass' ? 'and it passed' : result === 'fail' ? 'and it failed' : '',
      }),
      'gate.state_changed': (state: GateState | null) =>
        state === null
          ? { verb: 'changed the state of', after: '' }
          : { verb: 'marked', after: `as ${gateStateNames[state]}` },
      'gate.change_held': (remove: boolean) => ({
        verb: remove ? 'held the removal of' : 'held a change to how it passes for',
        after: 'until a person confirms it',
      }),
      'gate.change_confirmed': (removed: boolean) => ({
        verb: removed ? 'confirmed the removal of' : 'confirmed the change from the repository to',
        after: '',
      }),
      'gate.file_change_made': (made: boolean) => ({
        verb: made ? 'made in the app' : 'edited in the app',
        after: 'for the repository',
      }),
      'gate.file_change_withdrawn': () => ({
        verb: 'withdrew the change made in the app to',
        after: '',
      }),
      'gate.file_change_delivered': () => ({
        verb: 'synced the change made in the app to',
        after: '',
      }),
      'listing.synced': (how: 'added' | 'removed' | 'restored' | 'changed', untick: number) => ({
        verb:
          how === 'added'
            ? 'added'
            : how === 'removed'
              ? 'removed'
              : how === 'restored'
                ? 'brought back'
                : 'synced',
        after:
          untick > 0
            ? `and cleared ${untick === 1 ? 'a tick' : `${untick} ticks`}, because the text changed`
            : '',
      }),
      'listing.row_marked': (row: string | null, done: boolean) => ({
        verb: done ? 'ticked a row of' : 'unticked a row of',
        after: row === null ? '' : `(${row})`,
      }),
      'connector.installed': (connector: string | null) => ({
        verb: 'set up',
        after: connector === null ? '' : `of ${connector}`,
      }),
      'connector.updated': (input: { disabled: boolean | null; changed: readonly string[] }) => ({
        verb:
          input.disabled === true
            ? 'disabled'
            : input.disabled === false
              ? 'enabled'
              : input.changed.some((name) => name.startsWith('secrets.'))
                ? 'changed the secrets or settings of'
                : 'changed',
        after: '',
      }),
      'connector.removed': () => ({ verb: 'removed', after: '' }),
      'connector.failed': () => ({ verb: 'marked', after: 'as failing' }),
      'connector.recovered': () => ({ verb: 'marked', after: 'as working again' }),
      'build.posted': (again: boolean) => ({ verb: 'posted', after: again ? 'again' : '' }),
      /** A person's scenario in Testing. */
      scenario: (change: 'added' | 'changed' | 'removed') =>
        ({
          added: { verb: 'added a scenario to', after: '' },
          changed: { verb: 'changed a scenario of', after: '' },
          removed: { verb: 'removed a scenario from', after: '' },
        })[change],
      'build.archived': () => ({ verb: 'archived', after: '' }),
      'build.testers_changed': () => ({ verb: 'changed the testers of', after: '' }),
      'feedback.read': () => ({ verb: 'read the new feedback on', after: '' }),
      'asset_group.changed': (input: { created: boolean; fields: readonly string[] }) => ({
        verb: input.created ? 'added' : `changed the ${fields(input.fields)} of`,
        after: '',
      }),
      'asset.proposed': () => ({ verb: 'proposed', after: '' }),
      'asset.changed': () => ({ verb: 'changed', after: '' }),
      'asset.decided': (status: 'waiting' | 'approved' | 'changes' | null) => ({
        verb:
          status === 'approved'
            ? 'approved'
            : status === 'changes'
              ? 'asked for changes to'
              : status === 'waiting'
                ? 'reopened'
                : 'decided on',
        after: '',
      }),
      'asset.decision_cleared': () => ({ verb: 'cleared the decision on', after: '' }),
      'asset.noted': () => ({ verb: 'wrote a note on', after: '' }),
      'asset.archived': () => ({ verb: 'archived', after: '' }),
      // Posts. The text of a post is not shown here, only its title or channel.
      'post.created': () => ({ verb: 'added', after: '' }),
      'post.updated': (draft: boolean) => ({
        verb: 'edited',
        after: draft ? 'with a text drafted by the assistant' : '',
      }),
      'post.submitted': () => ({ verb: 'submitted', after: 'for approval' }),
      'post.approved': () => ({ verb: 'approved', after: '' }),
      'post.unapproved': () => ({ verb: 'undid the approval of', after: '' }),
      'post.skipped': () => ({ verb: 'skipped', after: '' }),
      'post.restored': () => ({ verb: 'brought back', after: '' }),
      'post.sending': () => ({ verb: 'started sending', after: 'to the outbound webhook' }),
      'post.posted': (byJob: boolean) =>
        byJob
          ? { verb: 'sent', after: 'through the outbound webhook' }
          : { verb: 'marked', after: 'as posted' },
      'post.unposted': () => ({ verb: 'unmarked', after: 'as posted' }),
      'post.failed': () => ({ verb: 'could not send', after: 'to the outbound webhook' }),
      'decision.proposed': () => ({ verb: 'recorded', after: '' }),
      'decision.decided': (input: {
        status: DecisionStatus | null;
        replaces: boolean;
        /** The person an agent acted for: "on Sam's word". */
        onWordOf?: string | null;
      }) => {
        const replaces = [
          input.onWordOf ? `on ${possessive(input.onWordOf)} word` : '',
          input.replaces ? 'in place of an earlier one' : '',
        ]
          .filter(Boolean)
          .join(', ');
        switch (input.status) {
          case 'accepted':
          case 'rejected':
          case 'parked':
            return { verb: input.status, after: replaces };
          case 'done':
            return { verb: 'marked', after: ['done', replaces].filter(Boolean).join(', ') };
          case 'proposed':
            return { verb: 'reopened', after: replaces };
          default:
            return { verb: 'changed the status of', after: replaces };
        }
      },
      'decision.updated': (changed: readonly string[]) => ({
        verb: `changed the ${fields(changed)} of`,
        after: '',
      }),
      'file.uploaded': () => ({ verb: 'uploaded', after: '' }),
      // Releases. A changelog's text is not shown here.
      'release.created': () => ({ verb: 'created', after: '' }),
      'release.updated': (input: { fields: readonly string[]; drafted: boolean }) => ({
        verb: input.fields.length === 0 ? 'changed' : `changed the ${fields(input.fields)} of`,
        after: input.drafted ? 'with a changelog drafted by the assistant' : '',
      }),
      'release.published': (again: boolean) => ({
        verb: 'published',
        after: again ? 'to the public changelog again' : 'to the public changelog',
      }),
      'release.unpublished': () => ({ verb: 'took', after: 'off the public changelog' }),
      // The Inbox. What a sender wrote is not shown here.
      'inbox.received': (source: InboxSource | null, byHand: boolean) => ({
        verb: byHand ? 'added' : 'received',
        after: byHand
          ? 'by hand'
          : source === null
            ? ''
            : {
                email: 'by mail',
                appstore_review: 'from the App Store',
                play_review: 'from Google Play',
                manual: 'by hand',
              }[source],
      }),
      'inbox.carded': () => ({ verb: 'made a card from', after: '' }),
      'inbox.archived': () => ({ verb: 'archived', after: '' }),
    },
    /** Docs and Links. */
    docs: {
      synced: 'synced',
      theDocs: 'the docs',
      // "synced the docs (7 new, 1 removed)": the counts in brackets after the link.
      counts: (created: number, updated: number, removed: number) => {
        const counts = [
          created > 0 ? `${created} new` : null,
          updated > 0 ? `${updated} changed` : null,
          removed > 0 ? `${removed} removed` : null,
        ].filter(Boolean);
        return counts.length === 0 ? '' : `(${counts.join(', ')})`;
      },
      linkChange: (change: string | null) => {
        const words: Record<string, [string, string]> = {
          group_added: ['made the link group', 'made a link group'],
          group_changed: ['changed the link group', 'changed a link group'],
          group_moved: ['moved the link group', 'moved a link group'],
          group_removed: ['removed the link group', 'removed a link group'],
          link_added: ['added the link', 'added a link'],
          link_changed: ['changed the link', 'changed a link'],
          link_moved: ['moved the link', 'moved a link'],
          link_removed: ['removed the link', 'removed a link'],
        };
        const [named, unnamed] = words[change ?? ''] ?? ['changed the links', 'changed the links'];
        return { named, unnamed };
      },
    },
    /** Money: what changed, never an amount. */
    money: {
      signals: (count: number | null, byConnector: boolean, csv: boolean) => {
        const what = count === null ? 'figures' : plural(count, 'figure', 'figures');
        return byConnector
          ? `brought in ${what} for Money`
          : csv
            ? `uploaded ${what} as CSV`
            : `reported ${what} to Money`;
      },
      changed: (type: string, change: string | null, name: string | null) => {
        const noun =
          type === 'plan.changed'
            ? 'the price plan'
            : type === 'cost_line.changed'
              ? 'the cost line'
              : 'the scenario';
        // A suggested receipt and its answers.
        if (type === 'cost_line.changed') {
          const said =
            change === 'suggested'
              ? 'suggested the receipt'
              : change === 'confirmed'
                ? 'confirmed the receipt'
                : change === 'dismissed'
                  ? 'dismissed the suggested receipt'
                  : change === 'attached'
                    ? 'attached the suggested receipt to the line it duplicates:'
                    : null;
          if (said !== null) return `${said}${name ? ` ${name}` : ''}`;
        }
        const verb = change === 'created' ? 'added' : change === 'removed' ? 'removed' : 'changed';
        return `${verb} ${noun}${name ? ` ${name}` : ''}`;
      },
      rates: 'changed the currency rates',
      removed: 'removed a figure from Money',
      modelRate: (model: string | null) =>
        model === null ? 'changed the rate of a model' : `changed the rate of the model ${model}`,
      /** spend:commit: the amount is formatted, `what` is the agent's line. */
      spendCommitted: (amount: string | null, what: string | null) =>
        `committed ${amount ?? 'a spend'}${what ? ` for ${what}` : ''}`,
      spendDismissed: (amount: string | null) =>
        `cleared the refused spend${amount ? ` of ${amount}` : ''} from Your turn`,
    },
    /** Pull requests a connector brought in: their titles are not shown here. */
    changesReceived: (count: number | null) =>
      count === null
        ? 'brought in pull requests'
        : `brought in ${plural(count, 'pull request', 'pull requests')}`,
    /** The card Make a card made, by its key, after the inbox item. */
    cardMade: 'as the card',
    /** Steps and features have no name in their events, so these lines link to nothing. */
    step: {
      noted: 'wrote a note on a step',
      marked: (done: boolean | null) =>
        done === false ? 'marked a step not done' : 'marked a step done',
      featureMarked: (done: boolean | null) =>
        done === false ? 'marked a feature not done' : 'marked a feature done',
      replied: 'replied under a step',
    },
    unknownEvent: (type: string) => ({
      before: `did something this version cannot describe (${type})`,
      after: '',
    }),
  },

  // --- A spend its token's monthly cap refused, in Your turn ---
  spend: {
    kicker: 'Refused: over the monthly cap',
    asked: (agent: string, person: string, amount: string) =>
      `${agent} asked to commit ${amount} on ${possessive(person)} word.`,
    amount: 'Amount',
    cap: 'Monthly cap',
    spent: (month: string) => `Already committed in ${month}`,
    left: 'Left this month',
    notCommitted:
      'Nothing was committed. The agent was told not to spend it. Raise the cap if it should go ahead, then ask the agent again.',
    dismiss: 'Dismiss',
    dismissed: 'Cleared from Your turn.',
    changeCap: 'Change the cap in Agents and tokens',
    context: (amount: string, spent: string, cap: string, attempts = 1) =>
      [
        `Asked for ${amount}`,
        attempts > 1 ? `${attempts} tries this month` : null,
        `${spent} of ${cap} committed this month`,
      ]
        .filter(Boolean)
        .join(' · '),
    attempts: (count: number) =>
      `The agent asked ${count} times this month over the cap. This is the latest.`,
  },

  pwa: {
    name: 'Turnkeel',
    shortName: 'Turnkeel',
    description: 'One founder, several products, and AI agents handing work to each other.',
  },
} as const;

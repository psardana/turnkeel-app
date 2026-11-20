import type { Role } from '@turnkeel/protocol';

const roleNames: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  reviewer: 'Reviewer',
  tester: 'Tester',
  viewer: 'Viewer',
};

function list(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/**
 * Every sentence a permission answer carries. English only; all of core's strings go
 * through here. An error answer shows the sentence with the number of its rule.
 */
export const messages = {
  roleName: (role: Role) => roleNames[role],
  notFound: 'There is nothing at this address.',
  needsRole: (roles: readonly Role[]) =>
    `This needs the ${list(roles.map((role) => roleNames[role]))} role.`,
  notBuilt: (action: string) => `The action ${action} is not built yet.`,
  systemNotBuilt: 'Nothing runs as the system yet.',
  humanOnly: 'Only a person can do this. No agent token allows it.',
  ownerOnlyWorkspace: 'Only an Owner can delete or transfer the workspace.',
  lastOwner: 'The last Owner cannot be removed or lowered.',
  workspaceLevel: 'A project role does not allow this. It needs a role in the workspace.',
  ownerRole: 'Only an Owner can give the Owner role, or change or remove an Owner.',
  roleAboveOwn: 'Nobody can give a role above their own.',
  testerNeedsProject: 'Tester is a project role. A Tester invitation must name a project.',
  projectRoleKinds: 'A project role is one of Member, Reviewer, Tester or Viewer.',
  workspaceCreate:
    'A new workspace can be created by someone who is already an Owner on this server, or when open sign-up is on.',
  accountByInvitation: 'This server takes new accounts by invitation only.',
  ownHandle: 'A person changes only their own handle.',
  ownProjectRole: 'Nobody gives or takes away their own project role.',
  gateSetByCheck: 'The state of this gate is set only by its check.',
  gateAgentCheck:
    'An agent sets the state only of a gate marked pass: agent. On this gate its check adds evidence.',
  invitationOtherAddress: 'This invitation was sent to another email address.',
  invitationUnverified: 'Confirm your email address before you accept this invitation.',
  noScope: (action: string) => `This token has no scope that allows ${action}.`,
  scenarioPersonOnly:
    "A scenario of the calculator is a person's. money:write lets an agent enter cost lines, receipts, price plans and rates only.",
  noOptInScope: (action: string, scope: string) =>
    `Only a person can do ${action}, unless an Owner gave this token the scope ${scope}, and then only on the word of a person who may do it.`,
  turnNeedsReadScope: 'Reading whose turn it is needs a token with a read scope.',
  noScopeReadsPlaces:
    'No scope of an agent token reads workspaces or projects. An agent names its project by its key.',
  noWorkspaceWide:
    'This token reaches only the projects on it. Something that has no project needs a token with workspaceWide.',
  partyNeedsWorkspaceWide:
    'A party belongs to the workspace, so only a token with workspaceWide makes a new one. Name a party the workspace has.',
  uploadPurpose: (purpose: string) =>
    `This token may not upload a file for ${purpose}. Only the scope that goes with that purpose allows it.`,
  uploadPurposeMissing: 'An upload names its purpose.',
  agentsOnly:
    "No role takes this: it is an agent's, on a person's word. A person does the action directly.",
  relayStatus:
    "On a person's word an agent sets a decision to accepted, rejected or parked: never done, and never what it supersedes.",
  relayReplaces:
    'This decision supersedes another, so changing its status replaces that one. Only a person who may decide does that.',
  onWordNoPerson: 'Name the person whose word this is, as @handle.',
  onWordPersonMayNot: (action: string) =>
    `That person may not do ${action} here themselves, so an agent cannot do it on their word.`,
  optInOwnerOnly: "Only an Owner gives a token a scope that acts on a person's word.",
  agentDecision:
    'An agent records a decision as proposed, and cannot say that it supersedes another.',
  decideToSupersede: 'Only a person who may decide decisions can say which decision this replaces.',
  decideToRecord: 'Only a person who may decide decisions can record one as anything but proposed.',
  decisionEditProposed: 'A decision can be edited only while it is proposed.',
  decisionEditOthers:
    'Only whoever recorded this decision, or a person who may decide decisions, can edit it.',
  signalKind:
    'An agent writes only cost, revenue, usage, subscribers, clicks, sign-ups, views, likes, comments, shares and followers signals.',
  ownNotes: 'A person writes only their own notes and marks.',
  testerReplies: 'A Tester reads the replies under the steps they wrote on, and no others.',
  receiptNeedsMoney: 'A receipt is uploaded by someone who may change money settings.',
  launchMilestone:
    "The launch milestone's date is the project's launch date. Changing that milestone, or removing it, needs an Owner or Admin.",
} as const;

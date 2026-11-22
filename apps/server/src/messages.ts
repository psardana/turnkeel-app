import { PARTY_NAME_MAX, type Role } from '@turnkeel/protocol';

const roleNames: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  reviewer: 'Reviewer',
  tester: 'Tester',
  viewer: 'Viewer',
};

/**
 * Every sentence the server writes: error answers, mail, and the lines it logs.
 * English only; all of the server's strings go through here. The sentences of the
 * permission check are in `@turnkeel/core`.
 */
export const messages = {
  config: {
    cannotStart: 'Turnkeel cannot start with this configuration.',
    notBoolean: (name: string) => `${name} must be true or false.`,
    notUrl: (name: string) => `${name} must be an http or https address.`,
    urlWithPath: (name: string) =>
      `${name} must be an address without a path, such as https://turnkeel.example.com.`,
    notPort: (name: string) => `${name} must be a port number from 1 to 65535.`,
    notPositiveInteger: (name: string) => `${name} must be a whole number above zero.`,
    notPostgresUrl: (name: string) => `${name} must start with postgres:// or postgresql://.`,
    notSmtpUrl: (name: string) => `${name} must start with smtp:// or smtps://.`,
    notProxyList: (name: string) =>
      `${name} must be a list of addresses or ranges with commas between them, such as 10.0.0.0/8,192.168.1.7.`,
    needs: (name: string, other: string) => `${name} is set, so ${other} must be set too.`,
    halfSet: (name: string, missing: string) => `${name} is set and ${missing} is not. Set both.`,
    authSecretMissing:
      'TURNKEEL_PUBLIC_URL is set, which turns sign-in on, so TURNKEEL_AUTH_SECRET must be set. Make one with: openssl rand -base64 32',
    authSecretShort: (length: number) =>
      `TURNKEEL_AUTH_SECRET must be at least ${length} characters long.`,
    secretsKeyShort: (length: number) =>
      `TURNKEEL_SECRETS_KEY must be at least ${length} characters long. Make one with: openssl rand -base64 32`,
    notLocalHost:
      'TURNKEEL_HOST is not an address the server listens on without sign-in. Without sign-in the server listens on 127.0.0.1, localhost or ::1 only. Set TURNKEEL_PUBLIC_URL to turn sign-in on, or leave TURNKEEL_HOST unset.',
    localInstallWithSignIn:
      'TURNKEEL_PUBLIC_URL is set, which turns sign-in on, but this database was made by local mode and nobody could sign in to it: its workspaces belong to the local owner, who has no sign-in. To go on using it, start without TURNKEEL_PUBLIC_URL. To move it to a server with sign-in, stop the server and run "turnkeel owner claim --email <address>" with this configuration first. Otherwise a server with sign-in needs a database of its own: set DATABASE_URL, or set TURNKEEL_DATA_DIR to a new folder.',
    claimedWithoutSignIn:
      'This database was moved to sign-in with "turnkeel owner claim": the local owner is now an account that signs in. Local mode does not run on it. Set TURNKEEL_PUBLIC_URL, TURNKEEL_AUTH_SECRET and mail, start the server and sign in with that address.',
    demoWithSignIn:
      'TURNKEEL_DEMO is set and has no effect, because sign-in is on. The demo loads only in local mode.',
    unusedWithoutSignIn: (name: string) =>
      `${name} is set and has no effect, because sign-in is off. Set TURNKEEL_PUBLIC_URL to turn it on.`,
    assistantProvider: 'TURNKEEL_ASSISTANT_PROVIDER must be anthropic or openai-compatible.',
    assistantNeedsProvider: (name: string) =>
      `${name} is set and TURNKEEL_ASSISTANT_PROVIDER is not. Set the provider too, or leave ${name} unset.`,
    assistantNeeds: (provider: string, name: string) =>
      `TURNKEEL_ASSISTANT_PROVIDER is ${provider}, so ${name} must be set.`,
    assistantBaseUrl:
      'TURNKEEL_ASSISTANT_BASE_URL must be an http or https address with no user name, password, query or fragment, https unless the host is local, and not a link-local, unspecified, multicast or reserved address.',
    assistantModel:
      'TURNKEEL_ASSISTANT_MODEL must be one line of at most 200 characters without control characters.',
    assistantDailyCap: 'TURNKEEL_ASSISTANT_DAILY_CAP must be a whole number from 1 to 10000.',
    assistantOpenSignup:
      'The TURNKEEL_ASSISTANT_ variables are set and have no effect, because TURNKEEL_OPEN_SIGNUP is true: anyone could make a workspace and use the key. No workspace is offered the default.',
  },

  errors: {
    notFound: 'There is nothing at this address.',
    unauthorized: 'Sign in, or send an agent token.',
    unauthorizedLocal:
      'This request has no local session. Press Enter in the terminal where turnkeel runs to get a one-time address and open it, or send an agent token. If turnkeel was started without a terminal, start it again.',
    agentOwnerNotMember: "An agent's owner must be a member of this workspace. Pick a member.",
    agentDisabled: 'This agent is disabled, so it gets no new token. Make a new agent.',
    tokenProjectUnknown: 'The workspace has no such project.',
    tokenProjectArchived: 'This project is archived, so no new token can name it.',
    tokenExpiryPast: 'A token expires in the future. Pick a later time, or none.',
    tokenNotUsable:
      'This token is revoked or expired, or its agent is disabled, so it can no longer be changed. Make a new token.',
    tokenNoScope: 'A token keeps at least one scope. Revoke it instead.',
    tokenPresetScopes: (preset: 'reporter' | 'builder') => {
      const name = preset === 'reporter' ? 'Reporter' : 'Builder';
      return `With the preset ${name}, the standard scopes are ${name}'s. Leave scopes out, or send exactly ${name}'s standard scopes beside any opt-in scopes.`;
    },
    spendCapNeeded:
      'spend:commit needs a monthly cap: the most the agent may commit in a calendar month, in the workspace currency.',
    spendCapWithoutScope: 'A monthly cap goes with spend:commit only.',
    spendCapCurrency: (currency: string) =>
      `The monthly cap is in the workspace currency, ${currency}.`,
    tokenNoIdempotencyKey:
      'This request takes no Idempotency-Key. Its answer holds the token, which is shown once and kept nowhere.',
    agentPatchEmpty: 'name, ownerUserId or disabled is needed.',
    badHost:
      'This server runs in local mode and answers only at 127.0.0.1, localhost and names under .localhost, on its own port.',
    otherSite: 'This request came from another site.',
    badJson: 'The body is not valid JSON.',
    badBody: (detail: string) => `The request does not have the right shape: ${detail}`,
    badQuery: (detail: string) => `The query does not have the right shape: ${detail}`,
    badIdempotencyKey: 'Idempotency-Key must be 1 to 200 characters long.',
    idempotencyKeyReused: 'This Idempotency-Key was already used with a different request.',
    internal: 'Something went wrong on the server. The request id says which request it was.',
    personOnly: 'Only a signed-in person can do this.',
    needsSignIn: 'This needs sign-in, and this install runs in local mode without it.',
    projectArchived: 'This project is archived and can no longer be changed.',
    alreadyMember: 'This person is already in the workspace.',
    alreadyInWorkspace:
      'This person is already in the workspace. Give them a role in the project on the Members page.',
    invitationProjectUnknown: 'The workspace has no such project.',
    invitationProjectArchived: 'This project is archived, so nobody can be invited to it.',
    transferToSelf: 'You already own this workspace.',
    transferToOwner: 'This person is already an Owner of the workspace.',
    transferNoSignIn:
      'This person cannot sign in to this server, so they could never act as Owner. The workspace was not transferred.',
    handleNeeded: 'Pick a handle: 2 to 32 lower-case letters, digits and single hyphens.',
    noFreeHandle: 'No free handle could be made from your name. Pick one.',
    demoNotLoaded:
      'The demo loads only into an install with no workspace, and this one has one. An empty data folder gives a first run again.',
    localLinkUsed:
      'This address was already used or is not valid. It works once. Press Enter in the terminal where turnkeel runs for a new one, or start turnkeel again.',
    webNotBuilt: 'The web app is not built yet. Run pnpm build.',
    cardArchived: 'This card is archived and can no longer be changed.',
    revMismatch:
      'This card was changed since you read it. The card as it is now is in the answer, under current; nothing was saved.',
    blockedCycle: (key: string) =>
      `${key} already waits on this card, through its own blockers, so this card cannot wait on it.`,
    blockedOtherProject: (key: string) =>
      `${key} is in another project. A card waits only on cards of its own project.`,
    blockedUnknown: 'No card of this workspace has that id.',
    unknownHandle: 'The @handle given names nobody in this workspace.',
    unknownAgent: 'The agent:name given names no agent of this workspace.',
    unknownRef: 'The person, agent or party this names is not in this workspace.',
    ownerNotReader:
      'This person does not read cards in this project, so a card cannot be given to them.',
    ownerAgentDisabled: 'This agent is disabled, so no card can be given to it.',
    ownerAgentNotReader:
      'This agent has no working token that reads cards in this project, so a card cannot be given to it. Give it a token for the project with cards:read first.',
    waitingNeedsParty:
      'A card waits on a party: name it by its name, as party:Name for a new one, by a party ref, or by partyId.',
    unknownHolder: (field: string) =>
      `${field} names nobody in this workspace. Name a person as @handle, an agent as agent:name, or a new party as party:Name.`,
    partyNameOfPerson:
      'A person or an agent of this workspace has the name given for the party, so a party cannot. Name the person as @handle or the agent as agent:name, or give the party another name.',
    placeUnknown: 'before and after name other cards of the same project that are not archived.',
    placeOrder: 'The card in after must come before the card in before.',
  },

  mail: {
    signInSubject: 'Your sign-in link for Turnkeel',
    signInText: (input: { url: string; minutes: number }) =>
      [
        'Open this link to sign in to Turnkeel:',
        '',
        input.url,
        '',
        `The link works once, for ${input.minutes} minutes. If you did not ask for it, you can ignore this mail.`,
      ].join('\n'),
    invitationSubject: (input: { inviter: string; workspace: string }) =>
      `${input.inviter} invited you to ${input.workspace} on Turnkeel`,
    invitationText: (input: {
      inviter: string;
      workspace: string;
      project: string | null;
      role: Role;
      url: string;
      email: string;
      expiresAt: Date;
    }) =>
      [
        input.project === null
          ? `${input.inviter} invited you to the workspace ${input.workspace} as ${roleNames[input.role]}.`
          : `${input.inviter} invited you to the project ${input.project} in the workspace ${input.workspace} as ${roleNames[input.role]}.`,
        '',
        'Open this link to accept:',
        '',
        input.url,
        '',
        `The link works once, until ${input.expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. It was sent to ${input.email}. Sign in with that address.`,
      ].join('\n'),
  },

  assistant: {
    agentRefused:
      'No agent token starts the assistant or reads or changes its settings, whatever its scopes. Only a person does, in the app.',
    demo: 'The demo workspace has no assistant. Remove the demo data and set it up in a workspace of your own.',
    baseUrlNotAllowed: (mode: 'local' | 'server' | 'open') =>
      mode === 'local'
        ? 'Use an https address, or an http address of this machine or your own network, with no user name, password, query or fragment. Link-local, multicast and reserved addresses are never used.'
        : mode === 'open'
          ? 'Use an https address with a public host name, on port 443, with no user name, password, query or fragment. On a server where anyone can sign up, an address written as numbers or another port is not used.'
          : 'Use an https address with a public host name, with no user name, password, query or fragment. A model server on this server’s own machine or network is set by whoever runs the server, with TURNKEEL_ASSISTANT_BASE_URL.',
    secretsKeyMissing:
      'This server cannot store a key: TURNKEEL_SECRETS_KEY is not set. A provider without a key, and the server’s default, still work.',
    noInstallDefault: 'This server offers no default provider for the assistant.',
    keyNeedsAddress: 'A key is saved for a provider and a base URL. Set both first.',
    nothingInEffect:
      'The assistant cannot be turned on before a provider, a base URL and a model are set.',
    keyMissing: 'Add the key for this provider before turning it on.',
    featureDoesNotFit: 'This feature cannot be used on this item.',
    notSetUp: 'The assistant is not set up for this workspace.',
    refused: 'The provider could not be reached, or it refused the request.',
    timedOut: 'The provider took too long to answer.',
    overCap: 'This workspace has used its assistant calls for today.',
    busy: 'Another draft is still being written. Try again when it is done.',
    tooManyTests: 'Too many tests. Try again in a minute.',
    noIdempotencyKey:
      'A draft takes no Idempotency-Key. Its answer is not kept, so there is nothing to give a second time.',
    noIdempotencyKeyTest:
      'Test connection takes no Idempotency-Key. Its answer is not kept, so there is nothing to give a second time.',
    draftNotUsable:
      'This text cannot be marked as drafted by the assistant: name a call you started for this item, that returned text in the last 24 hours and that no other save named.',
    draftByAgent:
      "Only a person saves the assistant's text, so an agent cannot send it as a draft.",
  },

  log: {
    receiptFileNotStored: (fileId: string) =>
      `A mail's receipt file ${fileId} could not be stored; the mail is kept without it.`,
    sentButMoved: (postId: string) =>
      `Post ${postId} was sent, but it had moved on before the answer was recorded.`,
    publishFailed: (postId: string) =>
      `The publishing job could not handle the post ${postId}; it is looked at again on the next run.`,
    published: (posted: number, failed: number) =>
      `The publishing job posted ${posted} post${posted === 1 ? '' : 's'} and recorded ${failed} that failed.`,
    recurrenceFailed: (ruleId: string) =>
      `The recurrence job could not run the rule ${ruleId}; it tries again on its next run.`,
    routineFailed: (routineId: string) =>
      `The routines job could not run the routine ${routineId}; it tries again on its next run.`,
    routinesMissedFailed: (workspaceId: string) =>
      `The routines job could not mark the late runs of the workspace ${workspaceId} missed; it tries again on its next run.`,
    routinesMade: (count: number) => `The routines job made ${count} run${count === 1 ? '' : 's'}.`,
    recurrenceMade: (count: number) =>
      `The recurrence job made ${count} card${count === 1 ? '' : 's'}.`,
    connectorRunFailed: (installId: string) =>
      `A run of the connector install ${installId} failed.`,
    connectorsRan: (count: number) => `Ran ${count} connector installs that were due.`,
    accessDeniedNotRecorded: (requestId: string) =>
      `An agent's refused request could not be written to the event log. Request ${requestId}.`,
    mailNotConfigured: (input: { to: string; subject: string; text: string }) =>
      `Mail is not configured, so this mail was not sent. To: ${input.to}. Subject: ${input.subject}\n${input.text}`,
    mailFailed: (to: string) => `Mail to ${to} could not be sent.`,
    signInNotSent: 'A sign-in link was asked for an address that cannot sign in. Nothing was sent.',
    signInLimit: (count: number, minutes: number) =>
      `An address was sent ${count} sign-in links in the last ${minutes} minutes. A further one was asked for and not sent.`,
    listening: (url: string) => `Turnkeel is listening at ${url}`,
    listeningOn: (host: string, port: number) => `Turnkeel is listening on ${host}, port ${port}.`,
    localMode:
      'Local mode: this machine only, no accounts or passwords. A browser gets in with a one-time address from the terminal where turnkeel runs; agents use a token.',
    serverMode: (publicUrl: string) =>
      `Sign-in is on. Open Turnkeel at ${publicUrl} (TURNKEEL_PUBLIC_URL). Sign-in works only at that address.`,
    oneTimeUrl: (url: string) => `Open this address once to use Turnkeel in your browser: ${url}`,
    database: (engine: string, where: string) => `Database: ${engine} (${where}).`,
    stopped: 'Turnkeel has stopped.',
    stopping: 'Stopping.',
    requestFailed: (requestId: string, method: string, path: string) =>
      `Request ${requestId} failed: ${method} ${path}`,
    keptAnswerNotUpdated: (requestId: string) =>
      `Request ${requestId}: the answer kept for its Idempotency-Key could not be changed to say that the mail failed.`,
    jobFailed: (name: string) => `The job ${name} failed.`,
    jobRunnerError: 'The job runner reported an error.',
    databaseError: 'The database reported an error.',
    eventBusError: 'The event bus reported an error.',
    streamError: 'A stream stopped with an error.',
    assistantAddressRefused: (requestId: string, what: 'test' | 'draft') =>
      `The assistant's ${what} was refused at the address check: the base URL or what its name resolves to is not allowed. Request ${requestId}.`,
    assistantCallFailed: (
      requestId: string,
      feature: string,
      kind: string,
      status: number | null,
    ) =>
      `An assistant call ended as ${kind}${status === null ? '' : `, status ${status}`}. Feature ${feature}, request ${requestId}.`,
    closedAssistantCalls: (count: number) =>
      `Closed ${count} assistant ${count === 1 ? 'call' : 'calls'} left running by a server that stopped.`,
    markedStale: (count: number) =>
      `Marked ${count} agent session${count === 1 ? '' : 's'} stale: no report for 10 minutes.`,
    removedUploads: (count: number) =>
      `Removed ${count} upload${count === 1 ? '' : 's'} that never completed.`,
    toolFailed: (requestId: string, tool: string) =>
      `MCP tool ${tool} failed, request ${requestId}.`,
    hookRefused: (requestId: string, reason: string) =>
      `Hook event refused, request ${requestId}: ${reason}. The body is not logged.`,
    removedIdempotencyRecords: (count: number) =>
      `Removed ${count} expired idempotency record${count === 1 ? '' : 's'}.`,
    dataDirInUse: (dataDir: string, pid: number) =>
      `Another Turnkeel server (process ${pid}) is using the data folder ${dataDir}. Stop it first, or set TURNKEEL_DATA_DIR to another folder.`,
    dataDirNotPrivate: (folder: string) =>
      `The folder ${folder} can be opened by other accounts on this machine, and it belongs to another account, so the server could not change that. Give the folder to the account that runs Turnkeel, or set TURNKEEL_DATA_DIR to a folder of its own.`,
    localSessionKeyReplaced: (file: string, problem: 'open' | 'malformed') =>
      `${problem === 'open' ? `The local session key file ${file} could be read by other accounts` : `The local session key file ${file} was not usable`}, so a new one was made. Every browser that had the local session is signed out: open a new one-time address.`,
    portInUse: (host: string, port: number) =>
      `Port ${port} on ${host} is already in use. Set TURNKEEL_PORT to another port.`,
    loadedDemo:
      'This is the first run with --demo, so the demo workspace "Demo" is loaded. The demo agent\'s token is shown once, on Your turn in the browser. To make another, open the workspace menu, Agents and tokens, and Create.',
    starting: 'Turnkeel is starting. Try again in a moment.',
    tokensFollowedPreset: (count: number) =>
      `${count} token${count === 1 ? '' : 's'} gained the scopes their preset gained in this release.`,
    authLog: (level: string, message: string) => `Sign-in (${level}): ${message}`,
  },

  /** Sessions, files, builds, gates, assets and decisions. */
  items: {
    mcpMethod: 'The MCP server is stateless and takes POST only.',
    declareNotKeyed:
      'Declaring a file takes no Idempotency-Key: its answer holds a signed upload address, which is never kept. Declare it again instead.',
    toolHidden: 'This token has no scope that shows this tool.',
    toolInternal: (requestId: string) =>
      `Something went wrong on the server, and nothing is known to have been written. Request ${requestId}.`,
    idempotencyKeyReused: 'This idempotencyKey was already used with different input.',
    mcpToken: 'The MCP server needs an agent token: Authorization: Bearer <token>.',
    projectRequired:
      'This token lists more than one project, so the call names one: add "project" with the project key.',
    personReports: 'A session belongs to an agent. Only an agent token reports one.',
    sessionNotWaiting: 'Only a session that needs you, failed or went stale can be dismissed.',
    tooManyOpenSessions:
      'This agent has 200 open sessions, the most it may have. Nothing was written for this session; end or dismiss some first.',
    tooManyNewSessions:
      'This token has made 60 new sessions in the last minute, the most it may. Nothing was written for this session; try again in a minute.',
    badSessionCursor: 'after is not the nextAfter of a page of sessions.',
    linkNotFound: (kind: string) =>
      `${kind} names no ${kind} that this token reads in its projects.`,
    fileTooLarge: (max: number) => `A file can be at most ${max} bytes.`,
    listingFileType:
      'A listing row names an image, a video or a PDF: png, jpg, webp, gif, mp4, webm, mov or pdf. This file is none of them.',
    tooManyUploads:
      'This token has 50 uploads that are not complete, the most it may. Complete them first; one never completed is removed after 24 hours.',
    fileNotReady: 'This file has not finished uploading. Complete the upload first.',
    fileNotUsable:
      'This file cannot be used here: it is in another project, was uploaded by someone else, or was uploaded for another purpose.',
    fileMissing: 'The upload has no bytes yet. PUT the file to the upload address first.',
    checksumMismatch:
      'The stored file does not have the size or the SHA-256 that was declared. Upload it again.',
    fileCompleted: 'This upload is already complete.',
    uploadLinkBad: 'This upload or download address is not valid, or it has expired.',
    uploadOtherPrincipal: 'An upload is completed by whoever declared it.',
    buildArchived: 'This build is archived and can no longer be changed.',
    testersMustNote: 'Everyone asked to test a build must be able to write notes in its project.',
    stepRemoved: 'This step has been removed from the build.',
    scenarioPersonOnly:
      'Only a person adds a scenario in Testing. An agent posts the build’s steps with post_test_steps.',
    scenarioNotYours:
      'Only the person who added this scenario can change or remove it. Steps that came with the build change when they are posted again.',
    scenarioTicked:
      'A step of this scenario has been ticked, so it can no longer be changed or removed.',
    assetChangedSinceSeen:
      'This asset changed since you looked at it. Nothing was decided; here is what it is now.',
    noteRevMismatch:
      'This note was changed in another tab or on another device. Both texts are kept; nothing was overwritten.',
    // One problem a line, each with its file and line.
    syncFailed: (problems: readonly string[]) =>
      `The gate files have problems, and nothing was changed:\n${problems.join('\n')}`,
    filesSyncFailed: (problems: readonly string[]) =>
      `The gate and listing files have problems, and nothing was changed:\n${problems.join('\n')}`,
    gateSetByCheck: 'The state of this gate is set only by its check.',
    gateNoHeldChange: 'This gate has no change waiting to be confirmed.',
    gateRemoved: 'This gate was removed from its file.',
    // A sync's message never repeats what a file says: it names the line, and what
    // the server has, which no file wrote.
    noConnector: (known: string) =>
      `check names a connector this server does not have. It has ${known}.`,
    noSuchCheck: (declared: string) =>
      `check names a check that its connector does not declare. It declares ${declared || 'none'}.`,
    noSuchInstall: (known: string) =>
      `install names no install of that connector in this project. Its installs of it: ${known || 'none'}.`,
    installRequired:
      'This project has more than one install of that connector, so the gate names one: add "- install: <name>".',
    listingSyncFailed: (problems: readonly string[]) =>
      `The listing files have problems, and nothing was changed:\n${problems.join('\n')}`,
    listingFileNotUploaded:
      'file names a file that was not uploaded with this sync. Run turnkeel sync, which uploads it.',
    listingRemoved: 'This listing was removed from its file.',
    noSuchRow: 'This listing has no row with that id.',
    newPartyInGateFile:
      'waitsOn names a party this workspace does not have, and this sync cannot make one: only a sync that may run in this project makes a party its gate files name. Name a party the workspace has, or have a person make it first.',
    badPartyNameInFile: `waitsOn names a new party by a name a party cannot have: one line of at most ${PARTY_NAME_MAX} characters that does not start with @, agent: or party:.`,
    partyNameOfSomeoneInFile:
      'waitsOn names a new party by the name or handle of a person or an agent of this workspace, which a party cannot take. Name the person as @handle or the agent as agent:name, or give the party another name.',
    unknownHandleInFile: 'waitsOn names a handle that nobody in this workspace has.',
    unknownAgentInFile: 'waitsOn names an agent this workspace does not have.',
    unknownWaitsOn:
      'waitsOn names nobody in this workspace. Name a person as @handle, an agent as agent:name, or a party by its name.',
    noOwner: 'The workspace has no Owner to stand for @owner.',
    groupKeyTaken: (key: string) => `This project already has an asset group with the key ${key}.`,
    assetArchived: 'This asset is archived and can no longer be changed.',
    variantKind: 'An image or video asset takes files, and a text asset takes texts.',
    noDecision: 'This asset has no decision to clear.',
    decisionNotProposed: 'A decision can be edited only while it is proposed.',
    decisionNeedsSource: 'An agent says where the words of a decision came from: give "source".',
    decisionWorkspaceWide:
      'Recording a decision for the whole workspace needs a token with workspaceWide.',
    decisionStatusSame: (status: string) => `This decision is ${status} already.`,
    onWordOfAgentsOnly:
      'Only an agent names whose word it acts on. A person who may decide sets the status directly.',
    onWordOfNeedsAccepted:
      'onWordOf goes with status "accepted": an agent records a decision as accepted on a person\'s word, or as proposed.',
    relayReplaces:
      'This decision supersedes another, so changing its status replaces that one. Only a person who may decide does that.',
    quoteNeedsOnWordOf: 'A quote goes with onWordOf: the words of the person the agent acts for.',
    onWordNeeded: 'Name the person whose word this is, as @handle, in onWordOf.',
    acceptNeedsOnWordOf:
      'accept needs onWordOf: the @handle of the person who told you to accept it, who may decide decisions here.',
    decisionDoneNeedsAccepted: 'Only an accepted decision can be marked done.',
    supersedesSelf: 'A decision cannot supersede itself.',
    revMismatch: 'This was changed since you read it. Nothing was written; here is what it is now.',
  },

  local: {
    ownerName: 'Owner',
  },

  owner: {
    usage: 'Usage: turnkeel owner claim --email <address> [--name "<name>"]',
    unknownCommand: (command: string) =>
      `turnkeel owner has the command "claim" only, not "${command}".`,
    unknownOption: (option: string) => `turnkeel owner claim does not have the option "${option}".`,
    missing: (what: string) => `Name ${what}.`,
    noDatabase:
      "There is no Turnkeel database in the data folder (TURNKEEL_DATA_DIR, or ~/.turnkeel). Run the command where the server's configuration is.",
    inUse: (pid: number) =>
      `A Turnkeel server (process ${pid}) is using the data folder. On PGlite one process opens the data folder at a time: stop the server, run "turnkeel owner claim" again, then start the server with sign-in.`,
    notMigrated:
      "The database is not at this version's migrations. Start this version of Turnkeel once, so it brings the database up to date, stop it, and run the command again.",
    badEmail: 'The address given to --email is not an email address.',
    invalidEmail:
      'The address given to --email ends in .invalid, which never gets mail. Give an address that you can read mail at.',
    emptyName: 'The name given to --name is empty. Give a name, or leave --name out.',
    emailTaken:
      'Another account on this server already has the address given to --email. Give an address that no account uses.',
    noLocalOwner:
      'This database has no local owner: it was not made by local mode, so there is nothing to claim.',
    ownerHoldsNothing:
      'The local owner of this database holds no workspace, so there is nothing to move. A server with sign-in starts on this database as it is.',
    claimedAlready:
      'The local owner of this database was claimed already and has an address to sign in with. A second claim is refused.',
    failed: 'The claim failed, and nothing was written.',
    done: 'The local owner can now sign in with the address given. Start the server with TURNKEEL_PUBLIC_URL, TURNKEEL_AUTH_SECRET and mail set, and ask for a sign-in link to that address. Local mode no longer runs on this database.',
  },

  auth: {
    byInvitationOnly: 'This server takes new accounts by invitation only.',
  },
} as const;

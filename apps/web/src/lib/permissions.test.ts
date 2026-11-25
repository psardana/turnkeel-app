import type { Me, ProjectRole, WorkspaceRole } from '@turnkeel/protocol';
import { describe, expect, it } from 'vitest';
import { testId } from '@/testing/events';
import {
  abilitiesIn,
  cardAbilities,
  launchAbilities,
  linkAbilities,
  readsDocs,
  reviewAbilities,
  canOpenProject,
  canArchiveProject,
  canReadProjectEvents,
  canRemoveMember,
  canRevokeInvitation,
  canUpdateProject,
  projectsWithActivity,
  rolesToGive,
  testingAbilities,
  projectRolesToGive,
  rolesToInvite,
} from './permissions';

const WORKSPACE = testId(1);
const OTHER_WORKSPACE = testId(2);
const PROJECT = testId(20);
const OTHER_PROJECT = testId(21);
const stamp = { kind: 'user' as const, id: testId(10) };

/** The person as `GET /me` describes them: a workspace role, project roles, or both. */
function meWith(
  role: WorkspaceRole | null,
  projectRoles: Record<string, ProjectRole> = {},
  local = false,
): Me {
  return {
    user: {
      id: testId(10),
      name: 'Pat',
      email: 'pat@example.com',
      emailVerified: true,
      createdAt: '2026-11-11T09:00:00.000Z',
    },
    local,
    canCreateWorkspace: false,
    workspaces: [
      {
        workspace: {
          id: WORKSPACE,
          workspaceId: WORKSPACE,
          createdAt: '2026-11-11T09:00:00.000Z',
          createdBy: stamp,
          updatedAt: '2026-11-11T09:00:00.000Z',
          updatedBy: stamp,
          name: 'Acme',
          slug: 'acme',
          baseCurrency: 'USD',
          timeZone: 'UTC',
          planning: { recurring: true, timeTracking: true, gantt: true, savedViews: true },
          tabsOff: [],
          tabsKeptAt: null,
          demo: false,
          deletedAt: null,
        },
        role,
        handle: role === null ? null : 'pat',
        projectRoles,
        view: { hiddenTabs: [], introsSeen: [], start: 'new' },
      },
    ],
  };
}

const visible = (me: Me) => {
  const abilities = abilitiesIn(me, WORKSPACE);
  return {
    menu: workspaceMenu.filter((item) => item.visible(abilities)).map((item) => item.id),
    header: headerNavigation(abilities).map((item) => item.id),
    settings: settingsSections.filter((item) => item.visible(abilities)).map((item) => item.id),
  };
};

describe('what each role sees', () => {
  it.each(['owner', 'admin'] as const)('%s: everything of the workspace', (role) => {
    expect(abilitiesIn(meWith(role), WORKSPACE)).toEqual({
      readEvents: true,
      readSomeEvents: true,
      exportEvents: true,
      createProject: true,
      updateWorkspace: true,
      deleteWorkspace: role === 'owner',
      readMembers: true,
      readAgents: true,
      manageMembers: true,
      readSomeCards: true,
      readSomeSessions: true,
      manageAssistant: true,
      manageSomeRoutines: true,
      readSomeBuilds: true,
      readSomeGates: true,
      syncSomeGates: true,
      readSomeAssets: true,
      readSomeDecisions: true,
      readSomeReleases: true,
      readSomeInbox: true,
      readSomeMoney: true,
      readSomeDocs: true,
      readSomeLinks: true,
      readConnectors: true,
      manageConnectors: true,
      onlyTester: false,
    });
    expect(visible(meWith(role))).toEqual({
      menu: [
        'activity',
        'reference',
        'projects',
        'members',
        'agents-and-tokens',
        'sessions',
        'connectors',
        'assistant',
        'settings',
      ],
      header: ['turn', 'board', 'ship', 'marketing', 'money', 'inbox'],
      // Settings with a list of sections; Danger zone is the Owner's.
      settings: [
        'workspace',
        'projects',
        'members',
        'agents-and-tokens',
        'sessions',
        'routines',
        'connectors',
        'import',
        'tabs',
        'planning',
        'money',
        'assistant',
        ...(role === 'owner' ? ['danger'] : []),
        'profile',
        'theme',
        'my-tabs',
        'start',
      ],
    });
  });

  it.each(['member', 'reviewer', 'viewer'] as const)(
    '%s: reads Activity and changes nothing here',
    (role) => {
      expect(abilitiesIn(meWith(role), WORKSPACE)).toEqual({
        readEvents: true,
        readSomeEvents: true,
        exportEvents: false,
        createProject: false,
        updateWorkspace: false,
        deleteWorkspace: false,
        readMembers: false,
        readAgents: false,
        manageMembers: false,
        readSomeCards: true,
        readSomeSessions: true,
        manageAssistant: false,
        manageSomeRoutines: false,
        readSomeBuilds: true,
        readSomeGates: true,
        syncSomeGates: role === 'member',
        readSomeAssets: true,
        readSomeDecisions: true,
        readSomeReleases: true,
        readSomeInbox: true,
        readSomeMoney: true,
        readSomeDocs: true,
        readSomeLinks: true,
        readConnectors: false,
        manageConnectors: false,
        onlyTester: false,
      });
      // No Members, no Agents and tokens, no Connectors, no Export, no New project.
      expect(visible(meWith(role))).toEqual({
        menu: ['activity', 'reference', 'projects', 'sessions', 'settings'],
        header: ['turn', 'board', 'ship', 'marketing', 'money', 'inbox'],
        settings: [
          'workspace',
          'projects',
          // The agents' sessions, which were the Agents tab.
          'sessions',
          ...(role === 'member' ? ['import'] : []),
          'profile',
          'theme',
          'my-tabs',
          'start',
        ],
      });
    },
  );

  it('a Tester sees only Testing: no Activity, no member list, no other tab, and lands on Testing', () => {
    const me = meWith(null, { [PROJECT]: 'tester' });
    const abilities = abilitiesIn(me, WORKSPACE);
    expect(abilities.readEvents).toBe(false);
    expect(abilities.readSomeEvents).toBe(false);
    expect(abilities.readSomeCards).toBe(false);
    expect(abilities.readSomeBuilds).toBe(true);
    expect(abilities.readSomeGates).toBe(false);
    expect(abilities.readSomeAssets).toBe(false);
    expect(abilities.readSomeDecisions).toBe(false);
    expect(abilities.readSomeReleases).toBe(false);
    expect(abilities.readSomeInbox).toBe(false);
    expect(abilities.onlyTester).toBe(true);
    // Ship with Testing alone.
    expect(headerNavigation(abilities).map((item) => item.id)).toEqual(['ship']);
    expect(sectionNavigation(shipSections, abilities).map((item) => item.id)).toEqual(['testing']);
    expect(firstViewOf('ship', abilities)?.to).toBe('/w/$ws/ship/testing');
    expect(workspaceHome(abilities)?.id).toBe('ship');
    expect(visible(me).menu).toEqual([]);
    expect(canReadProjectEvents(me, WORKSPACE, PROJECT)).toBe(false);
    // A Tester in one project who holds another project role is no longer a Tester only.
    expect(
      abilitiesIn(meWith(null, { [PROJECT]: 'tester', [OTHER_PROJECT]: 'viewer' }), WORKSPACE)
        .onlyTester,
    ).toBe(false);
  });

  it('a Tester may open Testing, and Your turn, Ship and the workspace, which send them there; anything else is the one 404', () => {
    expect(testerMayOpen('/w/acme/ship/testing', 'acme')).toBe(true);
    expect(testerMayOpen('/w/acme/ship', 'acme')).toBe(true);
    // The old address of Testing moves to Ship's Testing.
    expect(testerMayOpen('/w/acme/testing', 'acme')).toBe(true);
    expect(testerMayOpen('/w/acme/turn', 'acme')).toBe(true);
    expect(testerMayOpen('/w/acme', 'acme')).toBe(true);
    expect(testerMayOpen('/w/acme/', 'acme')).toBe(true);
    for (const path of [
      '/w/acme/board',
      '/w/acme/agents',
      '/w/acme/ship/launch',
      '/w/acme/ship/releases',
      '/w/acme/marketing',
      '/w/acme/reference',
      '/w/acme/settings/sessions',
      '/w/acme/activity',
      '/w/acme/settings',
      '/w/acme/settings/members',
      '/w/acme/settings/projects',
      '/w/acme/testing-other',
    ]) {
      expect(testerMayOpen(path, 'acme'), path).toBe(false);
    }
  });

  it('a person who is Tester in one project and Viewer in another opens Activity for the second only', () => {
    const projects = [{ id: PROJECT }, { id: OTHER_PROJECT }, { id: testId(22) }];
    const me = meWith(null, { [PROJECT]: 'tester', [OTHER_PROJECT]: 'viewer' });
    expect(projectsWithActivity(me, WORKSPACE, projects)).toEqual([{ id: OTHER_PROJECT }]);
    // A Tester alone has no project to open Activity for.
    expect(
      projectsWithActivity(meWith(null, { [PROJECT]: 'tester' }), WORKSPACE, projects),
    ).toEqual([]);
    // A workspace role that reads events covers every project.
    expect(projectsWithActivity(meWith('viewer'), WORKSPACE, projects)).toEqual(projects);
    // A project role replaces the workspace role there: Tester in one project of a Member.
    expect(
      projectsWithActivity(meWith('member', { [PROJECT]: 'tester' }), WORKSPACE, projects),
    ).toEqual([{ id: OTHER_PROJECT }, { id: testId(22) }]);
  });

  it('a person with a role in one project reads the Activity of that project only (R30)', () => {
    const me = meWith(null, { [PROJECT]: 'member' });
    const abilities = abilitiesIn(me, WORKSPACE);
    expect(abilities.readEvents).toBe(false);
    expect(abilities.readSomeEvents).toBe(true);
    expect(canReadProjectEvents(me, WORKSPACE, PROJECT)).toBe(true);
    expect(canReadProjectEvents(me, WORKSPACE, OTHER_PROJECT)).toBe(false);
    // A project role never grants a workspace-level action.
    expect(abilities.createProject).toBe(false);
    expect(abilities.readMembers).toBe(false);
    expect(abilities.readSomeCards).toBe(true);
    expect(workspaceHome(abilities)?.id).toBe('turn');
  });

  it('nothing in a workspace the person is not in (R1)', () => {
    expect(abilitiesIn(meWith('owner'), OTHER_WORKSPACE)).toEqual({
      readEvents: false,
      readSomeEvents: false,
      exportEvents: false,
      createProject: false,
      updateWorkspace: false,
      deleteWorkspace: false,
      readMembers: false,
      readAgents: false,
      manageMembers: false,
      readSomeCards: false,
      readSomeSessions: false,
      manageAssistant: false,
      manageSomeRoutines: false,
      readSomeBuilds: false,
      readSomeGates: false,
      syncSomeGates: false,
      readSomeAssets: false,
      readSomeDecisions: false,
      readSomeReleases: false,
      readSomeInbox: false,
      readSomeMoney: false,
      readSomeDocs: false,
      readSomeLinks: false,
      readConnectors: false,
      manageConnectors: false,
      onlyTester: false,
    });
  });

  it('the local owner of local mode is an Owner like any other', () => {
    expect(abilitiesIn(meWith('owner', {}, true), WORKSPACE).manageMembers).toBe(true);
  });
});

describe('Launch', () => {
  it('an Owner, Admin or Member passes gates, adds evidence, confirms held changes and ticks rows', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect(launchAbilities(meWith(role), WORKSPACE, PROJECT)).toEqual({
        readGates: true,
        readListings: true,
        passGates: true,
        checkGates: true,
        confirmChanges: true,
        editGates: true,
        markRows: true,
        moveCards: true,
        readPeople: true,
        readEvents: true,
        updateProject: role !== 'member',
      });
    }
  });

  it.each(['reviewer', 'viewer'] as const)(
    'a %s reads Launch and changes nothing there',
    (role) => {
      const abilities = launchAbilities(meWith(role), WORKSPACE, PROJECT);
      expect(abilities.readGates).toBe(true);
      expect(abilities.readListings).toBe(true);
      expect(abilities.passGates).toBe(false);
      expect(abilities.checkGates).toBe(false);
      expect(abilities.confirmChanges).toBe(false);
      expect(abilities.editGates).toBe(false);
      expect(abilities.markRows).toBe(false);
      expect(abilities.moveCards).toBe(false);
    },
  );

  it('a Tester reads no gate and no listing (R3)', () => {
    const abilities = launchAbilities(meWith(null, { [PROJECT]: 'tester' }), WORKSPACE, PROJECT);
    expect(abilities.readGates).toBe(false);
    expect(abilities.readListings).toBe(false);
  });
});

describe('projects', () => {
  it('only an Owner or Admin changes or archives a project', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(canUpdateProject(meWith(role), WORKSPACE, PROJECT)).toBe(true);
      expect(canArchiveProject(meWith(role), WORKSPACE, PROJECT)).toBe(true);
    }
    for (const role of ['member', 'reviewer', 'viewer'] as const) {
      expect(canUpdateProject(meWith(role), WORKSPACE, PROJECT)).toBe(false);
      expect(canArchiveProject(meWith(role), WORKSPACE, PROJECT)).toBe(false);
    }
  });

  it('a project role replaces the workspace role in that project (R2)', () => {
    const lowered = meWith('admin', { [PROJECT]: 'viewer' });
    expect(canUpdateProject(lowered, WORKSPACE, PROJECT)).toBe(false);
    expect(canUpdateProject(lowered, WORKSPACE, OTHER_PROJECT)).toBe(true);
    // An Owner stays Owner everywhere.
    expect(canUpdateProject(meWith('owner', { [PROJECT]: 'viewer' }), WORKSPACE, PROJECT)).toBe(
      true,
    );
  });
});

describe('the roles on offer in the member list', () => {
  it('an Owner may give every workspace role', () => {
    expect(rolesToGive(meWith('owner'), WORKSPACE, 'member', 2)).toEqual([
      'owner',
      'admin',
      'member',
      'reviewer',
      'viewer',
    ]);
  });

  it('an Admin may not give the Owner role, nor change an Owner (R31)', () => {
    expect(rolesToGive(meWith('admin'), WORKSPACE, 'member', 1)).toEqual([
      'admin',
      'member',
      'reviewer',
      'viewer',
    ]);
    expect(rolesToGive(meWith('admin'), WORKSPACE, 'owner', 2)).toEqual(['owner']);
  });

  it('the last Owner cannot be lowered (R9)', () => {
    expect(rolesToGive(meWith('owner'), WORKSPACE, 'owner', 1)).toEqual(['owner']);
    expect(rolesToGive(meWith('owner'), WORKSPACE, 'owner', 2)).toHaveLength(5);
  });

  it('a Member has nothing to pick from', () => {
    expect(rolesToGive(meWith('member'), WORKSPACE, 'viewer', 1)).toEqual(['viewer']);
  });

  it('removing follows the same limits (R9, R31)', () => {
    expect(canRemoveMember(meWith('owner'), WORKSPACE, 'admin', 1)).toBe(true);
    expect(canRemoveMember(meWith('owner'), WORKSPACE, 'owner', 1)).toBe(false);
    expect(canRemoveMember(meWith('owner'), WORKSPACE, 'owner', 2)).toBe(true);
    expect(canRemoveMember(meWith('admin'), WORKSPACE, 'owner', 2)).toBe(false);
    expect(canRemoveMember(meWith('admin'), WORKSPACE, 'member', 1)).toBe(true);
    expect(canRemoveMember(meWith('admin'), WORKSPACE, null, 1)).toBe(true);
    expect(canRemoveMember(meWith('member'), WORKSPACE, 'viewer', 1)).toBe(false);
  });
});

describe('the roles on offer in the invitation dialog', () => {
  it('to the workspace: no Tester, and Owner only from an Owner (R31, R32)', () => {
    expect(rolesToInvite(meWith('owner'), WORKSPACE, null)).toEqual([
      'owner',
      'admin',
      'member',
      'reviewer',
      'viewer',
    ]);
    expect(rolesToInvite(meWith('admin'), WORKSPACE, null)).toEqual([
      'admin',
      'member',
      'reviewer',
      'viewer',
    ]);
  });

  it('to one project: the project roles, Tester among them (R30)', () => {
    expect(rolesToInvite(meWith('admin'), WORKSPACE, PROJECT)).toEqual([
      'member',
      'reviewer',
      'tester',
      'viewer',
    ]);
  });

  it('nobody below Admin invites', () => {
    expect(rolesToInvite(meWith('member'), WORKSPACE, null)).toEqual([]);
    expect(rolesToInvite(meWith('member'), WORKSPACE, PROJECT)).toEqual([]);
  });

  it('an Admin cannot revoke an invitation that gives Owner (R31)', () => {
    expect(canRevokeInvitation(meWith('admin'), WORKSPACE, 'owner')).toBe(false);
    expect(canRevokeInvitation(meWith('admin'), WORKSPACE, 'member')).toBe(true);
    expect(canRevokeInvitation(meWith('owner'), WORKSPACE, 'owner')).toBe(true);
  });
});

describe('Links and Docs', () => {
  it('the groups of the whole workspace are read and changed by a workspace role only', () => {
    expect(linkAbilities(meWith('member'), WORKSPACE, PROJECT)).toEqual({
      read: true,
      readWorkspace: true,
      write: true,
      writeWorkspace: true,
    });
    // A Member of the project alone changes its groups, and neither reads nor changes the workspace's.
    expect(linkAbilities(meWith(null, { [PROJECT]: 'member' }), WORKSPACE, PROJECT)).toEqual({
      read: true,
      readWorkspace: false,
      write: true,
      writeWorkspace: false,
    });
    // A Viewer of the project alone reads its groups and nothing more.
    expect(linkAbilities(meWith(null, { [PROJECT]: 'viewer' }), WORKSPACE, PROJECT)).toEqual({
      read: true,
      readWorkspace: false,
      write: false,
      writeWorkspace: false,
    });
    // A workspace Viewer who is a Member of the project changes the project's groups only.
    expect(linkAbilities(meWith('viewer', { [PROJECT]: 'member' }), WORKSPACE, PROJECT)).toEqual({
      read: true,
      readWorkspace: true,
      write: true,
      writeWorkspace: false,
    });
    expect(linkAbilities(meWith(null, { [PROJECT]: 'tester' }), WORKSPACE, PROJECT).read).toBe(
      false,
    );
  });

  it('a Viewer reads the docs; a Tester and a stranger to the project do not', () => {
    expect(readsDocs(meWith('viewer'), WORKSPACE, PROJECT)).toBe(true);
    expect(readsDocs(meWith(null, { [PROJECT]: 'viewer' }), WORKSPACE, PROJECT)).toBe(true);
    expect(readsDocs(meWith(null, { [PROJECT]: 'tester' }), WORKSPACE, PROJECT)).toBe(false);
    expect(readsDocs(meWith(null, { [OTHER_PROJECT]: 'member' }), WORKSPACE, PROJECT)).toBe(false);
  });
});

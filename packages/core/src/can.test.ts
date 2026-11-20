import {
  workspaceRoles,
  type ProjectRole,
  type Role,
  type WorkspaceRole,
} from '@turnkeel/protocol';
import { describe, expect, it } from 'vitest';
import {
  actions,
  can,
  isAction,
  membershipActions,
  personPrincipal,
  principalRef,
  systemPrincipal,
  tableActions,
  type Action,
  type AgentPrincipal,
  type Decision,
  type PersonPrincipal,
  type TableAction,
} from './index.js';

const ws = '11111111-1111-4111-8111-111111111111';
const otherWs = '22222222-2222-4222-8222-222222222222';
const p1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const p2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userId = '33333333-3333-4333-8333-333333333333';
const otherUserId = '44444444-4444-4444-8444-444444444444';

/** A person with a workspace role in `ws`, and optionally project roles there. */
function person(
  role: WorkspaceRole | null,
  projectRoles: Record<string, ProjectRole> = {},
): PersonPrincipal {
  return personPrincipal({ userId, memberships: [{ workspaceId: ws, role, projectRoles }] });
}

const stranger = personPrincipal({ userId });

const agent: AgentPrincipal = {
  kind: 'agent',
  agentId: '55555555-5555-4555-8555-555555555555',
  tokenId: '66666666-6666-4666-8666-666666666666',
  workspaceId: ws,
  scopes: ['cards:read', 'cards:write'],
  projectIds: [p1],
  workspaceWide: true,
};

function expectAllowed(decision: Decision) {
  expect(decision).toEqual({ allowed: true });
}

function expectDenied(
  decision: Decision,
  kind: 'forbidden' | 'not_found' | 'conflict' | 'not_built',
  rule?: string,
) {
  expect(decision.allowed).toBe(false);
  if (decision.allowed) return;
  expect(decision.kind).toBe(kind);
  expect(decision.rule).toBe(rule);
  expect(decision.reason.length).toBeGreaterThan(0);
}

/**
 * The first rows of the role table, which the tests below ask about. The whole
 * table is walked in matrix.test.ts.
 */
const rows: readonly (readonly [
  TableAction,
  'workspace' | 'project' | 'either',
  readonly Role[],
])[] = [
  ['project.create', 'workspace', ['owner', 'admin']],
  ['project.update', 'project', ['owner', 'admin']],
  ['project.archive', 'project', ['owner', 'admin']],
  ['member.read', 'workspace', ['owner', 'admin']],
  ['member.manage', 'workspace', ['owner', 'admin']],
  ['events.read', 'either', ['owner', 'admin', 'member', 'reviewer', 'viewer']],
  ['events.export', 'workspace', ['owner', 'admin']],
  ['workspace.update', 'workspace', ['owner', 'admin']],
  ['workspace.delete', 'workspace', ['owner']],
  ['workspace.transfer', 'workspace', ['owner']],
];

/** `can` with a resource that fits any table action. */
function ask(principal: Parameters<typeof can>[0], action: TableAction, projectId?: string) {
  const check = can as (
    principal: Parameters<typeof can>[0],
    action: Action,
    resource: { workspaceId: string; projectId?: string },
  ) => Decision;
  return check(principal, action, projectId ? { workspaceId: ws, projectId } : { workspaceId: ws });
}

describe('the first rows of the role table', () => {
  describe.each(rows)('%s (%s level)', (action, level, ticked) => {
    it.each(workspaceRoles)('answers a workspace %s as the table says', (role) => {
      const decision = ask(person(role), action, level === 'workspace' ? undefined : p1);
      expect(decision.allowed).toBe(ticked.includes(role));
      if (!decision.allowed) expect(decision.kind).toBe('forbidden');
    });
  });
});

describe('nothing in a workspace, nothing to learn about it', () => {
  it.each(rows)('%s is not found for a person with no membership', (action, level) => {
    expectDenied(ask(stranger, action, level === 'workspace' ? undefined : p1), 'not_found', 'R1');
  });

  it('a membership in another workspace gives nothing here', () => {
    const elsewhere = personPrincipal({
      userId,
      memberships: [{ workspaceId: otherWs, role: 'owner', projectRoles: {} }],
    });
    expectDenied(can(elsewhere, 'workspace.read', { workspaceId: ws }), 'not_found', 'R1');
    expectDenied(can(elsewhere, 'workspace.delete', { workspaceId: ws }), 'not_found', 'R1');
    expectDenied(
      can(elsewhere, 'project.read', { workspaceId: ws, projectId: p1 }),
      'not_found',
      'R1',
    );
    expectAllowed(can(elsewhere, 'workspace.delete', { workspaceId: otherWs }));
  });

  it('a membership row with no role and no project role counts as none', () => {
    expectDenied(can(person(null), 'workspace.read', { workspaceId: ws }), 'not_found', 'R1');
  });

  it('a person with only a project role cannot learn of another project', () => {
    const tester = person(null, { [p1]: 'tester' });
    expectAllowed(can(tester, 'project.read', { workspaceId: ws, projectId: p1 }));
    expectDenied(
      can(tester, 'project.read', { workspaceId: ws, projectId: p2 }),
      'not_found',
      'R1',
    );
    expectDenied(
      can(tester, 'project.update', { workspaceId: ws, projectId: p2 }),
      'not_found',
      'R1',
    );
    expectDenied(can(tester, 'events.read', { workspaceId: ws, projectId: p2 }), 'not_found', 'R1');
  });

  it('a person with only project roles gets the one 404 on a read of an item with no project', () => {
    const projectOnly = person(null, { [p1]: 'member' });
    for (const action of ['card.read', 'decision.read', 'link.read', 'money.read'] as const) {
      expectDenied(
        can(projectOnly, action, { workspaceId: ws, projectId: null }),
        'not_found',
        'R1',
      );
      // The same item in their project they read.
      expectAllowed(can(projectOnly, action, { workspaceId: ws, projectId: p1 }));
    }
    // A workspace Viewer reads it: the workspace role covers items with no project.
    expectAllowed(can(person('viewer'), 'decision.read', { workspaceId: ws, projectId: null }));
  });

  it('a workspace role sees the workspace and every project in it', () => {
    for (const role of workspaceRoles) {
      expectAllowed(can(person(role), 'workspace.read', { workspaceId: ws }));
      expectAllowed(can(person(role), 'project.read', { workspaceId: ws, projectId: p2 }));
    }
  });

  it('a person with only a project role sees the workspace that project is in', () => {
    expectAllowed(can(person(null, { [p1]: 'viewer' }), 'workspace.read', { workspaceId: ws }));
  });

  it('ids are compared without regard to case', () => {
    expectAllowed(can(person('viewer'), 'workspace.read', { workspaceId: ws.toUpperCase() }));
    expectAllowed(
      can(person(null, { [p1]: 'tester' }), 'project.read', {
        workspaceId: ws,
        projectId: p1.toUpperCase(),
      }),
    );
  });
});

describe('a project role replaces the workspace role in that project', () => {
  it('an Admin with the Viewer role in a project cannot update that project', () => {
    const admin = person('admin', { [p1]: 'viewer' });
    expectDenied(
      can(admin, 'project.update', { workspaceId: ws, projectId: p1 }),
      'forbidden',
      'R5',
    );
    expectDenied(
      can(admin, 'project.archive', { workspaceId: ws, projectId: p1 }),
      'forbidden',
      'R5',
    );
  });

  it('the same Admin keeps the workspace role in every other project', () => {
    const admin = person('admin', { [p1]: 'viewer' });
    expectAllowed(can(admin, 'project.update', { workspaceId: ws, projectId: p2 }));
  });

  it('an Owner stays Owner in a project that gives them a lower role', () => {
    const owner = person('owner', { [p1]: 'viewer' });
    expectAllowed(can(owner, 'project.update', { workspaceId: ws, projectId: p1 }));
    expectAllowed(can(owner, 'project.archive', { workspaceId: ws, projectId: p1 }));
  });

  it('a Viewer with the Member role in a project reads its events as a Member', () => {
    const viewer = person('viewer', { [p1]: 'member' });
    expectAllowed(can(viewer, 'events.read', { workspaceId: ws, projectId: p1 }));
  });

  it('a Viewer with the Tester role in a project does not read that project’s events', () => {
    const viewer = person('viewer', { [p1]: 'tester' });
    expectDenied(can(viewer, 'events.read', { workspaceId: ws, projectId: p1 }), 'forbidden', 'R3');
    expectAllowed(can(viewer, 'events.read', { workspaceId: ws, projectId: p2 }));
    expectAllowed(can(viewer, 'events.read', { workspaceId: ws }));
  });

  it('a project-level action without a project is a mistake in the caller', () => {
    expect(() => ask(person('owner'), 'project.update')).toThrow(TypeError);
  });
});

describe('a Tester does nothing outside Testing', () => {
  const tester = person(null, { [p1]: 'tester' });

  it.each(rows.filter(([, level]) => level !== 'workspace'))(
    'a Tester is refused %s in their project',
    (action) => {
      expectDenied(ask(tester, action, p1), 'forbidden', 'R3');
    },
  );

  it('a Tester still sees the project and its workspace', () => {
    expectAllowed(can(tester, 'project.read', { workspaceId: ws, projectId: p1 }));
    expectAllowed(can(tester, 'workspace.read', { workspaceId: ws }));
  });
});

describe('what the lower roles are told', () => {
  it('a Viewer writes nothing', () => {
    expectDenied(ask(person('viewer'), 'project.create'), 'forbidden', 'R5');
    expectDenied(ask(person('viewer'), 'project.update', p1), 'forbidden', 'R5');
    expectDenied(ask(person('viewer'), 'workspace.update'), 'forbidden', 'R5');
    expectDenied(ask(person('viewer'), 'member.manage'), 'forbidden', 'R5');
  });

  it('a Reviewer writes nothing outside the table', () => {
    expectDenied(ask(person('reviewer'), 'project.create'), 'forbidden', 'R6');
    expectDenied(ask(person('reviewer'), 'project.archive', p1), 'forbidden', 'R6');
    expectDenied(ask(person('reviewer'), 'member.manage'), 'forbidden', 'R6');
  });

  it('a Member cannot manage members', () => {
    expectDenied(ask(person('member'), 'member.manage'), 'forbidden', 'R7');
  });

  it('a refused read names no rule, and says which role it needs', () => {
    const decision = ask(person('member'), 'member.read');
    expectDenied(decision, 'forbidden', undefined);
    expect(!decision.allowed && decision.reason).toBe('This needs the Owner or Admin role.');
    expectDenied(ask(person('viewer'), 'events.export'), 'forbidden', undefined);
  });
});

describe('only an Owner can delete or transfer the workspace', () => {
  it('an Owner can', () => {
    expectAllowed(can(person('owner'), 'workspace.delete', { workspaceId: ws }));
    expectAllowed(can(person('owner'), 'workspace.transfer', { workspaceId: ws }));
  });

  it.each(['admin', 'member', 'reviewer', 'viewer'] as const)('a workspace %s cannot', (role) => {
    expectDenied(can(person(role), 'workspace.delete', { workspaceId: ws }), 'forbidden', 'R8');
    expectDenied(can(person(role), 'workspace.transfer', { workspaceId: ws }), 'forbidden', 'R8');
  });

  it('the answer says so', () => {
    const decision = can(person('admin'), 'workspace.delete', { workspaceId: ws });
    expect(!decision.allowed && decision.reason).toBe('This needs the Owner role.');
  });
});

describe('the last Owner cannot be removed or lowered', () => {
  const manage = (
    role: WorkspaceRole,
    change: Parameters<typeof can<'member.manage'>>[2]['change'],
  ) => can(person(role), 'member.manage', { workspaceId: ws, change });

  it('an Owner cannot lower the only Owner', () => {
    expectDenied(
      manage('owner', { type: 'set_role', current: 'owner', next: 'admin', ownerCount: 1 }),
      'forbidden',
      'R9',
    );
  });

  it('an Owner cannot remove the only Owner', () => {
    expectDenied(
      manage('owner', { type: 'remove', current: 'owner', ownerCount: 1 }),
      'forbidden',
      'R9',
    );
  });

  it('with two Owners, one can be lowered or removed', () => {
    expectAllowed(
      manage('owner', { type: 'set_role', current: 'owner', next: 'member', ownerCount: 2 }),
    );
    expectAllowed(manage('owner', { type: 'remove', current: 'owner', ownerCount: 2 }));
  });

  it('keeping the only Owner as Owner is no change', () => {
    expectAllowed(
      manage('owner', { type: 'set_role', current: 'owner', next: 'owner', ownerCount: 1 }),
    );
  });
});

describe('a workspace-level action is judged by the workspace role only', () => {
  const workspaceLevel = rows
    .filter(([, level]) => level === 'workspace')
    .map(([action]) => action);

  it.each(workspaceLevel)('a project role never grants %s', (action) => {
    const projectMember = person(null, { [p1]: 'member', [p2]: 'reviewer' });
    expectDenied(ask(projectMember, action), 'forbidden', 'R30');
  });

  it('a project role does not raise a workspace Viewer for a workspace-level action', () => {
    const viewer = person('viewer', { [p1]: 'member' });
    expectDenied(ask(viewer, 'project.create'), 'forbidden', 'R5');
    expectDenied(ask(viewer, 'member.read'), 'forbidden', undefined);
  });

  it('a project role does not lower an Admin for a workspace-level action', () => {
    const admin = person('admin', { [p1]: 'viewer' });
    expectAllowed(ask(admin, 'project.create'));
    expectAllowed(ask(admin, 'member.manage'));
    expectAllowed(ask(admin, 'events.export'));
  });

  it('events without a project need a workspace role', () => {
    const projectMember = person(null, { [p1]: 'member' });
    expectDenied(can(projectMember, 'events.read', { workspaceId: ws }), 'forbidden', 'R30');
    expectAllowed(can(projectMember, 'events.read', { workspaceId: ws, projectId: p1 }));
  });

  it('a write on an item with no project is refused with R30, the workspace being in sight', () => {
    const projectMember = person(null, { [p1]: 'member' });
    for (const action of ['decision.propose', 'link.add', 'session.write'] as const) {
      expectDenied(
        can(projectMember, action, { workspaceId: ws, projectId: null }),
        'forbidden',
        'R30',
      );
    }
  });

  it('an invitation to a project cannot give the Owner or the Admin role', () => {
    for (const role of ['owner', 'admin'] as const) {
      expectDenied(
        can(person('owner'), 'member.manage', {
          workspaceId: ws,
          change: { type: 'invite', role, projectId: p1 },
        }),
        'forbidden',
        'R30',
      );
    }
  });

  it('a project role is one of Member, Reviewer, Tester or Viewer', () => {
    for (const role of ['member', 'reviewer', 'tester', 'viewer'] as const) {
      expectAllowed(
        can(person('admin'), 'member.manage', {
          workspaceId: ws,
          change: {
            type: 'set_project_role',
            projectId: p1,
            role,
            userId: otherUserId,
            targetRole: 'viewer',
          },
        }),
      );
      expectAllowed(
        can(person('admin'), 'member.manage', {
          workspaceId: ws,
          change: { type: 'invite', role, projectId: p1 },
        }),
      );
    }
    expectDenied(
      can(person('owner'), 'member.manage', {
        workspaceId: ws,
        change: {
          type: 'set_project_role',
          projectId: p1,
          role: 'admin' as ProjectRole,
          userId: otherUserId,
          targetRole: null,
        },
      }),
      'forbidden',
      'R30',
    );
  });
});

describe('who gives which role', () => {
  const manage = (
    role: WorkspaceRole,
    change: Parameters<typeof can<'member.manage'>>[2]['change'],
  ) => can(person(role), 'member.manage', { workspaceId: ws, change });

  it('only an Owner invites an Owner', () => {
    expectAllowed(manage('owner', { type: 'invite', role: 'owner' }));
    expectDenied(manage('admin', { type: 'invite', role: 'owner' }), 'forbidden', 'R31');
  });

  it('an Admin invites up to Admin', () => {
    for (const role of ['admin', 'member', 'reviewer', 'viewer'] as const) {
      expectAllowed(manage('admin', { type: 'invite', role }));
    }
  });

  it('only an Owner gives the Owner role to a member', () => {
    expectAllowed(
      manage('owner', { type: 'set_role', current: 'member', next: 'owner', ownerCount: 1 }),
    );
    expectDenied(
      manage('admin', { type: 'set_role', current: 'member', next: 'owner', ownerCount: 1 }),
      'forbidden',
      'R31',
    );
  });

  it('only an Owner changes or removes an Owner', () => {
    expectDenied(
      manage('admin', { type: 'set_role', current: 'owner', next: 'member', ownerCount: 2 }),
      'forbidden',
      'R31',
    );
    expectDenied(
      manage('admin', { type: 'remove', current: 'owner', ownerCount: 2 }),
      'forbidden',
      'R31',
    );
  });

  it('an Admin changes and removes the roles below Owner', () => {
    expectAllowed(
      manage('admin', { type: 'set_role', current: 'member', next: 'admin', ownerCount: 1 }),
    );
    expectAllowed(
      manage('admin', { type: 'set_role', current: 'admin', next: 'viewer', ownerCount: 1 }),
    );
    expectAllowed(manage('admin', { type: 'remove', current: 'admin', ownerCount: 1 }));
    expectAllowed(
      manage('admin', {
        type: 'remove_project_role',
        projectId: p1,
        userId: otherUserId,
        targetRole: 'member',
      }),
    );
  });

  it('only an Owner gives or takes away the project role of an Owner', () => {
    for (const change of [
      {
        type: 'set_project_role',
        projectId: p1,
        role: 'viewer',
        userId: otherUserId,
        targetRole: 'owner',
      },
      { type: 'remove_project_role', projectId: p1, userId: otherUserId, targetRole: 'owner' },
    ] as const) {
      expectDenied(manage('admin', change), 'forbidden', 'R31');
      expectAllowed(manage('owner', change));
    }
  });

  it('nobody gives or takes away their own project role, not even an Owner', () => {
    for (const role of ['owner', 'admin'] as const) {
      for (const change of [
        { type: 'set_project_role', projectId: p1, role: 'member', userId, targetRole: role },
        { type: 'remove_project_role', projectId: p1, userId, targetRole: role },
      ] as const) {
        expectDenied(manage(role, change), 'forbidden', undefined);
      }
    }
    // The person who holds the role is compared without regard to case.
    expectDenied(
      manage('owner', {
        type: 'remove_project_role',
        projectId: p1,
        userId: userId.toUpperCase(),
        targetRole: 'owner',
      }),
      'forbidden',
      undefined,
    );
  });

  it('a person who holds only project roles has their project role changed by an Admin', () => {
    expectAllowed(
      manage('admin', {
        type: 'set_project_role',
        projectId: p1,
        role: 'reviewer',
        userId: otherUserId,
        targetRole: null,
      }),
    );
  });

  it('revoking an invitation has the same limit as making it', () => {
    expectDenied(manage('admin', { type: 'revoke_invitation', role: 'owner' }), 'forbidden', 'R31');
    expectAllowed(manage('owner', { type: 'revoke_invitation', role: 'owner' }));
    expectAllowed(manage('admin', { type: 'revoke_invitation', role: 'tester' }));
  });

  it('someone without member.manage gives no role at all', () => {
    for (const role of ['member', 'reviewer', 'viewer'] as const) {
      const decision = manage(role, { type: 'invite', role: 'viewer' });
      expect(decision.allowed).toBe(false);
    }
  });

  it('listing the invitations needs member.manage and nothing more', () => {
    expectAllowed(can(person('admin'), 'member.manage', { workspaceId: ws }));
    expectDenied(can(person('member'), 'member.manage', { workspaceId: ws }), 'forbidden', 'R7');
  });
});

describe('Tester is never a workspace role', () => {
  it('a Tester invitation without a project is refused', () => {
    expectDenied(
      can(person('owner'), 'member.manage', {
        workspaceId: ws,
        change: { type: 'invite', role: 'tester' },
      }),
      'forbidden',
      'R32',
    );
    expectDenied(
      can(person('owner'), 'member.manage', {
        workspaceId: ws,
        change: { type: 'invite', role: 'tester', projectId: null },
      }),
      'forbidden',
      'R32',
    );
  });

  it('a Tester invitation that names a project is allowed', () => {
    expectAllowed(
      can(person('admin'), 'member.manage', {
        workspaceId: ws,
        change: { type: 'invite', role: 'tester', projectId: p1 },
      }),
    );
  });

  it('a member cannot be given the Tester role in the workspace', () => {
    expectDenied(
      can(person('owner'), 'member.manage', {
        workspaceId: ws,
        change: {
          type: 'set_role',
          current: 'member',
          next: 'tester' as WorkspaceRole,
          ownerCount: 1,
        },
      }),
      'forbidden',
      'R32',
    );
  });
});

describe('who may create a workspace', () => {
  it('a person who is Owner of a workspace on the server may', () => {
    expectAllowed(can(person('owner'), 'workspace.create', { openSignup: false }));
  });

  it('anyone may when open sign-up is on', () => {
    expectAllowed(can(stranger, 'workspace.create', { openSignup: true }));
    expectAllowed(can(person('viewer'), 'workspace.create', { openSignup: true }));
  });

  it.each(['admin', 'member', 'reviewer', 'viewer'] as const)(
    'a workspace %s may not without open sign-up',
    (role) => {
      expectDenied(
        can(person(role), 'workspace.create', { openSignup: false }),
        'forbidden',
        'R44',
      );
    },
  );

  it('a person with no membership may not without open sign-up', () => {
    expectDenied(can(stranger, 'workspace.create', { openSignup: false }), 'forbidden', 'R44');
  });

  it('on an install with no workspace yet, the person who signed in creates the first one', () => {
    expectAllowed(can(stranger, 'workspace.create', { openSignup: false, emptyInstall: true }));
    expectDenied(
      can(stranger, 'workspace.create', { openSignup: false, emptyInstall: false }),
      'forbidden',
      'R44',
    );
  });

  it('the local owner always may', () => {
    const local = personPrincipal({ userId, local: true });
    expectAllowed(can(local, 'workspace.create', { openSignup: false }));
  });
});

describe('member.handle: a person changes their own handle', () => {
  it.each(workspaceRoles)('a workspace %s changes their own handle', (role) => {
    expectAllowed(can(person(role), 'member.handle', { workspaceId: ws, userId }));
  });

  it('nobody changes the handle of someone else, not even an Owner', () => {
    expectDenied(
      can(person('owner'), 'member.handle', { workspaceId: ws, userId: otherUserId }),
      'forbidden',
      undefined,
    );
  });

  it('a person with only project roles has no handle to change', () => {
    expectDenied(
      can(person(null, { [p1]: 'tester' }), 'member.handle', { workspaceId: ws, userId }),
      'forbidden',
      'R30',
    );
  });

  it('outside the workspace there is nothing to change', () => {
    expectDenied(can(stranger, 'member.handle', { workspaceId: ws, userId }), 'not_found', 'R1');
  });
});

describe('the system', () => {
  it('writes sessions, for the job that marks them stale, records a connector check on a gate (R16), makes the cards of recurrence rules (R78), and nothing else yet', () => {
    expect(ask(systemPrincipal, 'session.write', p1).allowed).toBe(true);
    expect(ask(systemPrincipal, 'gate.check', p1).allowed).toBe(true);
    expect(ask(systemPrincipal, 'card.create', p1).allowed).toBe(true);
    for (const action of tableActions) {
      if (action === 'session.write' || action === 'gate.check' || action === 'card.create') {
        continue;
      }
      expectDenied(ask(systemPrincipal, action, p1), 'not_built', undefined);
    }
  });
});

describe('the list of actions', () => {
  it('names every action once', () => {
    expect(new Set(actions).size).toBe(actions.length);
    expect(actions).toHaveLength(tableActions.length + membershipActions.length);
  });

  it('knows an action by its name', () => {
    expect(isAction('workspace.delete')).toBe(true);
    expect(isAction('workspace.read')).toBe(true);
    expect(isAction('workspace.explode')).toBe(false);
  });

  it('gives a principal the ref that createdBy and an event carry', () => {
    expect(principalRef(person('owner'))).toEqual({ kind: 'user', id: userId });
    expect(principalRef(agent)).toEqual({ kind: 'agent', id: agent.agentId });
    expect(principalRef(systemPrincipal)).toEqual({
      kind: 'system',
      id: '00000000-0000-0000-0000-000000000000',
    });
  });
});

describe('a Tester in Testing', () => {
  const tester = person(null, { [p1]: 'tester' });

  it('a Tester reads builds and writes their own notes and marks in their project', () => {
    expectAllowed(can(tester, 'build.read', { workspaceId: ws, projectId: p1 }));
    expectAllowed(can(tester, 'step.note', { workspaceId: ws, projectId: p1, ownerId: userId }));
    expectAllowed(can(tester, 'step.mark', { workspaceId: ws, projectId: p1, ownerId: userId }));
  });

  it('only in projects where they hold the role', () => {
    expectDenied(can(tester, 'build.read', { workspaceId: ws, projectId: p2 }), 'not_found', 'R1');
    expectDenied(
      can(tester, 'step.note', { workspaceId: ws, projectId: p2, ownerId: userId }),
      'not_found',
      'R1',
    );
  });

  it.each([
    'card.read',
    'card.status.add',
    'asset.read',
    'gate.read',
    'people.read',
    'feedback.read',
    'step.reply',
    'file.upload',
  ] as const)('every other action is denied, such as %s', (action) => {
    expectDenied(ask(tester, action, p1), 'forbidden', 'R3');
  });

  it('a Tester reads their own notes and marks', () => {
    expectAllowed(
      can(tester, 'step.notes.read', { workspaceId: ws, projectId: p1, ownerId: userId }),
    );
  });

  it("a Tester does not read other testers' notes", () => {
    expectDenied(
      can(tester, 'step.notes.read', { workspaceId: ws, projectId: p1, ownerId: otherUserId }),
      'forbidden',
      'R3',
    );
    expectDenied(
      can(tester, 'step.notes.read', { workspaceId: ws, projectId: p1 }),
      'forbidden',
      'R3',
    );
  });

  it('a Tester reads the replies under steps they wrote on, and no others', () => {
    expectAllowed(
      can(tester, 'build.read', {
        workspaceId: ws,
        projectId: p1,
        reply: { onStepTheCallerNoted: true },
      }),
    );
    expectDenied(
      can(tester, 'build.read', {
        workspaceId: ws,
        projectId: p1,
        reply: { onStepTheCallerNoted: false },
      }),
      'forbidden',
      'R4',
    );
    // Everyone else who reads builds reads every reply.
    expectAllowed(
      can(person('viewer'), 'build.read', {
        workspaceId: ws,
        projectId: p1,
        reply: { onStepTheCallerNoted: false },
      }),
    );
  });

  it('nobody writes the note or mark of another person, not even an Owner', () => {
    for (const action of ['step.note', 'step.mark'] as const) {
      expectDenied(
        can(person('owner'), action, { workspaceId: ws, projectId: p1, ownerId: otherUserId }),
        'forbidden',
        undefined,
      );
    }
  });

  it('a person of any role reads their own notes, a Viewer included', () => {
    expectAllowed(
      can(person('viewer'), 'step.notes.read', { workspaceId: ws, projectId: p1, ownerId: userId }),
    );
  });
});

describe('Viewers and Reviewers on the whole table', () => {
  it('a Viewer reads and writes nothing', () => {
    expectAllowed(ask(person('viewer'), 'card.read', p1));
    for (const action of [
      'card.create',
      'card.status.add',
      'decision.propose',
      'link.add',
    ] as const) {
      expectDenied(ask(person('viewer'), action, p1), 'forbidden', 'R5');
    }
  });

  it('a Reviewer decides, writes asset notes and status lines, and proposes decisions', () => {
    const reviewer = person('reviewer');
    for (const action of [
      'asset.decide',
      'asset.note',
      'post.approve',
      'decision.decide',
      'decision.propose',
      'card.status.add',
    ] as const) {
      expectAllowed(ask(reviewer, action, p1));
    }
  });

  it('and nothing else that writes', () => {
    for (const action of [
      'card.create',
      'card.move',
      'gate.pass',
      'post.write',
      'post.send',
      'asset.propose',
      'step.note',
      'link.add',
      'assistant.draft',
    ] as const) {
      expectDenied(ask(person('reviewer'), action, p1), 'forbidden', 'R6');
    }
  });
});

describe('money, files and the assistant', () => {
  it('money.write for rates is judged by the workspace role only', () => {
    const projectAdmin = person('viewer', { [p1]: 'member' });
    expectDenied(
      can(person('admin', { [p1]: 'viewer' }), 'money.write', { workspaceId: ws, projectId: p1 }),
      'forbidden',
      'R5',
    );
    expectAllowed(
      can(person('admin', { [p1]: 'viewer' }), 'money.write', {
        workspaceId: ws,
        projectId: p1,
        rates: true,
      }),
    );
    expectDenied(
      can(projectAdmin, 'money.write', { workspaceId: ws, projectId: p1, rates: true }),
      'forbidden',
      'R5',
    );
  });

  it('a receipt is uploaded by someone who may change money settings', () => {
    expectAllowed(
      can(person('admin'), 'file.upload', { workspaceId: ws, projectId: p1, purpose: 'receipt' }),
    );
    expectDenied(
      can(person('member'), 'file.upload', { workspaceId: ws, projectId: p1, purpose: 'receipt' }),
      'forbidden',
      undefined,
    );
    expectAllowed(
      can(person('member'), 'file.upload', {
        workspaceId: ws,
        projectId: p1,
        purpose: 'post_media',
      }),
    );
  });

  it('a person reads a file only through an item they may read', () => {
    const tester = person(null, { [p1]: 'tester' });
    const read = (who: PersonPrincipal, attachedTo: ('step_run' | 'asset_variant' | 'receipt')[]) =>
      can(who, 'file.read', { workspaceId: ws, projectId: p1, attachedTo });
    expectAllowed(read(tester, ['step_run']));
    expectDenied(read(tester, ['asset_variant']), 'not_found', 'R46');
    expectAllowed(read(person('viewer'), ['asset_variant', 'receipt']));
  });

  it('no agent token reads a receipt, even with money:read', () => {
    const reader: AgentPrincipal = { ...agent, scopes: ['money:read'] };
    expectDenied(
      can(reader, 'file.read', { workspaceId: ws, projectId: p1, attachedTo: ['receipt'] }),
      'not_found',
      'R46',
    );
    expectAllowed(can(reader, 'money.read', { workspaceId: ws, projectId: p1 }));
  });

  it('a file attached to nothing is read only by whoever uploaded it', () => {
    const read = (uploadedBy: { kind: 'user'; id: string }) =>
      can(person('owner'), 'file.read', {
        workspaceId: ws,
        projectId: p1,
        attachedTo: [],
        uploadedBy,
      });
    expectAllowed(read({ kind: 'user', id: userId }));
    expectDenied(read({ kind: 'user', id: otherUserId }), 'not_found', 'R46');
  });

  it('a person with assistant.draft in the project may start a call', () => {
    expectAllowed(ask(person('member'), 'assistant.draft', p1));
    expectDenied(ask(person('reviewer'), 'assistant.draft', p1), 'forbidden', 'R6');
    expectDenied(ask(person('member'), 'assistant.manage'), 'forbidden', 'R7');
  });
});

describe('who sets the state of a gate', () => {
  const gate = (pass: 'human' | 'agent' | 'check', extra: object = {}) => ({
    workspaceId: ws,
    projectId: p1,
    pass,
    ...extra,
  });

  it('a person with gate.pass sets the state of a human or an agent gate', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      for (const pass of ['human', 'agent'] as const) {
        expectAllowed(can(person(role), 'gate.pass', gate(pass)));
      }
    }
    expectDenied(can(person('reviewer'), 'gate.pass', gate('human')), 'forbidden', 'R6');
    expectDenied(can(person('viewer'), 'gate.pass', gate('human')), 'forbidden', 'R5');
  });

  it('nobody sets the state of a gate with pass: check, not even an Owner, and the answer is 409', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      expectDenied(can(person(role), 'gate.pass', gate('check')), 'conflict', 'R16');
    }
  });

  it('a person’s check adds evidence to any gate and sets no state of a pass: check gate', () => {
    for (const pass of ['human', 'agent', 'check'] as const) {
      expectAllowed(can(person('member'), 'gate.check', gate(pass)));
    }
    expectDenied(
      can(person('member'), 'gate.check', gate('check', { setsState: true })),
      'forbidden',
      'R16',
    );
  });

  it('a person with gate.pass may reopen a passed gate, except one with pass: check', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      for (const pass of ['human', 'agent'] as const) {
        expectAllowed(can(person(role), 'gate.pass', gate(pass, { reopen: true })));
      }
      expectDenied(
        can(person(role), 'gate.pass', gate('check', { reopen: true })),
        'conflict',
        'R16',
      );
    }
    expectDenied(
      can(person('reviewer'), 'gate.pass', gate('human', { reopen: true })),
      'forbidden',
      'R6',
    );
    expectDenied(
      can(person('viewer'), 'gate.pass', gate('human', { reopen: true })),
      'forbidden',
      'R5',
    );
  });

  it('an agent never sets a gate by gate.pass, whatever its pass', () => {
    for (const pass of ['human', 'agent', 'check'] as const) {
      expectDenied(can(agent, 'gate.pass', gate(pass)), 'forbidden', 'R13');
    }
  });
});

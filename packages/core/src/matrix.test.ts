import {
  projectRoles,
  roles,
  workspaceRoles,
  type ProjectRole,
  type Role,
  type WorkspaceRole,
} from '@turnkeel/protocol';
import { describe, expect, it } from 'vitest';
import {
  can,
  personPrincipal,
  roleTable,
  tableActions,
  type Action,
  type Decision,
  type PersonPrincipal,
  type TableAction,
} from './index.js';

/**
 * The role table, written out again by hand and not read from `roleTable`, so that
 * the two are held against each other. One entry per row of the table: its actions, its
 * level, and the roles with a tick, as O A M R T V.
 */
const specTable: readonly (readonly [
  readonly TableAction[],
  'project' | 'workspace' | 'either',
  string,
])[] = [
  [
    [
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
      'session.read',
    ],
    'either',
    'O A M R . V',
  ],
  [['people.read'], 'either', 'O A M R . V'],
  [['build.read'], 'project', 'O A M R T V'],
  [['step.notes.read'], 'project', 'O A M R . V'],
  [['card.create', 'card.update', 'card.move', 'card.archive'], 'project', 'O A M . . .'],
  [['card.status.add'], 'project', 'O A M R . .'],
  [
    [
      'milestone.write',
      'label.write',
      'planning.remove',
      'view.share',
      'recurrence.write',
      'epic.write',
      'epic.propose',
      'epic.accept',
    ],
    'project',
    'O A M . . .',
  ],
  [['time.read'], 'project', 'O A . . . .'],
  [['time.write'], 'project', 'O A M . . .'],
  [['time.manage'], 'project', 'O A . . . .'],
  [['gate.sync', 'listing.sync', 'doc.sync'], 'project', 'O A M . . .'],
  [['gate.check'], 'project', 'O A M . . .'],
  [['gate.pass'], 'project', 'O A M . . .'],
  [['gate.confirm_change'], 'project', 'O A M . . .'],
  [['listing.mark'], 'project', 'O A M . . .'],
  [['build.post', 'step.reply'], 'project', 'O A M . . .'],
  [['build.archive', 'build.testers'], 'project', 'O A M . . .'],
  [['feedback.read'], 'project', 'O A M . . .'],
  [['step.note', 'step.mark'], 'project', 'O A M . T .'],
  [['asset.propose', 'asset.archive'], 'project', 'O A M . . .'],
  [['asset_group.write'], 'project', 'O A M . . .'],
  [['asset.decide', 'asset.note'], 'project', 'O A . R . .'],
  [['post.write', 'post.skip'], 'project', 'O A M . . .'],
  [['post.approve'], 'project', 'O A . R . .'],
  [['post.send'], 'project', 'O A M . . .'],
  [['decision.propose'], 'either', 'O A M R . .'],
  [['decision.decide'], 'either', 'O A . R . .'],
  [['decision.relay'], 'either', '. . . . . .'],
  [['release.write'], 'project', 'O A M . . .'],
  [['release.publish'], 'project', 'O A . . . .'],
  [['inbox.write', 'inbox.triage'], 'project', 'O A M . . .'],
  [['link_group.read'], 'either', 'O A M R . V'],
  [['link.add'], 'either', 'O A M . . .'],
  [['link.write'], 'either', 'O A M . . .'],
  [['file.upload'], 'project', 'O A M . . .'],
  [['file.read'], 'project', 'O A M R T V'],
  [['signal.write'], 'either', 'O A . . . .'],
  [['session.write'], 'either', 'O A M . . .'],
  [['session.dismiss'], 'either', 'O A M . . .'],
  [['routine.read'], 'project', 'O A M R . V'],
  [['routine.manage'], 'project', 'O A . . . .'],
  [['routine.run'], 'project', '. . . . . .'],
  [['money.write'], 'either', 'O A . . . .'],
  [['spend.commit'], 'either', 'O A . . . .'],
  [['receipt.suggest'], 'either', '. . . . . .'],
  [['project.create'], 'workspace', 'O A . . . .'],
  [['project.update', 'project.archive'], 'project', 'O A . . . .'],
  [['member.read', 'agent.read', 'connector.read'], 'workspace', 'O A . . . .'],
  [['member.manage', 'agent.manage', 'connector.manage'], 'workspace', 'O A . . . .'],
  [['events.read'], 'either', 'O A M R . V'],
  [['events.export', 'workspace.update'], 'workspace', 'O A . . . .'],
  [['workspace.delete', 'workspace.transfer'], 'workspace', 'O . . . . .'],
  [['assistant.manage'], 'workspace', 'O A . . . .'],
  [['assistant.draft'], 'project', 'O A M . . .'],
];

const letters: Record<string, Role> = {
  O: 'owner',
  A: 'admin',
  M: 'member',
  R: 'reviewer',
  T: 'tester',
  V: 'viewer',
};

const ticked = (marks: string): Role[] =>
  marks
    .split(' ')
    .filter((mark) => mark !== '.')
    .map((mark) => letters[mark]!);

/** Every cell of the table: one action, its level and the roles with a tick. */
const cells = specTable.flatMap(([actions, level, marks]) =>
  actions.map((action) => ({ action, level, roles: ticked(marks) })),
);

const ws = '11111111-1111-4111-8111-111111111111';
const p1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const p2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userId = '33333333-3333-4333-8333-333333333333';

function person(
  role: WorkspaceRole | null,
  projectRolesHeld: Record<string, ProjectRole> = {},
): PersonPrincipal {
  return personPrincipal({
    userId,
    memberships: [{ workspaceId: ws, role, projectRoles: projectRolesHeld }],
  });
}

/**
 * The resource that makes each action a plain question of the table: a file attached
 * to a step's run (which every role that reads builds may read), and an upload for a
 * step's run. The limits that these fields switch on have tests of their own.
 */
function ask(principal: PersonPrincipal, action: TableAction, projectId: string | null): Decision {
  const check = can as (p: PersonPrincipal, a: Action, r: object) => Decision;
  const resource: Record<string, unknown> = { workspaceId: ws, projectId };
  if (action === 'file.read') resource.attachedTo = ['step_run'];
  if (action === 'file.upload') resource.purpose = 'step_run';
  return check(principal, action, resource);
}

describe('the role table, every cell', () => {
  it('names every action of the table once, and the code has a row for each', () => {
    const named = cells.map((cell) => cell.action);
    expect(new Set(named).size).toBe(named.length);
    expect([...named].sort()).toEqual([...tableActions].sort());
    expect(Object.keys(roleTable).sort()).toEqual([...tableActions].sort());
  });

  it.each(cells)('$action has the level and the roles of the specification', (cell) => {
    expect(roleTable[cell.action]).toEqual({ level: cell.level, roles: cell.roles });
  });

  describe.each(cells)('$action ($level)', ({ action, level, roles: allowed }) => {
    // A workspace role, asked about an object in a project and, where the level
    // allows one, about an object with no project.
    it.each(workspaceRoles)('a workspace %s gets what the table says', (role) => {
      const where = level === 'workspace' ? [null] : level === 'project' ? [p1] : [p1, null];
      for (const projectId of where) {
        const decision = ask(person(role), action, projectId);
        expect(decision.allowed, `${role} ${action} in ${String(projectId)}`).toBe(
          allowed.includes(role),
        );
        if (!decision.allowed) expect(decision.kind).toBe('forbidden');
      }
    });

    // R2: a project role replaces the workspace role for the actions of that project.
    it.each(projectRoles)('a %s by project role only gets what the table says', (role) => {
      const decision = ask(person(null, { [p1]: role }), action, level === 'workspace' ? null : p1);
      if (level === 'workspace') {
        // R30: a project role never grants a workspace-level action.
        expect(decision).toMatchObject({ allowed: false, kind: 'forbidden', rule: 'R30' });
      } else {
        expect(decision.allowed, `${role} ${action}`).toBe(allowed.includes(role));
      }
    });

    if (level !== 'workspace') {
      it.each(projectRoles)(
        'a workspace Viewer with the %s role in the project gets that role there',
        (role) => {
          const holder = person('viewer', { [p1]: role });
          expect(ask(holder, action, p1).allowed).toBe(allowed.includes(role));
          // The workspace role still holds in every other project.
          expect(ask(holder, action, p2).allowed).toBe(allowed.includes('viewer'));
        },
      );

      it('an Owner stays Owner in a project that gives them a lower role', () => {
        expect(ask(person('owner', { [p1]: 'viewer' }), action, p1).allowed).toBe(
          allowed.includes('owner'),
        );
      });
    }

    if (level === 'either') {
      // An object with no project is judged by the workspace role, and a
      // person who holds only project roles has none. A read of such an item is the
      // one 404, because they cannot see that it exists. A write, and the
      // workspace's own event list, are refused with R30: the workspace they see.
      const hidden = action.endsWith('.read') && action !== 'events.read';
      it(`${hidden ? 'R1' : 'R30'}: an object with no project needs a workspace role`, () => {
        const decision = ask(person(null, { [p1]: 'member' }), action, null);
        expect(decision).toMatchObject(
          hidden
            ? { allowed: false, kind: 'not_found', rule: 'R1' }
            : { allowed: false, kind: 'forbidden', rule: 'R30' },
        );
      });
    }

    it('a person with nothing in the workspace learns nothing', () => {
      const stranger = personPrincipal({ userId });
      expect(ask(stranger, action, level === 'workspace' ? null : p1)).toMatchObject({
        allowed: false,
        kind: 'not_found',
      });
    });
  });

  it('covers all six roles', () => {
    expect(new Set(cells.flatMap((cell) => cell.roles))).toEqual(new Set(roles));
  });
});

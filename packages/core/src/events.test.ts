import { eventTypesByArea, type ProjectRole, type WorkspaceRole } from '@turnkeel/protocol';
import { describe, expect, it } from 'vitest';

const ws = '11111111-1111-4111-8111-111111111111';
const p1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const p2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userId = '33333333-3333-4333-8333-333333333333';

const person = (role: WorkspaceRole | null, projectRoles: Record<string, ProjectRole> = {}) =>
  personPrincipal({ userId, memberships: [{ workspaceId: ws, role, projectRoles }] });

describe('an event reaches only a principal that may read what it is about', () => {
  it.each(eventTypesByArea.people)('%s reaches an Owner and an Admin', (type) => {
    for (const role of ['owner', 'admin'] as const) {
      expect(canReadEvent(person(role), { workspaceId: ws, projectId: null, type }).allowed).toBe(
        true,
      );
    }
  });

  it.each(eventTypesByArea.people)('%s does not reach a role without member.read', (type) => {
    for (const role of ['member', 'reviewer', 'viewer'] as const) {
      const decision = canReadEvent(person(role), { workspaceId: ws, projectId: null, type });
      expect(decision).toMatchObject({ allowed: false, kind: 'not_found' });
    }
    const tester = person(null, { [p1]: 'tester' });
    expect(canReadEvent(tester, { workspaceId: ws, projectId: p1, type }).allowed).toBe(false);
  });

  it('a project role change carries the project and still needs member.read', () => {
    const projectMember = person(null, { [p1]: 'member' });
    expect(
      canReadEvent(projectMember, { workspaceId: ws, projectId: p1, type: 'member.role_changed' })
        .allowed,
    ).toBe(false);
  });

  it('an event about the workspace reaches everyone who is in it', () => {
    for (const role of ['owner', 'admin', 'member', 'reviewer', 'viewer'] as const) {
      expect(
        canReadEvent(person(role), { workspaceId: ws, projectId: null, type: 'workspace.updated' })
          .allowed,
      ).toBe(true);
    }
    expect(
      canReadEvent(person(null, { [p1]: 'tester' }), {
        workspaceId: ws,
        projectId: null,
        type: 'workspace.updated',
      }).allowed,
    ).toBe(true);
  });

  it('an event about a project reaches only those who see that project', () => {
    const tester = person(null, { [p1]: 'tester' });
    expect(
      canReadEvent(tester, { workspaceId: ws, projectId: p1, type: 'project.updated' }).allowed,
    ).toBe(true);
    expect(
      canReadEvent(tester, { workspaceId: ws, projectId: p2, type: 'project.updated' }),
    ).toMatchObject({ allowed: false, kind: 'not_found' });
    expect(
      canReadEvent(person('viewer'), { workspaceId: ws, projectId: p2, type: 'project.created' })
        .allowed,
    ).toBe(true);
  });

  it('nothing reaches a person outside the workspace', () => {
    const stranger = personPrincipal({ userId });
    for (const type of [...eventTypesByArea.workspace, ...eventTypesByArea.people]) {
      expect(canReadEvent(stranger, { workspaceId: ws, projectId: null, type })).toMatchObject({
        allowed: false,
        kind: 'not_found',
      });
    }
  });

  it('nothing reaches the system until its rules are built', () => {
    expect(
      canReadEvent(systemPrincipal, { workspaceId: ws, projectId: null, type: 'workspace.updated' })
        .allowed,
    ).toBe(false);
  });
});

describe('an import.item is read as the ordinary events of its row', () => {
  const imported = (
    subject: { type: string; owner?: { kind: 'user'; id: string } },
    data = {},
  ) => ({
    workspaceId: ws,
    projectId: p1,
    type: 'import.item' as const,
    subject,
    data,
  });
  const other = '44444444-4444-4444-8444-444444444444';

  it('a card and its status lines reach whoever reads the cards, and no one outside', () => {
    expect(canReadEvent(person('viewer'), imported({ type: 'card' })).allowed).toBe(true);
    expect(canReadEvent(person(null, { [p2]: 'member' }), imported({ type: 'card' })).allowed).toBe(
      false,
    );
    expect(canReadEvent(person(null, { [p1]: 'tester' }), imported({ type: 'card' })).allowed).toBe(
      false,
    );
  });

  it("a tester's note reaches its own person and whoever reads every note, not another Tester", () => {
    const own = imported(
      { type: 'step', owner: { kind: 'user', id: userId } },
      { object: 'step_note' },
    );
    const someoneElses = imported(
      { type: 'step', owner: { kind: 'user', id: other } },
      { object: 'step_note' },
    );
    const tester = person(null, { [p1]: 'tester' });
    expect(canReadEvent(tester, own).allowed).toBe(true);
    expect(canReadEvent(tester, someoneElses).allowed).toBe(false);
    expect(canReadEvent(person('owner'), someoneElses).allowed).toBe(true);
    // A reply reaches a Tester only under a step they wrote on.
    const reply = (authors: string[]) =>
      imported({ type: 'step' }, { object: 'step_reply', noteAuthors: authors });
    expect(canReadEvent(tester, reply([userId])).allowed).toBe(true);
    expect(canReadEvent(tester, reply([other])).allowed).toBe(false);
  });

  it('an agent row needs agent.read, a link group link.read, a cost line money.read', () => {
    expect(
      canReadEvent(person('member'), { ...imported({ type: 'agent' }), projectId: null }).allowed,
    ).toBe(false);
    expect(
      canReadEvent(person('admin'), { ...imported({ type: 'agent' }), projectId: null }).allowed,
    ).toBe(true);
    expect(canReadEvent(person('viewer'), imported({ type: 'cost_line' })).allowed).toBe(
      canReadEvent(person('viewer'), { workspaceId: ws, projectId: p1, type: 'cost_line.changed' })
        .allowed,
    );
    expect(canReadEvent(person('viewer'), imported({ type: 'link_group' })).allowed).toBe(
      canReadEvent(person('viewer'), { workspaceId: ws, projectId: p1, type: 'links.changed' })
        .allowed,
    );
  });

  it('a file reaches whoever reads what it is attached to', () => {
    expect(
      canReadEvent(person('reviewer'), imported({ type: 'file' }, { purpose: 'asset_variant' }))
        .allowed,
    ).toBe(true);
    expect(
      canReadEvent(person('reviewer'), imported({ type: 'file' }, { purpose: 'receipt' })).allowed,
    ).toBe(false);
  });
});

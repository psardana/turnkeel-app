import { createHash, randomUUID } from 'node:crypto';
import { can, personPrincipal } from '@turnkeel/core';
import {
  invitationSchema,
  memberSchema,
  projectMemberSchema,
  projectSchema,
  userSchema,
  workspaceSchema,
} from '@turnkeel/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Executor } from '../database.js';
import {
  countSignInAccounts,
  countUsers,
  countWorkspaces,
  createWorkspace,
  findInvitationByTokenHash,
  findUserByEmail,
  findUserById,
  findWorkspaceBySlug,
  hasOpenInvitation,
  listWorkspacesFor,
  membershipsOf,
} from '../directory.js';
import { ConflictError, MissingScopeError, NotInTransactionError } from '../errors.js';
import {
  deleteExpiredIdempotencyRecords,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  updateIdempotencyResponse,
} from '../idempotency.js';
import {
  toInvitation,
  toMember,
  toProject,
  toProjectMember,
  toUser,
  toWorkspace,
} from '../rows.js';
import { assertScope, workspaceScope, type WorkspaceScope } from '../scope.js';
import {
  createTestDatabase,
  createTestUser,
  createTestWorkspace,
  testEngines,
  type TestDatabase,
  type TestWorkspace,
} from '../testing/index.js';
import { repositories } from './index.js';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const inAWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

describe('a workspace scope', () => {
  it('is made from a workspace id', () => {
    const id = randomUUID();
    expect(workspaceScope(id.toUpperCase())).toEqual({ workspaceId: id });
  });

  it.each([
    undefined,
    null,
    '',
    'example',
    42,
    {},
    { workspaceId: '' },
    { workspaceId: 'example' },
  ])('is not %j', (value) => {
    expect(() => assertScope(value)).toThrow(MissingScopeError);
  });

  it('cannot be made from something that is not a workspace id', () => {
    expect(() => workspaceScope('')).toThrow(MissingScopeError);
    expect(() => workspaceScope('example')).toThrow(MissingScopeError);
    expect(() => workspaceScope(undefined as unknown as string)).toThrow(MissingScopeError);
  });
});

describe.each(testEngines)('repositories on %s', (engine) => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase(engine);
  });

  afterAll(async () => {
    await test.destroy();
  });

  const reposOf = (ws: TestWorkspace, executor: Executor = test.db) =>
    repositories(executor, workspaceScope(ws.workspace.id));

  async function addProject(ws: TestWorkspace, key: string, slug: string, name = 'Example Notes') {
    return test.db.transaction((tx) =>
      reposOf(ws, tx).projects.create({ name, key, slug, kind: 'app' }, { by: ws.by }),
    );
  }

  describe('the manual install', () => {
    it('is made with every project and with the workspace, by the system, and appends no event', async () => {
      const ws = await createTestWorkspace(test.db);
      const before = await reposOf(ws).events.list({ limit: 50 });
      const project = await addProject(ws, 'MAN', 'manual-notes');
      const installs = await reposOf(ws).connectorInstalls.list();
      expect(
        installs.map((one) => [
          one.connector,
          one.name,
          one.projectId,
          one.schedule,
          one.createdByKind,
        ]),
      ).toEqual([
        ['manual', 'manual', null, 'none', 'system'],
        ['manual', 'manual', project.id, 'none', 'system'],
      ]);
      expect(await reposOf(ws).events.list({ limit: 50 })).toEqual(before);
    });
  });

  describe('the scope', () => {
    it('a repository refuses to run without a scope', () => {
      const without = repositories as unknown as (db: Executor, scope?: unknown) => unknown;
      expect(() => without(test.db)).toThrow(MissingScopeError);
      expect(() => without(test.db, null)).toThrow(MissingScopeError);
      expect(() => without(test.db, {})).toThrow(MissingScopeError);
      expect(() => without(test.db, { workspaceId: '' })).toThrow(MissingScopeError);
      expect(() => without(test.db, { workspaceId: 'every-workspace' })).toThrow(MissingScopeError);
      expect(() => without(test.db, '*')).toThrow(MissingScopeError);
    });

    it('a repository refuses to run inside a transaction without a scope, too', async () => {
      await expect(
        test.db.transaction((tx) =>
          Promise.resolve((repositories as unknown as (db: Executor) => unknown)(tx)),
        ),
      ).rejects.toBeInstanceOf(MissingScopeError);
    });

    it('accepts a scope written by hand, as long as it names a workspace', async () => {
      const ws = await createTestWorkspace(test.db);
      const scope: WorkspaceScope = { workspaceId: ws.workspace.id.toUpperCase() };
      const repos = repositories(test.db, scope);
      expect(repos.scope.workspaceId).toBe(ws.workspace.id);
      expect((await repos.workspace.get())?.id).toBe(ws.workspace.id);
    });

    it('a repository of one workspace never returns or changes a row of another', async () => {
      const a = await createTestWorkspace(test.db);
      const b = await createTestWorkspace(test.db);
      const projectOfB = await addProject(b, 'NOTES', 'notes');
      const personOfB = await createTestUser(test.db);
      await reposOf(b).members.add(
        { userId: personOfB.id, role: 'member', handle: 'ben' },
        { by: b.by },
      );
      await reposOf(b).projectMembers.set(
        { projectId: projectOfB.id, userId: personOfB.id, role: 'viewer' },
        { by: b.by },
      );
      const { invitation } = await reposOf(b).invitations.create(
        {
          email: 'cara@example.com',
          role: 'member',
          tokenHash: hash(randomUUID()),
          invitedBy: b.owner.id,
          expiresAt: inAWeek(),
        },
        { by: b.by },
      );
      await test.db.transaction((tx) =>
        reposOf(b, tx).events.append({
          type: 'project.created',
          projectId: projectOfB.id,
          actor: { kind: 'user', id: b.owner.id, name: b.owner.name },
          via: 'web',
          requestId: randomUUID(),
          subject: { type: 'project', id: projectOfB.id },
        }),
      );

      const fromA = reposOf(a);
      // Reads
      expect(await fromA.projects.list({ includeArchived: true })).toEqual([]);
      expect(await fromA.projects.get(projectOfB.id)).toBeNull();
      expect(await fromA.projects.findByAddress('notes')).toBeNull();
      expect(await fromA.projects.findByAddress('NOTES')).toBeNull();
      expect(await fromA.members.get(personOfB.id)).toBeNull();
      expect(await fromA.members.findByHandle('ben')).toBeNull();
      expect((await fromA.members.list()).map((entry) => entry.member.handle)).toEqual(['owner']);
      expect(await fromA.projectMembers.listForProject(projectOfB.id)).toEqual([]);
      expect(await fromA.projectMembers.listForUser(personOfB.id)).toEqual([]);
      expect(await fromA.projectMembers.get(projectOfB.id, personOfB.id)).toBeNull();
      expect(await fromA.invitations.get(invitation.id)).toBeNull();
      expect(await fromA.invitations.list()).toEqual([]);
      expect(await fromA.events.listAfter(0, 100)).toEqual([]);
      expect(await fromA.events.latestSeq()).toBe(0);
      expect((await fromA.events.list({ limit: 50 })).items).toEqual([]);

      // Writes
      await test.db.transaction(async (tx) => {
        const repos = reposOf(a, tx);
        expect(
          await repos.projects.update(projectOfB.id, { name: 'Taken over' }, { by: a.by }),
        ).toBeNull();
        expect(await repos.projects.archive(projectOfB.id, { by: a.by })).toBeNull();
        expect(await repos.members.setRole(personOfB.id, 'owner', { by: a.by })).toBeNull();
        expect(await repos.members.setHandle(personOfB.id, 'mine', { by: a.by })).toBeNull();
        expect(await repos.members.remove(personOfB.id)).toBeNull();
        expect(
          await repos.projectMembers.set(
            { projectId: projectOfB.id, userId: a.owner.id, role: 'member' },
            { by: a.by },
          ),
        ).toBeNull();
        expect(await repos.projectMembers.remove(projectOfB.id, personOfB.id)).toBeNull();
        expect(await repos.invitations.revoke(invitation.id, { by: a.by })).toBeNull();
        expect(await repos.invitations.markAccepted(invitation.id, { by: a.by })).toBeNull();
      });

      // Nothing of b changed.
      const fromB = reposOf(b);
      expect(await fromB.projects.get(projectOfB.id)).toEqual(projectOfB);
      expect((await fromB.members.get(personOfB.id))?.handle).toBe('ben');
      expect((await fromB.projectMembers.get(projectOfB.id, personOfB.id))?.role).toBe('viewer');
      expect((await fromB.invitations.get(invitation.id))?.revokedAt).toBeNull();
      expect((await fromB.events.listAfter(0, 100)).map((event) => event.type)).toEqual([
        'project.created',
      ]);
    });
  });

  describe('workspaces', () => {
    it('creates a workspace with its event counter, and finds it by slug without regard to case', async () => {
      const ws = await createTestWorkspace(test.db, { slug: `acme-${randomUUID().slice(0, 8)}` });
      expect(workspaceSchema.parse(toWorkspace(ws.workspace))).toMatchObject({
        id: ws.workspace.id,
        workspaceId: ws.workspace.id,
        demo: false,
        deletedAt: null,
        createdBy: ws.by,
        updatedBy: ws.by,
      });
      const found = await findWorkspaceBySlug(test.db, ws.workspace.slug.toUpperCase());
      expect(found?.id).toBe(ws.workspace.id);
      expect(await findWorkspaceBySlug(test.db, 'no-such-workspace')).toBeNull();
      // The counter exists, so the first event gets seq 1.
      expect(await reposOf(ws).events.latestSeq()).toBe(0);
    });

    it('refuses a slug that another workspace has, whatever its case', async () => {
      const ws = await createTestWorkspace(test.db);
      const again = test.db.transaction((tx) =>
        createWorkspace(
          tx,
          { name: 'Copy', slug: ws.workspace.slug.toUpperCase(), baseCurrency: 'USD' },
          { by: ws.by },
        ),
      );
      await expect(again).rejects.toMatchObject({ name: 'ConflictError', code: 'slug_taken' });
    });

    it('needs a transaction to create one', async () => {
      const user = await createTestUser(test.db);
      await expect(
        createWorkspace(
          test.db as never,
          { name: 'X', slug: `x-${randomUUID().slice(0, 8)}`, baseCurrency: 'USD' },
          { by: { kind: 'user', id: user.id } },
        ),
      ).rejects.toBeInstanceOf(NotInTransactionError);
    });

    it('updates the name and refuses a slug that is taken', async () => {
      const a = await createTestWorkspace(test.db);
      const b = await createTestWorkspace(test.db);
      const later = new Date(Date.now() + 1000);
      const updated = await reposOf(a).workspace.update(
        { name: 'Renamed', baseCurrency: 'EUR' },
        { by: a.by, at: later },
      );
      expect(updated).toMatchObject({
        name: 'Renamed',
        baseCurrency: 'EUR',
        slug: a.workspace.slug,
      });
      expect(updated?.updatedAt.getTime()).toBe(later.getTime());
      expect(updated?.createdAt.getTime()).toBe(a.workspace.createdAt.getTime());

      await expect(
        test.db.transaction((tx) =>
          reposOf(a, tx).workspace.update({ slug: b.workspace.slug }, { by: a.by }),
        ),
      ).rejects.toMatchObject({ code: 'slug_taken' });
    });

    it('a deleted workspace keeps its rows, is not found by slug, and its slug is not given out again', async () => {
      const ws = await createTestWorkspace(test.db);
      await addProject(ws, 'NOTES', 'notes');
      const before = await countWorkspaces(test.db);
      const deleted = await reposOf(ws).workspace.markDeleted({ by: ws.by });
      expect(deleted?.deletedAt).toBeInstanceOf(Date);
      expect(await reposOf(ws).workspace.markDeleted({ by: ws.by })).toBeNull();

      expect(await findWorkspaceBySlug(test.db, ws.workspace.slug)).toBeNull();
      expect(
        (await findWorkspaceBySlug(test.db, ws.workspace.slug, { includeDeleted: true }))?.id,
      ).toBe(ws.workspace.id);
      expect(await countWorkspaces(test.db)).toBe(before - 1);
      expect(await countWorkspaces(test.db, { includeDeleted: true })).toBeGreaterThanOrEqual(
        before,
      );

      // The data is kept.
      expect(await reposOf(ws).projects.list()).toHaveLength(1);
      expect(await reposOf(ws).members.list()).toHaveLength(1);

      // All access stops: the person holds nothing there any more.
      expect(await membershipsOf(test.db, ws.owner.id)).toEqual([]);
      expect(await listWorkspacesFor(test.db, ws.owner.id)).toEqual([]);

      await expect(
        test.db.transaction((tx) =>
          createWorkspace(
            tx,
            { name: 'Again', slug: ws.workspace.slug, baseCurrency: 'USD' },
            { by: ws.by },
          ),
        ),
      ).rejects.toMatchObject({ code: 'slug_taken' });
    });
  });

  describe('projects', () => {
    it('creates a project with the defaults of the specification', async () => {
      const ws = await createTestWorkspace(test.db);
      const project = await addProject(ws, 'NOTES', 'example-notes');
      expect(projectSchema.parse(toProject(project))).toMatchObject({
        workspaceId: ws.workspace.id,
        name: 'Example Notes',
        key: 'NOTES',
        slug: 'example-notes',
        kind: 'app',
        launchDate: null,
        locales: ['en'],
        repoUrl: null,
        changelogPublic: false,
        archivedAt: null,
        createdBy: ws.by,
      });
    });

    it('finds a project by its slug or its key, without regard to case', async () => {
      const ws = await createTestWorkspace(test.db);
      const project = await addProject(ws, 'NOTES', 'example-notes');
      for (const address of ['example-notes', 'Example-Notes', 'NOTES', 'notes']) {
        expect((await reposOf(ws).projects.findByAddress(address))?.id).toBe(project.id);
      }
      expect(await reposOf(ws).projects.findByAddress('other')).toBeNull();
    });

    it('refuses a slug or a key that another project has, whatever its case', async () => {
      const ws = await createTestWorkspace(test.db);
      await addProject(ws, 'NOTES', 'example-notes');
      await expect(addProject(ws, 'OTHER', 'Example-Notes')).rejects.toMatchObject({
        name: 'ConflictError',
        code: 'slug_taken',
      });
      await expect(addProject(ws, 'notes', 'other')).rejects.toMatchObject({ code: 'key_taken' });
    });

    it('refuses a slug that equals another project’s key, and the reverse', async () => {
      const ws = await createTestWorkspace(test.db);
      await addProject(ws, 'NOTES', 'example-notes');
      await addProject(ws, 'WEB', 'site');
      // A slug that is another project's key.
      await expect(addProject(ws, 'OTHER', 'notes')).rejects.toMatchObject({ code: 'slug_taken' });
      // A key that is another project's slug.
      await expect(addProject(ws, 'site', 'other')).rejects.toMatchObject({ code: 'key_taken' });
      // A project's own slug may equal its own key.
      const same = await addProject(ws, 'DOCS', 'docs');
      expect(same).toMatchObject({ key: 'DOCS', slug: 'docs' });
    });

    it('applies the same rule when a project is renamed', async () => {
      const ws = await createTestWorkspace(test.db);
      const notes = await addProject(ws, 'NOTES', 'example-notes');
      const web = await addProject(ws, 'WEB', 'site');
      const update = (patch: { slug?: string; key?: string; name?: string }) =>
        test.db.transaction((tx) => reposOf(ws, tx).projects.update(web.id, patch, { by: ws.by }));

      await expect(update({ slug: 'notes' })).rejects.toMatchObject({ code: 'slug_taken' });
      await expect(update({ slug: 'example-notes' })).rejects.toMatchObject({ code: 'slug_taken' });
      await expect(update({ key: 'NOTES' })).rejects.toMatchObject({ code: 'key_taken' });
      await expect(update({ key: 'EXAMPLE' })).resolves.toMatchObject({ key: 'EXAMPLE' });
      // Keeping its own slug, or changing only its case, is not a clash with itself.
      await expect(update({ slug: 'site', name: 'Site' })).resolves.toMatchObject({ name: 'Site' });
      expect((await reposOf(ws).projects.get(notes.id))?.slug).toBe('example-notes');
    });

    it('lets two workspaces use the same slug and key', async () => {
      const a = await createTestWorkspace(test.db);
      const b = await createTestWorkspace(test.db);
      const inA = await addProject(a, 'NOTES', 'notes');
      const inB = await addProject(b, 'NOTES', 'notes');
      expect(inA.id).not.toBe(inB.id);
    });

    it('updates the fields of project.update and keeps the rest', async () => {
      const ws = await createTestWorkspace(test.db);
      const project = await addProject(ws, 'NOTES', 'notes');
      const updated = await test.db.transaction((tx) =>
        reposOf(ws, tx).projects.update(
          project.id,
          {
            launchDate: '2026-12-01',
            locales: ['en', 'pt-BR'],
            repoUrl: 'https://example.com/example/notes',
            changelogPublic: true,
          },
          { by: ws.by },
        ),
      );
      expect(toProject(updated!)).toMatchObject({
        name: 'Example Notes',
        key: 'NOTES',
        launchDate: '2026-12-01',
        locales: ['en', 'pt-BR'],
        repoUrl: 'https://example.com/example/notes',
        changelogPublic: true,
      });
      expect(
        await test.db.transaction((tx) =>
          reposOf(ws, tx).projects.update(randomUUID(), { name: 'Nothing' }, { by: ws.by }),
        ),
      ).toBeNull();
    });

    it('needs a transaction to create or change a project', async () => {
      const ws = await createTestWorkspace(test.db);
      await expect(
        reposOf(ws).projects.create(
          { name: 'X', key: 'XX', slug: 'xx', kind: 'other' },
          { by: ws.by },
        ),
      ).rejects.toBeInstanceOf(NotInTransactionError);
      await expect(
        reposOf(ws).projects.update(randomUUID(), { name: 'X' }, { by: ws.by }),
      ).rejects.toBeInstanceOf(NotInTransactionError);
    });

    it('archives a project and keeps it; an archived project leaves the list', async () => {
      const ws = await createTestWorkspace(test.db);
      const kept = await addProject(ws, 'WEB', 'site', 'Site');
      const project = await addProject(ws, 'NOTES', 'notes');
      const archived = await reposOf(ws).projects.archive(project.id, { by: ws.by });
      expect(archived?.archivedAt).toBeInstanceOf(Date);
      expect(await reposOf(ws).projects.archive(project.id, { by: ws.by })).toBeNull();

      expect((await reposOf(ws).projects.list()).map((row) => row.id)).toEqual([kept.id]);
      expect(
        (await reposOf(ws).projects.list({ includeArchived: true })).map((row) => row.id).sort(),
      ).toEqual([kept.id, project.id].sort());
      expect((await reposOf(ws).projects.get(project.id))?.archivedAt).toBeInstanceOf(Date);
      // Its slug and key stay taken.
      await expect(addProject(ws, 'NOTES', 'other')).rejects.toMatchObject({ code: 'key_taken' });
    });
  });

  describe('members', () => {
    it('adds members, lists them with their accounts, and counts the Owners', async () => {
      const ws = await createTestWorkspace(test.db);
      const ana = await createTestUser(test.db, { name: 'Ana Example' });
      const ben = await createTestUser(test.db, { name: 'Ben Example' });
      const repos = reposOf(ws);
      const member = await repos.members.add(
        { userId: ana.id, role: 'admin', handle: 'ana' },
        { by: ws.by },
      );
      await repos.members.add({ userId: ben.id, role: 'owner', handle: 'ben' }, { by: ws.by });

      expect(memberSchema.parse(toMember(member))).toMatchObject({
        userId: ana.id,
        role: 'admin',
        handle: 'ana',
        workspaceId: ws.workspace.id,
      });
      const list = await repos.members.list();
      expect(list.map((entry) => entry.member.handle)).toEqual(['ana', 'ben', 'owner']);
      expect(userSchema.parse(toUser(list[0]!.user))).toMatchObject({
        id: ana.id,
        name: 'Ana Example',
        email: ana.email,
      });
      expect(await repos.members.countOwners()).toBe(2);
      expect((await repos.members.findByHandle('ANA'))?.userId).toBe(ana.id);
      expect(await repos.members.findByHandle('nobody')).toBeNull();
    });

    it('refuses a handle that someone in the workspace has, whatever its case', async () => {
      const ws = await createTestWorkspace(test.db);
      const ana = await createTestUser(test.db);
      const ben = await createTestUser(test.db);
      await reposOf(ws).members.add(
        { userId: ana.id, role: 'member', handle: 'ana' },
        { by: ws.by },
      );
      await expect(
        test.db.transaction((tx) =>
          reposOf(ws, tx).members.add(
            { userId: ben.id, role: 'member', handle: 'Ana' },
            { by: ws.by },
          ),
        ),
      ).rejects.toMatchObject({ name: 'ConflictError', code: 'handle_taken' });
      await reposOf(ws).members.add(
        { userId: ben.id, role: 'member', handle: 'ben' },
        { by: ws.by },
      );
      await expect(
        test.db.transaction((tx) =>
          reposOf(ws, tx).members.setHandle(ben.id, 'ANA', { by: ws.by }),
        ),
      ).rejects.toMatchObject({ code: 'handle_taken' });
      expect((await reposOf(ws).members.setHandle(ben.id, 'benny', { by: ws.by }))?.handle).toBe(
        'benny',
      );
    });

    it('lets the same handle exist in two workspaces', async () => {
      const a = await createTestWorkspace(test.db);
      const b = await createTestWorkspace(test.db);
      expect(a.member.handle).toBe('owner');
      expect(b.member.handle).toBe('owner');
    });

    it('refuses to add a person who is already in the workspace', async () => {
      const ws = await createTestWorkspace(test.db);
      await expect(
        test.db.transaction((tx) =>
          reposOf(ws, tx).members.add(
            { userId: ws.owner.id, role: 'viewer', handle: 'again' },
            { by: ws.by },
          ),
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('the database itself refuses a member with the Tester role', async () => {
      const ws = await createTestWorkspace(test.db);
      const ana = await createTestUser(test.db);
      await expect(
        test.db.transaction((tx) =>
          reposOf(ws, tx).members.add(
            { userId: ana.id, role: 'tester' as 'viewer', handle: 'ana' },
            { by: ws.by },
          ),
        ),
      ).rejects.toThrow();
      expect(await reposOf(ws).members.get(ana.id)).toBeNull();
    });

    it('changes a role and removes a member', async () => {
      const ws = await createTestWorkspace(test.db);
      const ana = await createTestUser(test.db);
      const repos = reposOf(ws);
      await repos.members.add({ userId: ana.id, role: 'member', handle: 'ana' }, { by: ws.by });
      expect((await repos.members.setRole(ana.id, 'reviewer', { by: ws.by }))?.role).toBe(
        'reviewer',
      );
      expect((await repos.members.remove(ana.id))?.userId).toBe(ana.id);
      expect(await repos.members.get(ana.id)).toBeNull();
      expect(await repos.members.remove(ana.id)).toBeNull();
      expect(await repos.members.countOwners()).toBe(1);
    });
  });

  describe('project members', () => {
    it('gives, changes and removes a role in one project', async () => {
      const ws = await createTestWorkspace(test.db);
      const project = await addProject(ws, 'NOTES', 'notes');
      const tessa = await createTestUser(test.db, { name: 'Tessa Example' });
      const repos = reposOf(ws);

      const first = await repos.projectMembers.set(
        { projectId: project.id, userId: tessa.id, role: 'tester' },
        { by: ws.by },
      );
      expect(first?.previous).toBeNull();
      expect(projectMemberSchema.parse(toProjectMember(first!.projectMember))).toMatchObject({
        projectId: project.id,
        userId: tessa.id,
        role: 'tester',
        workspaceId: ws.workspace.id,
      });

      const second = await repos.projectMembers.set(
        { projectId: project.id, userId: tessa.id, role: 'reviewer' },
        { by: ws.by },
      );
      expect(second).toMatchObject({ previous: 'tester', projectMember: { role: 'reviewer' } });
      expect(second?.projectMember.id).toBe(first?.projectMember.id);

      const list = await repos.projectMembers.listForProject(project.id);
      expect(list.map((entry) => [entry.user.name, entry.projectMember.role])).toEqual([
        ['Tessa Example', 'reviewer'],
      ]);
      expect(
        (await repos.projectMembers.listForUser(tessa.id)).map((row) => row.projectId),
      ).toEqual([project.id]);

      expect((await repos.projectMembers.remove(project.id, tessa.id))?.userId).toBe(tessa.id);
      expect(await repos.projectMembers.get(project.id, tessa.id)).toBeNull();
    });

    it('returns null for a project the workspace does not have', async () => {
      const ws = await createTestWorkspace(test.db);
      expect(
        await reposOf(ws).projectMembers.set(
          { projectId: randomUUID(), userId: ws.owner.id, role: 'viewer' },
          { by: ws.by },
        ),
      ).toBeNull();
    });

    it('the database itself refuses a project member with the Admin role', async () => {
      const ws = await createTestWorkspace(test.db);
      const project = await addProject(ws, 'NOTES', 'notes');
      const ana = await createTestUser(test.db);
      await expect(
        test.db.transaction((tx) =>
          reposOf(ws, tx).projectMembers.set(
            { projectId: project.id, userId: ana.id, role: 'admin' as 'viewer' },
            { by: ws.by },
          ),
        ),
      ).rejects.toThrow();
    });

    it('builds the memberships that the permission check reads', async () => {
      const a = await createTestWorkspace(test.db);
      const b = await createTestWorkspace(test.db);
      const projectA = await addProject(a, 'NOTES', 'notes');
      const projectB = await addProject(b, 'WEB', 'site');
      const ana = await createTestUser(test.db);
      await reposOf(a).members.add({ userId: ana.id, role: 'viewer', handle: 'ana' }, { by: a.by });
      await reposOf(a).projectMembers.set(
        { projectId: projectA.id, userId: ana.id, role: 'member' },
        { by: a.by },
      );
      await reposOf(b).projectMembers.set(
        { projectId: projectB.id, userId: ana.id, role: 'tester' },
        { by: b.by },
      );

      const memberships = await membershipsOf(test.db, ana.id);
      expect([...memberships].sort((x, y) => x.workspaceId.localeCompare(y.workspaceId))).toEqual(
        [
          {
            workspaceId: a.workspace.id,
            role: 'viewer',
            projectRoles: { [projectA.id]: 'member' },
          },
          { workspaceId: b.workspace.id, role: null, projectRoles: { [projectB.id]: 'tester' } },
        ].sort((x, y) => x.workspaceId.localeCompare(y.workspaceId)),
      );
      expect((await listWorkspacesFor(test.db, ana.id)).map((row) => row.id).sort()).toEqual(
        [a.workspace.id, b.workspace.id].sort(),
      );
      expect(await membershipsOf(test.db, randomUUID())).toEqual([]);
      expect(await listWorkspacesFor(test.db, randomUUID())).toEqual([]);

      // And core answers from them.
      const principal = personPrincipal({ userId: ana.id, memberships });
      expect(
        can(principal, 'project.read', { workspaceId: b.workspace.id, projectId: projectB.id })
          .allowed,
      ).toBe(true);
      expect(
        can(principal, 'project.update', { workspaceId: a.workspace.id, projectId: projectA.id })
          .allowed,
      ).toBe(false);
      expect(
        can(
          a.by.kind === 'user'
            ? personPrincipal({
                userId: a.owner.id,
                memberships: await membershipsOf(test.db, a.owner.id),
              })
            : principal,
          'workspace.delete',
          { workspaceId: a.workspace.id },
        ).allowed,
      ).toBe(true);
    });
  });

  describe('invitations', () => {
    const invite = (ws: TestWorkspace, email: string, projectId?: string, token = randomUUID()) =>
      reposOf(ws).invitations.create(
        {
          email,
          role: projectId ? 'tester' : 'member',
          projectId: projectId ?? null,
          tokenHash: hash(token),
          invitedBy: ws.owner.id,
          expiresAt: inAWeek(),
        },
        { by: ws.by },
      );

    it('stores the hash of the token and never returns it in the protocol object', async () => {
      const ws = await createTestWorkspace(test.db);
      const token = randomUUID();
      const { invitation, replaced } = await invite(ws, 'Ana@Example.com', undefined, token);
      expect(replaced).toEqual([]);
      expect(invitation.email).toBe('ana@example.com');
      expect(invitation.tokenHash).toBe(hash(token));

      const shown = toInvitation(invitation);
      expect(invitationSchema.parse(shown)).toEqual(shown);
      expect(JSON.stringify(shown)).not.toContain(hash(token));
      expect(JSON.stringify(shown)).not.toContain(token);
      expect(Object.keys(shown)).not.toContain('tokenHash');
    });

    it('finds an invitation by the hash of its token, with its workspace', async () => {
      const ws = await createTestWorkspace(test.db);
      const token = randomUUID();
      const { invitation } = await invite(ws, 'ana@example.com', undefined, token);
      const found = await findInvitationByTokenHash(test.db, hash(token));
      expect(found?.invitation.id).toBe(invitation.id);
      expect(found?.workspace.id).toBe(ws.workspace.id);
      expect(await findInvitationByTokenHash(test.db, hash('another token'))).toBeNull();
      expect(await findInvitationByTokenHash(test.db, token)).toBeNull();
    });

    it('a second invitation to the same address replaces the first', async () => {
      const ws = await createTestWorkspace(test.db);
      const first = await invite(ws, 'ana@example.com');
      const second = await invite(ws, 'ANA@example.com');
      expect(second.replaced.map((row) => row.id)).toEqual([first.invitation.id]);
      expect(second.replaced[0]?.revokedAt).toBeInstanceOf(Date);
      const open = await reposOf(ws).invitations.list({ openOnly: true });
      expect(open.map((row) => row.id)).toEqual([second.invitation.id]);
      expect(await reposOf(ws).invitations.list()).toHaveLength(2);
    });

    it('an invitation to a project and one to the workspace do not replace each other', async () => {
      const ws = await createTestWorkspace(test.db);
      const project = await addProject(ws, 'NOTES', 'notes');
      const other = await addProject(ws, 'WEB', 'site');
      await invite(ws, 'ana@example.com');
      const toProjectOne = await invite(ws, 'ana@example.com', project.id);
      const toProjectTwo = await invite(ws, 'ana@example.com', other.id);
      expect(toProjectOne.replaced).toEqual([]);
      expect(toProjectTwo.replaced).toEqual([]);
      expect(await reposOf(ws).invitations.list({ openOnly: true })).toHaveLength(3);
      const again = await invite(ws, 'ana@example.com', project.id);
      expect(again.replaced.map((row) => row.id)).toEqual([toProjectOne.invitation.id]);
    });

    it('says which invitations a new one would replace, before it is made', async () => {
      const ws = await createTestWorkspace(test.db);
      const other = await createTestWorkspace(test.db);
      const project = await addProject(ws, 'NOTES', 'notes');
      const toWorkspace = await invite(ws, 'ana@example.com');
      const toProject = await invite(ws, 'ana@example.com', project.id);
      await invite(ws, 'ben@example.com');
      await invite(other, 'ana@example.com');

      const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
      expect(ids(await reposOf(ws).invitations.openFor('ANA@Example.com', null))).toEqual([
        toWorkspace.invitation.id,
      ]);
      expect(ids(await reposOf(ws).invitations.openFor('ana@example.com', project.id))).toEqual([
        toProject.invitation.id,
      ]);
      // What it names is exactly what `create` then replaces.
      const second = await invite(ws, 'ana@example.com');
      expect(ids(second.replaced)).toEqual([toWorkspace.invitation.id]);
      expect(ids(await reposOf(ws).invitations.openFor('ana@example.com', null))).toEqual([
        second.invitation.id,
      ]);
      await reposOf(ws).invitations.revoke(second.invitation.id, { by: ws.by });
      expect(await reposOf(ws).invitations.openFor('ana@example.com', null)).toEqual([]);
    });

    it('the database itself refuses a Tester invitation that names no project', async () => {
      const ws = await createTestWorkspace(test.db);
      const project = await addProject(ws, 'NOTES', 'notes');
      const create = (role: 'tester' | 'owner', projectId: string | null) =>
        test.db.transaction((tx) =>
          reposOf(ws, tx).invitations.create(
            {
              email: 'tessa@example.com',
              role,
              projectId,
              tokenHash: hash(randomUUID()),
              invitedBy: ws.owner.id,
              expiresAt: inAWeek(),
            },
            { by: ws.by },
          ),
        );
      await expect(create('tester', null)).rejects.toThrow();
      // R30: and an invitation to a project that gives the Owner role.
      await expect(create('owner', project.id)).rejects.toThrow();
      await expect(create('tester', project.id)).resolves.toMatchObject({
        invitation: { role: 'tester', projectId: project.id },
      });
    });

    it('an invitation is accepted once', async () => {
      const ws = await createTestWorkspace(test.db);
      const { invitation } = await invite(ws, 'ana@example.com');
      const repos = reposOf(ws);
      const accepted = await repos.invitations.markAccepted(invitation.id, { by: ws.by });
      expect(accepted?.acceptedAt).toBeInstanceOf(Date);
      expect(await repos.invitations.markAccepted(invitation.id, { by: ws.by })).toBeNull();
      expect(await repos.invitations.revoke(invitation.id, { by: ws.by })).toBeNull();
      expect(await repos.invitations.list({ openOnly: true })).toEqual([]);
    });

    it('a revoked invitation cannot be accepted', async () => {
      const ws = await createTestWorkspace(test.db);
      const { invitation } = await invite(ws, 'ana@example.com');
      const repos = reposOf(ws);
      expect(
        (await repos.invitations.revoke(invitation.id, { by: ws.by }))?.revokedAt,
      ).toBeInstanceOf(Date);
      expect(await repos.invitations.revoke(invitation.id, { by: ws.by })).toBeNull();
      expect(await repos.invitations.markAccepted(invitation.id, { by: ws.by })).toBeNull();
    });

    it('knows whether an address has an invitation that can still be accepted', async () => {
      const ws = await createTestWorkspace(test.db);
      const email = `open-${randomUUID().slice(0, 8)}@example.com`;
      expect(await hasOpenInvitation(test.db, email)).toBe(false);
      const { invitation } = await invite(ws, email);
      expect(await hasOpenInvitation(test.db, email.toUpperCase())).toBe(true);
      // Not after it expired.
      expect(await hasOpenInvitation(test.db, email, new Date(Date.now() + 8 * 86_400_000))).toBe(
        false,
      );
      await reposOf(ws).invitations.revoke(invitation.id, { by: ws.by });
      expect(await hasOpenInvitation(test.db, email)).toBe(false);

      // Not when its workspace is deleted.
      const gone = await createTestWorkspace(test.db);
      const other = `gone-${randomUUID().slice(0, 8)}@example.com`;
      const token = randomUUID();
      await invite(gone, other, undefined, token);
      expect(await hasOpenInvitation(test.db, other)).toBe(true);
      await reposOf(gone).workspace.markDeleted({ by: gone.by });
      expect(await hasOpenInvitation(test.db, other)).toBe(false);
      expect(await findInvitationByTokenHash(test.db, hash(token))).toBeNull();
    });
  });

  describe('the event list', () => {
    it('pages newest first by seq, and filters by project, type, actor, subject and time', async () => {
      const ws = await createTestWorkspace(test.db);
      const project = await addProject(ws, 'NOTES', 'notes');
      const ana = await createTestUser(test.db, { name: 'Ana Example' });
      const base = new Date('2026-11-01T00:00:00.000Z').getTime();
      await test.db.transaction(async (tx) => {
        const repos = reposOf(ws, tx);
        for (let index = 0; index < 7; index += 1) {
          const about = index % 2 === 0;
          await repos.events.append({
            type: about ? 'project.updated' : 'member.role_changed',
            projectId: about ? project.id : null,
            actor:
              index < 5
                ? { kind: 'user', id: ws.owner.id, name: ws.owner.name }
                : { kind: 'user', id: ana.id, name: ana.name },
            via: 'web',
            requestId: randomUUID(),
            subject: about
              ? { type: 'project', id: project.id }
              : { type: 'member', id: ws.member.id },
            data: { index: [null, index] },
            at: new Date(base + index * 86_400_000),
          });
        }
      });
      const repos = reposOf(ws);

      const first = await repos.events.list({ limit: 3 });
      expect(first.items.map((event) => event.seq)).toEqual([7, 6, 5]);
      expect(first.nextBefore).toBe(5);
      const second = await repos.events.list({ limit: 3, before: first.nextBefore! });
      expect(second.items.map((event) => event.seq)).toEqual([4, 3, 2]);
      const third = await repos.events.list({ limit: 3, before: second.nextBefore! });
      expect(third.items.map((event) => event.seq)).toEqual([1]);
      expect(third.nextBefore).toBeNull();
      expect((await repos.events.list({ limit: 7 })).nextBefore).toBeNull();

      const seqsOf = async (filter: Parameters<typeof repos.events.list>[0]) =>
        (await repos.events.list(filter)).items.map((event) => event.seq);
      expect(await seqsOf({ limit: 50, projectId: project.id })).toEqual([7, 5, 3, 1]);
      expect(await seqsOf({ limit: 50, types: ['member.role_changed'] })).toEqual([6, 4, 2]);
      expect(await seqsOf({ limit: 50, types: [] })).toEqual([]);
      expect(await seqsOf({ limit: 50, actorId: ana.id })).toEqual([7, 6]);
      expect(await seqsOf({ limit: 50, subjectId: ws.member.id })).toEqual([6, 4, 2]);
      expect(
        await seqsOf({
          limit: 50,
          from: new Date(base + 2 * 86_400_000),
          to: new Date(base + 4 * 86_400_000),
        }),
      ).toEqual([5, 4, 3]);
      expect(await repos.events.latestSeq()).toBe(7);
    });

    it('reads the whole log in batches, oldest first, for the export', async () => {
      const ws = await createTestWorkspace(test.db);
      await test.db.transaction(async (tx) => {
        for (let index = 0; index < 12; index += 1) {
          await reposOf(ws, tx).events.append({
            type: 'workspace.updated',
            actor: { kind: 'user', id: ws.owner.id, name: ws.owner.name },
            via: 'web',
            requestId: randomUUID(),
            subject: { type: 'workspace', id: ws.workspace.id },
          });
        }
      });
      const seqs: number[] = [];
      for await (const event of reposOf(ws).events.all(5)) seqs.push(event.seq);
      expect(seqs).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    });
  });

  describe('accounts', () => {
    it('counts the accounts someone can sign in to, without those under .invalid', async () => {
      const all = await countUsers(test.db);
      const canSignIn = await countSignInAccounts(test.db);
      await createTestUser(test.db, {
        email: `Owner-${randomUUID().slice(0, 8)}@Turnkeel.INVALID`,
      });
      await createTestUser(test.db, { email: `invalid-${randomUUID().slice(0, 8)}@example.com` });
      expect(await countUsers(test.db)).toBe(all + 2);
      expect(await countSignInAccounts(test.db)).toBe(canSignIn + 1);
    });

    it('finds an account by id and by email address, without regard to case', async () => {
      const before = await countUsers(test.db);
      const email = `Find-${randomUUID().slice(0, 8)}@Example.com`;
      const user = await createTestUser(test.db, { email, name: 'Ana Example' });
      expect(user.email).toBe(email.toLowerCase());
      expect(await countUsers(test.db)).toBe(before + 1);
      expect((await findUserById(test.db, user.id))?.name).toBe('Ana Example');
      expect((await findUserByEmail(test.db, email.toUpperCase()))?.id).toBe(user.id);
      expect(await findUserByEmail(test.db, 'nobody@example.com')).toBeNull();
      expect(await findUserById(test.db, randomUUID())).toBeNull();
    });

    it('refuses a second account with the same email address in another case', async () => {
      const email = `twice-${randomUUID().slice(0, 8)}@example.com`;
      await createTestUser(test.db, { email });
      await expect(
        test.db.transaction((tx) => createTestUser(tx, { email: email.toUpperCase() })),
      ).rejects.toThrow();
    });
  });

  describe('idempotency records', () => {
    it('keeps the first result of a keyed write for 24 hours, by principal, scope and key', async () => {
      const ws = await createTestWorkspace(test.db);
      const where = { principal: ws.by, scope: 'POST /api/v1/workspaces/x/projects', key: 'k-1' };
      const now = new Date('2026-11-11T12:00:00.000Z');
      expect(await findIdempotencyRecord(test.db, where, now)).toBeNull();

      const saved = await saveIdempotencyRecord(
        test.db,
        {
          ...where,
          workspaceId: ws.workspace.id,
          requestHash: hash('body'),
          response: { status: 201, body: { id: 'p1' } },
        },
        now,
      );
      expect(saved.expiresAt.toISOString()).toBe('2026-11-12T12:00:00.000Z');

      const found = await findIdempotencyRecord(test.db, where, now);
      expect(found).toMatchObject({
        requestHash: hash('body'),
        response: { status: 201, body: { id: 'p1' } },
        workspaceId: ws.workspace.id,
        tokenId: null,
      });

      // Another key, another scope and another principal each find nothing.
      expect(await findIdempotencyRecord(test.db, { ...where, key: 'k-2' }, now)).toBeNull();
      expect(
        await findIdempotencyRecord(test.db, { ...where, scope: 'create_card' }, now),
      ).toBeNull();
      expect(
        await findIdempotencyRecord(
          test.db,
          { ...where, principal: { kind: 'agent', id: ws.owner.id } },
          now,
        ),
      ).toBeNull();
    });

    it('keeps the records of two tokens of one agent apart, and a person’s apart from both', async () => {
      const ws = await createTestWorkspace(test.db);
      const agentRef = { kind: 'agent' as const, id: randomUUID() };
      const first = randomUUID();
      const second = randomUUID();
      const scope = 'POST /api/v1/workspaces/x/projects';
      const key = randomUUID();
      const record = { workspaceId: ws.workspace.id, requestHash: 'a', scope, key };
      await saveIdempotencyRecord(test.db, {
        ...record,
        principal: agentRef,
        tokenId: first,
        response: 'first',
      });
      expect(
        (await findIdempotencyRecord(test.db, { principal: agentRef, tokenId: first, scope, key }))
          ?.response,
      ).toBe('first');
      expect(
        await findIdempotencyRecord(test.db, { principal: agentRef, tokenId: second, scope, key }),
      ).toBeNull();
      expect(await findIdempotencyRecord(test.db, { principal: agentRef, scope, key })).toBeNull();
      // The other token keeps a record of its own under the same key.
      await saveIdempotencyRecord(test.db, {
        ...record,
        principal: agentRef,
        tokenId: second,
        response: 'second',
      });
      expect(
        (await findIdempotencyRecord(test.db, { principal: agentRef, tokenId: second, scope, key }))
          ?.response,
      ).toBe('second');
      // A person has no token, and still one record per key.
      await saveIdempotencyRecord(test.db, { ...record, principal: ws.by, response: 'person' });
      await expect(
        test.db.transaction((tx) =>
          saveIdempotencyRecord(tx, { ...record, principal: ws.by, response: 'again' }),
        ),
      ).rejects.toThrow();
    });

    it('refuses a second record for the same key while the first is kept, and replaces it once expired', async () => {
      const ws = await createTestWorkspace(test.db);
      const where = { principal: ws.by, scope: 'create_card', key: randomUUID() };
      const now = new Date('2026-11-11T12:00:00.000Z');
      const record = { ...where, workspaceId: ws.workspace.id, requestHash: 'a', response: 1 };
      await saveIdempotencyRecord(test.db, record, now);
      await expect(
        test.db.transaction((tx) => saveIdempotencyRecord(tx, { ...record, response: 2 }, now)),
      ).rejects.toThrow();
      expect((await findIdempotencyRecord(test.db, where, now))?.response).toBe(1);

      const later = new Date('2026-11-12T12:00:00.000Z');
      expect(await findIdempotencyRecord(test.db, where, later)).toBeNull();
      await saveIdempotencyRecord(test.db, { ...record, response: 3 }, later);
      expect((await findIdempotencyRecord(test.db, where, later))?.response).toBe(3);
    });

    it('changes the kept answer of one key, and says when there is no record to change', async () => {
      const ws = await createTestWorkspace(test.db);
      const where = { principal: ws.by, scope: 'POST /invitations', key: randomUUID() };
      const other = { ...where, key: randomUUID() };
      const record = { workspaceId: ws.workspace.id, requestHash: 'a' };
      await saveIdempotencyRecord(test.db, { ...where, ...record, response: { mail: 'sent' } });
      await saveIdempotencyRecord(test.db, { ...other, ...record, response: { mail: 'sent' } });

      expect(await updateIdempotencyResponse(test.db, where, { mail: 'failed' })).toBe(true);
      expect((await findIdempotencyRecord(test.db, where))?.response).toEqual({ mail: 'failed' });
      expect((await findIdempotencyRecord(test.db, where))?.requestHash).toBe('a');
      expect((await findIdempotencyRecord(test.db, other))?.response).toEqual({ mail: 'sent' });

      expect(
        await updateIdempotencyResponse(test.db, { ...where, key: randomUUID() }, { mail: 'x' }),
      ).toBe(false);
      await expect(updateIdempotencyResponse(test.db, where, null)).rejects.toBeInstanceOf(
        TypeError,
      );
    });

    it('removes the records that have expired', async () => {
      const ws = await createTestWorkspace(test.db);
      const now = new Date('2030-01-01T00:00:00.000Z');
      const where = { principal: ws.by, scope: 'create_card', key: randomUUID() };
      await saveIdempotencyRecord(
        test.db,
        { ...where, workspaceId: ws.workspace.id, requestHash: 'a', response: { status: 204 } },
        new Date('2020-01-01T00:00:00.000Z'),
      );
      const fresh = { ...where, key: randomUUID() };
      await saveIdempotencyRecord(
        test.db,
        { ...fresh, workspaceId: ws.workspace.id, requestHash: 'a', response: { status: 204 } },
        now,
      );
      expect(
        await deleteExpiredIdempotencyRecords(test.db, new Date('2021-01-01T00:00:00.000Z')),
      ).toBe(1);
      expect(await findIdempotencyRecord(test.db, fresh, now)).not.toBeNull();
    });

    it('refuses a record without a response', async () => {
      const ws = await createTestWorkspace(test.db);
      await expect(
        saveIdempotencyRecord(test.db, {
          principal: ws.by,
          scope: 'create_card',
          key: randomUUID(),
          workspaceId: ws.workspace.id,
          requestHash: 'a',
          response: null,
        }),
      ).rejects.toBeInstanceOf(TypeError);
    });
  });
});

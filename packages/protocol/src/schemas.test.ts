import { describe, expect, it } from 'vitest';
import {
  SYSTEM_PRINCIPAL_ID,
  acceptInvitationRequestSchema,
  createInvitationRequestSchema,
  createProjectRequestSchema,
  createWorkspaceRequestSchema,
  emailSchema,
  errorBody,
  errorBodySchema,
  errorCodes,
  errorStatuses,
  handleSchema,
  invitationSchema,
  memberSchema,
  pageQuerySchema,
  pageSchema,
  principalRefSchema,
  projectKeySchema,
  projectMemberSchema,
  projectRoles,
  projectSchema,
  roles,
  slugSchema,
  systemPrincipalRef,
  updateMemberRequestSchema,
  updateProjectRequestSchema,
  updateWorkspaceRequestSchema,
  workspaceRoles,
  workspaceSchema,
} from './index.js';

const id = '0192f0c1-7a3e-4b1c-9d2e-4f5a6b7c8d9e';
const otherId = '0192f0c1-7a3e-4b1c-9d2e-000000000001';
const at = '2026-11-11T09:30:00.000Z';
const by = { kind: 'user', id } as const;
const common = {
  id,
  workspaceId: id,
  createdAt: at,
  createdBy: by,
  updatedAt: at,
  updatedBy: by,
};

describe('ids', () => {
  it('accepts a slug of lower-case letters, digits and single hyphens', () => {
    expect(slugSchema.parse('example-notes-2')).toBe('example-notes-2');
  });

  it.each(['A', 'Example', 'a--b', '-a', 'a-', 'a b', 'a_b', 'x'.repeat(41)])(
    'rejects the slug %j',
    (slug) => {
      expect(slugSchema.safeParse(slug).success).toBe(false);
    },
  );

  it('keeps a project key in upper case', () => {
    expect(projectKeySchema.parse('app')).toBe('APP');
    expect(projectKeySchema.parse('Notes')).toBe('NOTES');
  });

  it.each(['A', 'ABCDEFG', 'AB1', 'A-B', ''])('rejects the project key %j', (key) => {
    expect(projectKeySchema.safeParse(key).success).toBe(false);
  });

  it('accepts a handle and rejects upper case', () => {
    expect(handleSchema.parse('owner')).toBe('owner');
    expect(handleSchema.parse('ana-2')).toBe('ana-2');
    expect(handleSchema.safeParse('Ana').success).toBe(false);
    expect(handleSchema.safeParse('@ana').success).toBe(false);
  });

  it('keeps an email address in lower case', () => {
    expect(emailSchema.parse('Ana@Example.com')).toBe('ana@example.com');
    expect(emailSchema.safeParse('not an address').success).toBe(false);
  });
});

describe('principals', () => {
  it('names a person, an agent or the system', () => {
    expect(principalRefSchema.parse({ kind: 'user', id })).toEqual({ kind: 'user', id });
    expect(principalRefSchema.parse({ kind: 'agent', id })).toEqual({ kind: 'agent', id });
    expect(principalRefSchema.parse(systemPrincipalRef)).toEqual({
      kind: 'system',
      id: SYSTEM_PRINCIPAL_ID,
    });
  });

  it('cannot name a party', () => {
    expect(principalRefSchema.safeParse({ kind: 'party', id }).success).toBe(false);
  });
});

describe('roles', () => {
  it('Tester is a project role and never a workspace role', () => {
    expect(workspaceRoles).not.toContain('tester');
    expect(projectRoles).toContain('tester');
  });

  it('a project role is one of Member, Reviewer, Tester or Viewer', () => {
    expect([...projectRoles].sort()).toEqual(['member', 'reviewer', 'tester', 'viewer']);
  });

  it('lists every role once, highest first', () => {
    expect(roles).toEqual(['owner', 'admin', 'member', 'reviewer', 'tester', 'viewer']);
  });
});

describe('workspace', () => {
  const workspace = {
    ...common,
    name: 'Example Co',
    slug: 'example',
    baseCurrency: 'EUR',
    timeZone: 'Europe/Berlin',
    planning: { recurring: true, timeTracking: true, gantt: false, savedViews: true },
    tabsOff: ['releases'],
    tabsKeptAt: null,
    demo: false,
    deletedAt: null,
  };

  it('accepts a workspace', () => {
    expect(workspaceSchema.parse(workspace)).toEqual(workspace);
  });

  it('rejects a field it does not know', () => {
    expect(workspaceSchema.safeParse({ ...workspace, plan: 'pro' }).success).toBe(false);
  });

  it('takes a name, a slug and the handle of the person who creates it, in EUR unless given', () => {
    expect(
      createWorkspaceRequestSchema.parse({ name: ' Example Co ', slug: 'example', handle: 'ana' }),
    ).toEqual({ name: 'Example Co', slug: 'example', baseCurrency: 'EUR', handle: 'ana' });
  });

  it('does not let a request set demo', () => {
    expect(
      createWorkspaceRequestSchema.safeParse({
        name: 'Example Co',
        slug: 'example',
        handle: 'ana',
        demo: true,
      }).success,
    ).toBe(false);
    expect(updateWorkspaceRequestSchema.safeParse({ demo: true }).success).toBe(false);
    expect(updateWorkspaceRequestSchema.safeParse({ deletedAt: at }).success).toBe(false);
  });

  it('accepts an update of one field', () => {
    expect(updateWorkspaceRequestSchema.parse({ name: 'New name' })).toEqual({ name: 'New name' });
  });
});

describe('project', () => {
  const project = {
    ...common,
    name: 'Example Notes',
    key: 'NOTES',
    slug: 'example-notes',
    kind: 'app',
    launchDate: '2026-12-01',
    launchMilestoneId: null,
    locales: ['en', 'pt-BR'],
    repoUrl: 'https://example.com/example/notes',
    shipsTo: ['appstore', 'play'],
    changelogPublic: false,
    archivedAt: null,
  };

  it('accepts a project', () => {
    expect(projectSchema.parse(project)).toEqual(project);
  });

  it('fills in the defaults of a new project', () => {
    expect(
      createProjectRequestSchema.parse({ name: 'Example Notes', key: 'notes', slug: 'notes' }),
    ).toEqual({
      name: 'Example Notes',
      key: 'NOTES',
      slug: 'notes',
      kind: 'other',
      launchDate: null,
      locales: ['en'],
      repoUrl: null,
      shipsTo: [],
    });
  });

  it('rejects a repository address that is not http or https', () => {
    expect(
      createProjectRequestSchema.safeParse({
        name: 'Example Notes',
        key: 'notes',
        slug: 'notes',
        repoUrl: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
  });

  it('rejects a repository address that carries a user name or a password', () => {
    for (const repoUrl of [
      'https://user:ghp_secret@github.com/org/repo.git',
      'https://ghp_secret@github.com/org/repo.git',
      'https://:ghp_secret@github.com/org/repo.git',
    ]) {
      const base = { name: 'Example Notes', key: 'notes', slug: 'notes' };
      const created = createProjectRequestSchema.safeParse({ ...base, repoUrl });
      expect(created.success, repoUrl).toBe(false);
      expect(created.error?.issues[0]?.message).toBe(
        'Leave the user name and the password out of the address.',
      );
      expect(updateProjectRequestSchema.safeParse({ repoUrl }).success, repoUrl).toBe(false);
    }
    // An address without them is taken, also one with an @ in its path.
    for (const repoUrl of ['https://github.com/org/repo.git', 'https://example.com/@scope/repo']) {
      expect(updateProjectRequestSchema.safeParse({ repoUrl }).success, repoUrl).toBe(true);
    }
  });

  it('rejects an empty list of locales and a date with a time', () => {
    expect(updateProjectRequestSchema.safeParse({ locales: [] }).success).toBe(false);
    expect(updateProjectRequestSchema.safeParse({ launchDate: at }).success).toBe(false);
  });

  it('does not let an update archive a project', () => {
    expect(updateProjectRequestSchema.safeParse({ archivedAt: at }).success).toBe(false);
  });
});

describe('members', () => {
  it('accepts a member with a workspace role and a handle', () => {
    const member = { ...common, userId: otherId, role: 'admin', handle: 'ana' };
    expect(memberSchema.parse(member)).toEqual(member);
  });

  it('rejects a member with the Tester role', () => {
    expect(
      memberSchema.safeParse({ ...common, userId: otherId, role: 'tester', handle: 'ana' }).success,
    ).toBe(false);
    expect(updateMemberRequestSchema.safeParse({ role: 'tester' }).success).toBe(false);
  });

  it('rejects a project member with the Owner or the Admin role', () => {
    for (const role of ['owner', 'admin']) {
      expect(
        projectMemberSchema.safeParse({ ...common, projectId: id, userId: otherId, role }).success,
      ).toBe(false);
    }
    expect(
      projectMemberSchema.safeParse({ ...common, projectId: id, userId: otherId, role: 'tester' })
        .success,
    ).toBe(true);
  });
});

describe('invitations', () => {
  const invitation = {
    ...common,
    email: 'ana@example.com',
    role: 'member',
    projectId: null,
    invitedBy: id,
    expiresAt: at,
    acceptedAt: null,
    revokedAt: null,
  };

  it('accepts an invitation', () => {
    expect(invitationSchema.parse(invitation)).toEqual(invitation);
  });

  it('has no place for the token or its hash', () => {
    expect(invitationSchema.safeParse({ ...invitation, tokenHash: 'abc' }).success).toBe(false);
    expect(invitationSchema.safeParse({ ...invitation, token: 'abc' }).success).toBe(false);
  });

  it('takes an email address, a role and an optional project', () => {
    expect(
      createInvitationRequestSchema.parse({ email: 'Ana@Example.com', role: 'tester' }),
    ).toEqual({ email: 'ana@example.com', role: 'tester' });
    expect(
      createInvitationRequestSchema.parse({
        email: 'ana@example.com',
        role: 'tester',
        projectId: id,
      }),
    ).toEqual({ email: 'ana@example.com', role: 'tester', projectId: id });
  });

  it('accepts with a token and, for a workspace, a handle', () => {
    expect(acceptInvitationRequestSchema.parse({ token: 'abc', handle: 'ana' })).toEqual({
      token: 'abc',
      handle: 'ana',
    });
    expect(acceptInvitationRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('pagination', () => {
  it('reads the limit from a query string and has a default', () => {
    expect(pageQuerySchema.parse({ limit: '20' })).toEqual({ limit: 20 });
    expect(pageQuerySchema.parse({})).toEqual({ limit: 50 });
  });

  it('rejects a limit outside 1 to 200', () => {
    expect(pageQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
  });

  it('wraps items and the cursor of the next page', () => {
    const page = pageSchema(slugSchema);
    expect(page.parse({ items: ['a1'], nextCursor: null })).toEqual({
      items: ['a1'],
      nextCursor: null,
    });
    expect(page.safeParse({ items: ['A'], nextCursor: null }).success).toBe(false);
  });
});

describe('errors', () => {
  it('builds the body of an error answer', () => {
    expect(errorBody('not_found', 'There is nothing at this address.')).toEqual({
      error: { code: 'not_found', message: 'There is nothing at this address.' },
    });
    expect(errorBody('forbidden', 'Only an Owner can delete the workspace.', 'R8')).toEqual({
      error: { code: 'forbidden', message: 'Only an Owner can delete the workspace.', rule: 'R8' },
    });
  });

  it('accepts what it builds and rejects a code it does not know', () => {
    expect(errorBodySchema.safeParse(errorBody('conflict', 'x', 'R51')).success).toBe(true);
    expect(errorBodySchema.safeParse({ error: { code: 'nope', message: 'x' } }).success).toBe(
      false,
    );
    expect(
      errorBodySchema.safeParse({ error: { code: 'conflict', message: 'x', rule: 'rule 8' } })
        .success,
    ).toBe(false);
  });

  it('gives every code one of the statuses of the specification', () => {
    const allowed = [400, 401, 403, 404, 405, 409, 413, 422, 429, 500];
    for (const code of errorCodes) {
      expect(allowed).toContain(errorStatuses[code]);
    }
  });
});

import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { isTransaction, type Executor, type Transaction } from '../database.js';
import { ConflictError, NotInTransactionError } from '../errors.js';
import { lockWorkspace } from '../events/append.js';
import { created, updated, type ProjectRow, type Stamp } from '../rows.js';
import type { WorkspaceScope } from '../scope.js';

export interface NewProject {
  name: string;
  key: string;
  slug: string;
  kind: ProjectKind;
  launchDate?: string | null;
  locales?: string[];
  repoUrl?: string | null;
  /** Where it ships. Empty unless given. */
  shipsTo?: ProjectTarget[];
}

export type ProjectPatch = Partial<
  NewProject & { changelogPublic: boolean; launchMilestoneId: string | null }
>;

const lower = (value: string) => value.toLowerCase();

export function projectsRepository(executor: Executor, scope: WorkspaceScope) {
  const inWorkspace = eq(projects.workspaceId, scope.workspaceId);

  function transaction(what: string): Transaction {
    if (!isTransaction(executor)) throw new NotInTransactionError(what);
    return executor;
  }

  /**
   * A slug and a key each name one project in the workspace, so neither may equal the
   * slug or the key of another project. The unique indexes cover slug
   * against slug and key against key; this covers all four pairs, and runs under the
   * workspace's lock so two writers cannot both pass it.
   */
  async function assertAddressFree(slug: string, key: string, exceptId: string | null) {
    const wanted = [lower(slug), lower(key)];
    const clashes = await executor
      .select({ id: projects.id, slug: projects.slug, key: projects.key })
      .from(projects)
      .where(
        and(
          inWorkspace,
          exceptId === null ? undefined : ne(projects.id, exceptId),
          or(
            sql`lower(${projects.slug}) in (${wanted[0]}, ${wanted[1]})`,
            sql`lower(${projects.key}) in (${wanted[0]}, ${wanted[1]})`,
          ),
        ),
      );
    for (const other of clashes) {
      const taken = [lower(other.slug), lower(other.key)];
      if (taken.includes(lower(slug))) {
        throw new ConflictError(
          'slug_taken',
          `Another project in this workspace already has "${slug}" as its slug or its key.`,
        );
      }
      if (taken.includes(lower(key))) {
        throw new ConflictError(
          'key_taken',
          `Another project in this workspace already has "${key}" as its key or its slug.`,
        );
      }
    }
  }

  return {
    /** The projects of the workspace by name. Archived ones are left out unless asked for. */
    async list(options: { includeArchived?: boolean } = {}): Promise<ProjectRow[]> {
      return executor
        .select()
        .from(projects)
        .where(and(inWorkspace, options.includeArchived ? undefined : isNull(projects.archivedAt)))
        .orderBy(asc(sql`lower(${projects.name})`), asc(projects.id));
    },

    async get(id: string): Promise<ProjectRow | null> {
      const rows = await executor
        .select()
        .from(projects)
        .where(and(inWorkspace, eq(projects.id, id)));
      return rows[0] ?? null;
    },

    /** The project again, its row locked until the transaction ends (R75: the launch link). */
    async lock(id: string): Promise<ProjectRow | null> {
      const rows = await executor
        .select()
        .from(projects)
        .where(and(inWorkspace, eq(projects.id, id)))
        .for('update');
      return rows[0] ?? null;
    },

    /** The project that `:p` names: its slug or its key, without regard to case. */
    async findByAddress(address: string): Promise<ProjectRow | null> {
      const wanted = lower(address);
      const rows = await executor
        .select()
        .from(projects)
        .where(
          and(
            inWorkspace,
            or(sql`lower(${projects.slug}) = ${wanted}`, sql`lower(${projects.key}) = ${wanted}`),
          ),
        );
      return rows[0] ?? null;
    },

    /** Creates a project. Throws `ConflictError` when its slug or key is taken. */
    async create(input: NewProject, stamp: Stamp): Promise<ProjectRow> {
      const tx = transaction('projects.create');
      await lockWorkspace(tx, scope.workspaceId);
      await assertAddressFree(input.slug, input.key, null);
      const rows = await tx
        .insert(projects)
        .values({
          id: randomUUID(),
          workspaceId: scope.workspaceId,
          name: input.name,
          key: input.key,
          slug: input.slug,
          kind: input.kind,
          launchDate: input.launchDate ?? null,
          locales: input.locales ?? ['en'],
          repoUrl: input.repoUrl ?? null,
          shipsTo: input.shipsTo ?? [],
          ...created(stamp),
        })
        .returning();
      const project = rows[0]!;
      // Every project has one install of the `manual` connector, made with it.
      await tx
        .insert(connectorInstalls)
        .values(manualInstallValues(scope.workspaceId, project.id, stamp.at ?? new Date()));
      return project;
    },

    /** Changes a project. Returns null when the workspace has no such project. */
    async update(id: string, patch: ProjectPatch, stamp: Stamp): Promise<ProjectRow | null> {
      const tx = transaction('projects.update');
      if (patch.slug !== undefined || patch.key !== undefined) {
        await lockWorkspace(tx, scope.workspaceId);
        const current = await this.get(id);
        if (!current) return null;
        await assertAddressFree(patch.slug ?? current.slug, patch.key ?? current.key, id);
      }
      const rows = await tx
        .update(projects)
        .set({ ...definedOnly(patch), ...updated(stamp) })
        .where(and(inWorkspace, eq(projects.id, id)))
        .returning();
      return rows[0] ?? null;
    },

    /** Sets `archivedAt`. A project is never deleted. Returns null when it is unknown or already archived. */
    async archive(id: string, stamp: Stamp): Promise<ProjectRow | null> {
      const rows = await executor
        .update(projects)
        .set({ archivedAt: stamp.at ?? new Date(), ...updated(stamp) })
        .where(and(inWorkspace, eq(projects.id, id), isNull(projects.archivedAt)))
        .returning();
      return rows[0] ?? null;
    },
  };
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

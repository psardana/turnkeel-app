import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isAppendOnlyViolation } from '../errors.js';
import { repositories } from '../repositories/index.js';
import { events } from '../schema/index.js';
import { workspaceScope } from '../scope.js';
import {
  createTestDatabase,
  createTestWorkspace,
  testEngines,
  type TestDatabase,
  type TestWorkspace,
} from '../testing/index.js';
import { appendEvent } from './append.js';

describe.each(testEngines)('the event log is append-only, on %s', (engine) => {
  let test: TestDatabase;
  let ws: TestWorkspace;

  beforeAll(async () => {
    test = await createTestDatabase(engine);
    ws = await createTestWorkspace(test.db);
    await test.db.transaction(async (tx) => {
      for (const name of ['One', 'Two', 'Three']) {
        await appendEvent(tx, {
          workspaceId: ws.workspace.id,
          type: 'workspace.updated',
          actor: { kind: 'user', id: ws.owner.id, name: ws.owner.name },
          via: 'web',
          requestId: randomUUID(),
          subject: { type: 'workspace', id: ws.workspace.id },
          data: { name: [null, name] },
        });
      }
    });
  });

  afterAll(async () => {
    await test.destroy();
  });

  async function stored() {
    return test.db
      .select()
      .from(events)
      .where(eq(events.workspaceId, ws.workspace.id))
      .orderBy(events.seq);
  }

  async function expectRejected(run: () => Promise<unknown>, operation: string) {
    const before = await stored();
    let caught: unknown;
    try {
      await run();
    } catch (error) {
      caught = error;
    }
    expect(caught, `${operation} was not rejected`).toBeInstanceOf(Error);
    expect(isAppendOnlyViolation(caught), String(caught)).toBe(true);
    const cause = (caught as Error).cause as Error | undefined;
    expect(`${(caught as Error).message} ${cause?.message ?? ''}`).toContain(
      `The event log is append-only: ${operation} on "events" is not allowed.`,
    );
    expect(await stored()).toEqual(before);
  }

  it('accepts an INSERT', async () => {
    expect((await stored()).map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it('rejects an UPDATE of one event', async () => {
    await expectRejected(
      () => test.db.update(events).set({ actorName: 'Someone Else' }).where(eq(events.seq, 1)),
      'UPDATE',
    );
  });

  it('rejects an UPDATE of every event', async () => {
    await expectRejected(
      () => test.db.execute(sql`update events set data = '{}'::jsonb`),
      'UPDATE',
    );
  });

  it('rejects a DELETE of one event', async () => {
    await expectRejected(() => test.db.delete(events).where(eq(events.seq, 2)), 'DELETE');
  });

  it('rejects a DELETE of every event', async () => {
    await expectRejected(() => test.db.execute(sql`delete from events`), 'DELETE');
  });

  it('rejects TRUNCATE', async () => {
    await expectRejected(() => test.db.execute(sql`truncate table events`), 'TRUNCATE');
  });

  it('rejects TRUNCATE that reaches the log through CASCADE', async () => {
    await expectRejected(() => test.db.execute(sql`truncate table workspaces cascade`), 'TRUNCATE');
  });

  it('rejects a change inside a transaction, and the transaction rolls back', async () => {
    await expectRejected(
      () =>
        test.db.transaction(async (tx) => {
          await tx.delete(events).where(eq(events.workspaceId, ws.workspace.id));
        }),
      'DELETE',
    );
  });

  it('deleting the workspace is a soft delete and removes no event', async () => {
    const other = await createTestWorkspace(test.db);
    const scope = workspaceScope(other.workspace.id);
    await test.db.transaction(async (tx) => {
      const repos = repositories(tx, scope);
      await repos.events.append({
        type: 'workspace.created',
        actor: { kind: 'user', id: other.owner.id, name: other.owner.name },
        via: 'web',
        requestId: randomUUID(),
        subject: { type: 'workspace', id: other.workspace.id },
        data: { name: other.workspace.name },
      });
    });
    await test.db.transaction(async (tx) => {
      const repos = repositories(tx, scope);
      const deleted = await repos.workspace.markDeleted({ by: other.by });
      expect(deleted?.deletedAt).toBeInstanceOf(Date);
      await repos.events.append({
        type: 'workspace.deleted',
        actor: { kind: 'user', id: other.owner.id, name: other.owner.name },
        via: 'web',
        requestId: randomUUID(),
        subject: { type: 'workspace', id: other.workspace.id },
      });
    });
    const kept = await repositories(test.db, scope).events.listAfter(0, 10);
    expect(kept.map((event) => event.type)).toEqual(['workspace.created', 'workspace.deleted']);
    expect((await repositories(test.db, scope).workspace.get())?.deletedAt).toBeInstanceOf(Date);
  });
});

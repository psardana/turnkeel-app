import { findIdempotencyRecord, queryRows, saveIdempotencyRecord, schema } from '@turnkeel/db';
import { testEngines, waitFor } from '@turnkeel/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPLAYED_HEADER } from '../http/idempotency.js';
import { createTestServer, type Session, type TestServer } from '../testing/harness.js';
import { REMOVE_EXPIRED_IDEMPOTENCY_RECORDS } from './definitions.js';

/**
 * The job runner as the server starts it: on the same database as everything else, in
 * both modes. In local mode that is the one PGlite instance.
 */
describe.each(testEngines)('the jobs of the server on %s', (engine) => {
  describe.each(['local', 'server'] as const)('in %s mode', (mode) => {
    let t: TestServer;
    let owner: Session;
    let workspace: string;

    beforeAll(async () => {
      t = await createTestServer(engine, { mode, runtime: { jobs: true } });
      if (mode === 'local') {
        owner = await t.localSession();
        workspace = 'my-workspace';
      } else {
        owner = await t.signIn('olive@example.com', 'Olive Owner');
        await t.post('/api/v1/workspaces', { name: 'Acme', slug: 'acme', handle: 'olive' }, owner);
        workspace = 'acme';
      }
    }, 120_000);
    afterAll(async () => {
      await t.stop();
    }, 60_000);

    it('starts the job runner and puts the job on its schedule', async () => {
      expect(t.runtime.jobs).not.toBeNull();
      const schedules = await queryRows(
        t.test.db,
        sql`select name, cron from pgboss.schedule where name = ${REMOVE_EXPIRED_IDEMPOTENCY_RECORDS}`,
      );
      expect(schedules).toEqual([{ name: REMOVE_EXPIRED_IDEMPOTENCY_RECORDS, cron: '17 * * * *' }]);
    });

    it('removes the idempotency records that have expired, and keeps the others', async () => {
      const project = { name: 'Keyed', key: 'KEY', slug: 'keyed' };
      const headers = { 'Idempotency-Key': 'fresh' };
      const path = `/api/v1/workspaces/${workspace}/projects`;
      expect((await t.post(path, project, owner, headers)).status).toBe(201);

      // A record whose 24 hours are over.
      const [fresh] = await t.test.db.select().from(schema.idempotencyRecords);
      if (!fresh) throw new Error('The keyed request kept no record.');
      const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const principal = { kind: fresh.principalKind, id: fresh.principalId };
      await saveIdempotencyRecord(
        t.test.db,
        {
          principal,
          scope: fresh.scope,
          key: 'old',
          workspaceId: fresh.workspaceId,
          requestHash: fresh.requestHash,
          response: { status: 201, body: {} },
        },
        longAgo,
      );
      expect(await t.test.db.select().from(schema.idempotencyRecords)).toHaveLength(2);

      await t.runtime.jobs?.enqueue(REMOVE_EXPIRED_IDEMPOTENCY_RECORDS, {});
      let left = 2;
      await waitFor(
        () => {
          void t.test.db
            .select()
            .from(schema.idempotencyRecords)
            .then((rows) => {
              left = rows.length;
            });
          return left === 1;
        },
        { timeoutMs: 20_000, what: 'the job to remove the expired record' },
      );

      expect(
        await findIdempotencyRecord(t.test.db, { principal, scope: fresh.scope, key: 'fresh' }),
      ).not.toBeNull();
      expect(t.log).toContain('Removed 1 expired idempotency record.');
      // The record that is left still answers a repeat.
      const repeat = await t.post(path, project, owner, headers);
      expect(repeat.status).toBe(201);
      expect(repeat.headers.get(REPLAYED_HEADER)).toBe('true');
    }, 60_000);
  });
});

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows } from './database.js';
import {
  MIGRATION_LOCK_KEY,
  appliedMigrations,
  defaultMigrationsFolder,
  runMigrations,
} from './migrate.js';
import {
  createTestDatabase,
  postgresTestUrl,
  sleep,
  testEngines,
  type TestDatabase,
} from './testing/index.js';

const migrationFiles = readdirSync(defaultMigrationsFolder)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const expectedTables = [
  'account',
  'agent_sessions',
  'agent_tokens',
  'agents',
  'asset_decisions',
  'asset_groups',
  'asset_notes',
  'asset_variants',
  'assets',
  'assistant_calls',
  'assistant_install_usage',
  'assistant_settings',
  'builds',
  'card_counters',
  'cards',
  'changes',
  'checklist_items',
  'connector_installs',
  'cost_lines',
  'currency_rates',
  'decisions',
  'docs',
  'epics',
  'event_counters',
  'events',
  'feature_seen',
  'features',
  'files',
  'gate_evidence',
  'gate_file_changes',
  'gate_files',
  'gates',
  'idempotency_records',
  'inbox_items',
  'invitations',
  'labels',
  'link_groups',
  'links',
  'listing_rows',
  'listings',
  'members',
  'milestones',
  'model_rates',
  'parties',
  'passkey',
  'person_views',
  'post_suggestions_hidden',
  'posts',
  'price_plans',
  'project_members',
  'projects',
  'recurrence_rules',
  'releases',
  'review_seen',
  'routine_runs',
  'routines',
  'saved_views',
  'scenarios',
  'session',
  'signals',
  'spends',
  'status_lines',
  'step_marks',
  'step_notes',
  'step_replies',
  'steps',
  'time_entries',
  'user',
  'verification',
  'workspaces',
];

async function publicTables(test: TestDatabase): Promise<string[]> {
  const rows = await queryRows<{ name: string }>(
    test.db,
    sql`select table_name::text as name from information_schema.tables where table_schema = 'public' order by table_name`,
  );
  return rows.map((row) => row.name);
}

describe('the migration files', () => {
  it('are every migration, in the order they run', () => {
    expect(migrationFiles).toEqual([
      '0000_init.sql',
      '0001_events_append_only.sql',
      '0002_agents_and_tokens.sql',
      '0003_idempotency_by_token.sql',
      '0004_agent_token_backstops.sql',
      '0005_cards_and_status_lines.sql',
      '0006_status_lines_append_only.sql',
      '0007_sessions_files_builds_gates_assets_decisions.sql',
      '0008_gate_evidence_append_only.sql',
      '0009_asset_hashes_and_session_limits.sql',
      '0010_assistant.sql',
      '0011_assistant_call_text.sql',
      '0012_listings_and_connector_installs.sql',
      '0013_manual_installs.sql',
      '0014_tenancy_keys_and_file_index.sql',
      '0015_planning.sql',
      '0016_planning_keys_and_checks.sql',
      '0017_posts_and_review_seen.sql',
      '0018_posts_keys_and_checks.sql',
      '0019_releases_changes_inbox.sql',
      '0020_releases_review.sql',
      '0021_money.sql',
      '0022_docs_and_links.sql',
      '0023_onboarding_and_tabs.sql',
      '0024_events_by_type.sql',
      '0025_decisions_decide.sql',
      '0026_opt_in_scopes_2.sql',
      '0027_opt_in_review.sql',
      '0028_money_month.sql',
      '0029_planning_at_start.sql',
      '0030_project_ships_to.sql',
      '0031_six_tabs.sql',
      '0032_receipt_suggestions.sql',
      '0033_routines.sql',
      '0034_gate_file_changes.sql',
      '0035_post_results.sql',
      '0036_release_components.sql',
      '0037_scenarios_by_people.sql',
      '0038_routine_schedules.sql',
      '0039_marketing_posts.sql',
      '0040_post_waits_and_reasons.sql',
      '0041_social_connectors.sql',
      '0042_agent_social_figures.sql',
      '0043_epics.sql',
      '0044_token_presets.sql',
    ]);
  });

  it('are all in the journal, in order', () => {
    const journal = JSON.parse(
      readFileSync(path.join(defaultMigrationsFolder, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { tag: string; when: number }[] };
    expect(journal.entries.map((entry) => `${entry.tag}.sql`)).toEqual(migrationFiles);
    const times = journal.entries.map((entry) => entry.when);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('contain no CREATE EXTENSION, which PGlite could not run', () => {
    for (const file of migrationFiles) {
      const text = readFileSync(path.join(defaultMigrationsFolder, file), 'utf8');
      expect(text, file).not.toMatch(/create\s+extension/i);
    }
  });
});

describe.each(testEngines)('migrations on %s', (engine) => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase(engine, { migrate: false });
  });

  afterAll(async () => {
    await test.destroy();
  });

  it('start from an empty database', async () => {
    expect(await publicTables(test)).toEqual([]);
  });

  it('apply and create every table', async () => {
    await runMigrations(test.handle);
    expect(await publicTables(test)).toEqual(expectedTables);
    expect(await appliedMigrations(test.db)).toHaveLength(migrationFiles.length);
  });

  it('create the append-only triggers on the status lines of cards', async () => {
    const rows = await queryRows<{ name: string }>(
      test.db,
      sql`select tgname::text as name from pg_trigger where tgrelid = 'status_lines'::regclass and not tgisinternal order by tgname`,
    );
    expect(rows.map((row) => row.name)).toEqual([
      'status_lines_reject_truncate',
      'status_lines_reject_update_delete',
    ]);
  });

  it('create the append-only triggers on the event log', async () => {
    const rows = await queryRows<{ name: string }>(
      test.db,
      sql`select tgname::text as name from pg_trigger where tgrelid = 'events'::regclass and not tgisinternal order by tgname`,
    );
    expect(rows.map((row) => row.name)).toEqual([
      'events_reject_truncate',
      'events_reject_update_delete',
    ]);
  });

  it('make uniqueness without regard to case through indexes on lower(...)', async () => {
    const rows = await queryRows<{ name: string; definition: string }>(
      test.db,
      sql`select indexname::text as name, indexdef::text as definition from pg_indexes where schemaname = 'public' and indexdef ilike '%lower(%' order by indexname`,
    );
    expect(rows.map((row) => row.name)).toEqual([
      'agents_workspace_name_lower_key',
      'asset_groups_project_key_lower_key',
      'asset_variants_asset_locale_lower_key',
      'assets_project_key_lower_key',
      'builds_project_key_lower_key',
      'connector_installs_project_name_key',
      'connector_installs_workspace_name_key',
      'epics_project_name_lower_key',
      'features_build_key_lower_key',
      'gates_project_key_lower_key',
      'invitations_email_lower_idx',
      'invitations_open_key',
      'invitations_workspace_email_lower_idx',
      'labels_project_name_lower_key',
      'listing_rows_listing_key_lower_key',
      'listings_project_key_lower_key',
      'members_workspace_handle_lower_key',
      'milestones_project_name_lower_key',
      'parties_workspace_name_lower_key',
      'price_plans_project_name_key',
      'projects_workspace_key_lower_key',
      'projects_workspace_slug_lower_key',
      'releases_project_version_key',
      'saved_views_owner_name_lower_key',
      'scenarios_project_name_key',
      'steps_feature_key_lower_key',
      'user_email_lower_key',
      'workspaces_slug_lower_key',
    ]);
    const extensions = await queryRows<{ name: string }>(
      test.db,
      sql`select extname::text as name from pg_extension where extname <> 'plpgsql'`,
    );
    expect(extensions).toEqual([]);
  });

  it('do nothing when run a second time', async () => {
    const before = await appliedMigrations(test.db);
    await runMigrations(test.handle);
    await runMigrations(test.handle);
    expect(await appliedMigrations(test.db)).toEqual(before);
  });
});

function runChild(url: string): Promise<{ code: number | null; output: string }> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        path.join(here, 'testing', 'ts-resolve.mjs'),
        path.join(here, 'testing', 'migrate-child.ts'),
      ],
      {
        env: { ...process.env, TURNKEEL_CHILD_DATABASE_URL: url, NODE_NO_WARNINGS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

/** A TCP relay in front of the database, whose connections the test can cut. */
async function startRelay(target: URL) {
  const sockets = new Set<Socket>();
  const server = createServer((incoming) => {
    const outgoing = connect(Number(target.port), target.hostname);
    for (const socket of [incoming, outgoing]) {
      sockets.add(socket);
      socket.on('error', () => {});
    }
    incoming.pipe(outgoing);
    outgoing.pipe(incoming);
    incoming.on('close', () => outgoing.destroy());
    outgoing.on('close', () => incoming.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = new URL(target.toString());
  url.hostname = '127.0.0.1';
  url.port = String((server.address() as AddressInfo).port);
  return {
    url: url.toString(),
    cut() {
      for (const socket of sockets) socket.destroy();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

describe.skipIf(!postgresTestUrl)('migrating at the same time, on Postgres', () => {
  it('two processes that start together both succeed, and each migration is applied once', async () => {
    const test = await createTestDatabase('postgres', { migrate: false });
    try {
      const [first, second] = await Promise.all([runChild(test.url!), runChild(test.url!)]);
      expect(first, first.output).toMatchObject({ code: 0 });
      expect(second, second.output).toMatchObject({ code: 0 });
      expect(first.output).toContain('migrated');
      expect(second.output).toContain('migrated');

      expect(await publicTables(test)).toEqual(expectedTables);
      const applied = await appliedMigrations(test.db);
      expect(applied).toHaveLength(migrationFiles.length);
      expect(new Set(applied.map((migration) => migration.hash)).size).toBe(migrationFiles.length);
    } finally {
      await test.destroy();
    }
  }, 60_000);

  it('five runs at once in one process do the same', async () => {
    const test = await createTestDatabase('postgres', { migrate: false });
    try {
      await Promise.all(Array.from({ length: 5 }, () => runMigrations(test.handle)));
      expect(await publicTables(test)).toEqual(expectedTables);
      expect(await appliedMigrations(test.db)).toHaveLength(migrationFiles.length);
    } finally {
      await test.destroy();
    }
  }, 60_000);

  it('waits while another session holds the migration lock', async () => {
    const test = await createTestDatabase('postgres', { migrate: false });
    const holder = new pg.Client({ connectionString: test.url });
    await holder.connect();
    try {
      await holder.query('select pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
      let done = false;
      const run = runMigrations(test.handle).then(() => {
        done = true;
      });
      await sleep(400);
      expect(done).toBe(false);
      expect(await publicTables(test)).toEqual([]);

      await holder.query('select pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]);
      await run;
      expect(done).toBe(true);
      expect(await publicTables(test)).toEqual(expectedTables);
    } finally {
      await holder.end();
      await test.destroy();
    }
  }, 60_000);

  it('fails, without an uncaught error, when its connection is cut while it waits for the lock', async () => {
    const test = await createTestDatabase('postgres', { migrate: false });
    const holder = new pg.Client({ connectionString: test.url });
    await holder.connect();
    // The migrating connection goes through a relay, so the test can cut it the way a
    // network does: without the server's goodbye.
    const relay = await startRelay(new URL(test.url!));
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on('uncaughtException', onUncaught);
    try {
      await holder.query('select pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
      if (test.handle.engine !== 'postgres') throw new Error('not Postgres');
      const run = runMigrations({ ...test.handle, directUrl: relay.url });
      run.catch(() => {});
      let waiting = 0;
      for (let attempt = 0; attempt < 100 && waiting === 0; attempt += 1) {
        await sleep(50);
        const result = await holder.query(
          `select 1 from pg_stat_activity
           where application_name = 'turnkeel-migrations' and datname = current_database()
             and wait_event_type = 'Lock'`,
        );
        waiting = result.rowCount ?? 0;
      }
      expect(waiting).toBe(1);

      relay.cut();
      await expect(run).rejects.toThrow();
      await sleep(50);
      expect(uncaught).toEqual([]);
      expect(await publicTables(test)).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
      await relay.close();
      await holder.end();
      await test.destroy();
    }
  }, 60_000);
});

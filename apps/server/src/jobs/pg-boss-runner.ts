import type { DatabaseHandle } from '@turnkeel/db';
import { PgBoss, fromPglite, type ConstructorOptions } from 'pg-boss';
import type { EnqueueOptions, Job, JobHandler, JobRunner } from './runner.js';

export interface JobRunnerOptions {
  /** Hears what the runner cannot handle itself, such as a lost connection. */
  onError?: ((error: unknown) => void) | undefined;
  /** How often an idle worker looks for a job, in seconds. At least 0.5. pg-boss looks every 2 seconds unless told otherwise. */
  pollingIntervalSeconds?: number | undefined;
  /** How often the schedules are checked, in seconds, from 1 to 45. pg-boss checks every 30 seconds unless told otherwise. */
  scheduleIntervalSeconds?: number | undefined;
  /** The database schema the runner keeps its tables in. */
  schema?: string | undefined;
}

/**
 * The job runner: pg-boss, on the database the server already has.
 *
 * - On Postgres pg-boss opens a small pool of its own from `DATABASE_URL`.
 * - On PGlite it runs on the same instance as Drizzle and the event listener, through
 *   pg-boss's PGlite backend (`fromPglite`, `backend: 'pglite'`). That instance has one
 *   connection, so every kind of job has one worker that takes one job at a time.
 *
 * pg-boss keeps its tables in a schema of its own (`pgboss`) and creates and migrates
 * them itself at start; they are not part of Turnkeel's migrations. Its OpenTelemetry
 * hooks are switched off.
 */
export function createJobRunner(handle: DatabaseHandle, options: JobRunnerOptions = {}): JobRunner {
  const shared: ConstructorOptions = {
    openTelemetry: { enabled: false },
    ...(options.schema === undefined ? {} : { schema: options.schema }),
    ...(options.scheduleIntervalSeconds === undefined
      ? {}
      : {
          cronMonitorIntervalSeconds: options.scheduleIntervalSeconds,
          cronWorkerIntervalSeconds: options.scheduleIntervalSeconds,
        }),
  };
  const boss =
    handle.engine === 'pglite'
      ? new PgBoss({ ...shared, backend: 'pglite', db: fromPglite(handle.pglite) })
      : new PgBoss({
          ...shared,
          connectionString: handle.url,
          application_name: 'turnkeel-jobs',
          max: 4,
        });

  // Without a listener Node treats an "error" event as an uncaught exception.
  boss.on('error', (error) => options.onError?.(error));

  let started = false;

  return {
    async start() {
      if (started) return;
      await boss.start();
      started = true;
    },

    async stop() {
      if (!started) return;
      started = false;
      await boss.stop({ graceful: true, timeout: 10_000 });
    },

    async define<Data extends object>(name: string, handler: JobHandler<Data>) {
      await boss.createQueue(name);
      await boss.work<Data>(
        name,
        {
          // One worker that takes one job at a time: all that PGlite's single
          // connection allows, and enough for the jobs Turnkeel has.
          localConcurrency: 1,
          batchSize: 1,
          ...(options.pollingIntervalSeconds === undefined
            ? {}
            : { pollingIntervalSeconds: options.pollingIntervalSeconds }),
        },
        async (jobs) => {
          for (const job of jobs) {
            const forHandler: Job<Data> = {
              id: job.id,
              name: job.name,
              data: job.data,
              signal: job.signal,
            };
            await handler(forHandler);
          }
        },
      );
    },

    async enqueue<Data extends object>(name: string, data: Data, enqueueOptions?: EnqueueOptions) {
      const id = await boss.send(
        name,
        data,
        enqueueOptions?.startAfter ? { startAfter: enqueueOptions.startAfter } : {},
      );
      if (id === null) throw new Error(`The job ${name} could not be queued.`);
      return id;
    },

    async schedule(name: string, cron: string, data?: object) {
      await boss.schedule(name, cron, data ?? null, { tz: 'UTC' });
    },

    async unschedule(name: string) {
      await boss.unschedule(name);
    },
  };
}

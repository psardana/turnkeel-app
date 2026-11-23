import { deleteExpiredIdempotencyRecords, type Database } from '@turnkeel/db';
import type { Logger } from '../log.js';
import { messages } from '../messages.js';
import type { JobRunner } from './runner.js';

/** Removes the idempotency records that are older than their 24 hours. */
export const REMOVE_EXPIRED_IDEMPOTENCY_RECORDS = 'idempotency.remove-expired';

/** Marks agent sessions stale that have not reported for 10 minutes. */
export const MARK_STALE_SESSIONS = 'sessions.mark-stale';

/** Every hour, at seventeen minutes past. */
const HOURLY = '17 * * * *';

/** Every minute. */
const EVERY_MINUTE = '* * * * *';

/**
 * Says what each kind of job does and puts the scheduled ones on their schedule.
 * Called once at start, in both modes.
 *
 * An idempotency record is kept for 24 hours and then has to go;
 * removing it is not a write of R24, so it appends no event and needs no principal.
 */
export async function defineJobs(
  runner: JobRunner,
  deps: { db: Database; logger: Logger; storage?: FileStorage; connectors?: ConnectorRuntime },
): Promise<void> {
  await runner.define(REMOVE_EXPIRED_IDEMPOTENCY_RECORDS, async () => {
    const removed = await deleteExpiredIdempotencyRecords(deps.db);
    if (removed > 0) deps.logger.info(messages.log.removedIdempotencyRecords(removed));
  });
  await runner.schedule(REMOVE_EXPIRED_IDEMPOTENCY_RECORDS, HOURLY);

  // A session that is working, has no open tool call and has been silent for 10
  // minutes is stale; the job appends session.updated with the system as actor.
  await runner.define(MARK_STALE_SESSIONS, async () => {
    await markStaleSessions(deps.db, deps.logger);
  });
  await runner.schedule(MARK_STALE_SESSIONS, EVERY_MINUTE);

  // A call still running ten minutes after it started was left by a server that
  // stopped; it is closed as interrupted with its assistant.called event. The job reads
  // and writes the database only, and reaches no model host.
  await runner.define(CLOSE_INTERRUPTED_CALLS, async () => {
    await closeInterruptedCalls(deps.db, deps.logger);
  });
  await runner.schedule(CLOSE_INTERRUPTED_CALLS, EVERY_MINUTE);

  // Every five minutes the installs whose schedule is due run: an hourly one an
  // hour after its last run, a daily one a day after. A check's result is stored with the
  // system as principal; a failure stays on the install.
  const { connectors } = deps;
  if (connectors) {
    // The job's signal stops the run that is going when pg-boss gives up on the job or
    // the server stops; the run also stops itself within its own time limit.
    await runner.define(RUN_DUE_CONNECTORS, async (job) => {
      await runDueInstalls(
        deps.db,
        connectors,
        deps.logger,
        new Date(),
        job.signal ? { signal: job.signal } : {},
      );
    });
    await runner.schedule(RUN_DUE_CONNECTORS, EVERY_FIVE_MINUTES);
  }

  // Every minute the approved posts that are due go to the project's outbound
  // webhook, signed; only this job calls a connector's send(). It sends
  // nothing a person did not approve, and never tries again by itself.
  if (connectors) {
    const publish = { db: deps.db, connectors, storage: deps.storage ?? null, logger: deps.logger };
    await runner.define(PUBLISH_POSTS, async (job) => {
      await publishDuePosts(publish, new Date(), job.signal ? { signal: job.signal } : {});
    });
    await runner.schedule(PUBLISH_POSTS, EVERY_MINUTE);
  }

  // Every fifteen minutes each rule that is neither paused nor removed makes its
  // next card when its date has come in the workspace's time zone, once the card it made
  // last is done or archived; never the dates it missed. Nothing in a workspace whose
  // recurring cards are turned off. The job calls no outside service.
  await runner.define(MAKE_RECURRING_CARDS, async () => {
    await makeRecurringCards(deps.db, deps.logger);
  });
  await runner.schedule(MAKE_RECURRING_CARDS, EVERY_FIFTEEN_MINUTES);

  // Routines. Every minute each routine that is neither paused nor removed makes the run
  // of the newest slot that began, or a run per event it follows, and open runs past their
  // time are marked missed. A run waits for its agent; the job runs no agent and calls no
  // outside service and no model.
  await runner.define(RUN_ROUTINES, async () => {
    await runRoutines(deps.db, deps.logger);
  });
  await runner.schedule(RUN_ROUTINES, EVERY_MINUTE);

  const { storage } = deps;
  if (storage) {
    // An upload that never completed had no event, and removing it appends none.
    await runner.define(REMOVE_UNFINISHED_UPLOADS, async () => {
      const removed = await removeUnfinishedUploads(deps.db, storage);
      if (removed > 0) deps.logger.info(messages.log.removedUploads(removed));
    });
    await runner.schedule(REMOVE_UNFINISHED_UPLOADS, HOURLY);
  }
}

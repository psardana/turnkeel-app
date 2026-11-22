/**
 * What the server needs from a job runner. The services and
 * the connector runtime use this interface and never name pg-boss, so the library
 * behind it can change without touching them.
 */
export interface JobRunner {
  /** Starts fetching jobs. On a new database it first creates the runner's own tables. */
  start(): Promise<void>;

  /**
   * Stops fetching, waits for the jobs that are running, and releases what the runner
   * holds. It does not close the database; whoever opened it does.
   */
  stop(): Promise<void>;

  /**
   * Says what a kind of job does. A job whose handler throws is tried again, up to
   * the runner's limit. Define every kind once, at start.
   */
  define<Data extends object = object>(name: string, handler: JobHandler<Data>): Promise<void>;

  /** Queues one job. It runs as soon as a worker is free, or not before `startAfter`. Returns its id. */
  enqueue<Data extends object = object>(
    name: string,
    data: Data,
    options?: EnqueueOptions,
  ): Promise<string>;

  /**
   * Runs a kind of job on a schedule, written as a cron expression in UTC. A kind has
   * one schedule: a second call replaces the first.
   */
  schedule(name: string, cron: string, data?: object): Promise<void>;

  /** Removes the schedule of a kind of job. Jobs that are already queued stay. */
  unschedule(name: string): Promise<void>;
}

/** One job, as its handler gets it. */
export interface Job<Data extends object = object> {
  readonly id: string;
  readonly name: string;
  readonly data: Data;
  /** Aborted when the runner gives up on the job: it expired, or the runner is stopping. */
  readonly signal?: AbortSignal;
}

export type JobHandler<Data extends object = object> = (job: Job<Data>) => Promise<void>;

export interface EnqueueOptions {
  /** The job does not run before this time. */
  startAfter?: Date;
}

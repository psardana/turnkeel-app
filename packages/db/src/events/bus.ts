import type { Event } from '@turnkeel/protocol';
import { and, asc, eq, gt } from 'drizzle-orm';
import pg from 'pg';
import type { Database, DatabaseHandle } from '../database.js';
import { events } from '../schema/index.js';
import { EVENT_CHANNEL, toEvent } from './append.js';

/**
 * How a server process hears about events.
 *
 * The contract, which both implementations keep:
 *
 * - `subscribe(workspaceId, fromSeq, onEvent)` delivers every event of the workspace
 *   whose `seq` is greater than `fromSeq`, in `seq` order, each one once.
 * - Events come from the table, never from a notification. A notification only says
 *   "look again". So on connect, and on every reconnect, the bus reads the events after
 *   the last `seq` it delivered, and a notification that was missed loses nothing.
 * - `subscribe` resolves when the events that were already in the table have been
 *   delivered. Later ones arrive as they commit.
 * - `onEvent` may return a promise; the next event waits for it. When it throws, the
 *   error goes to `onError` and the event counts as delivered.
 */
export interface EventBus {
  subscribe(
    workspaceId: string,
    fromSeq: number,
    onEvent: (event: Event) => void | Promise<void>,
  ): Promise<EventSubscription>;
  /** Stops every subscription and closes the listening connection. */
  close(): Promise<void>;
}

export interface EventSubscription {
  /** Stops deliveries. An event that is being delivered right now still finishes. */
  unsubscribe(): void;
}

export interface EventBusOptions {
  /** Hears about a failed read, a lost connection and an `onEvent` that threw. */
  onError?: ((error: unknown) => void) | undefined;
  /** How many events one read takes from the table. */
  batchSize?: number | undefined;
  /** Postgres only: how long to wait before the first attempt to reconnect. It doubles up to 5 seconds. */
  reconnectDelayMs?: number | undefined;
  /** Postgres only: called when the listening connection is made (`true`) or lost (`false`). */
  onConnectionChange?: ((connected: boolean) => void) | undefined;
  /** Postgres only: the `application_name` of the listening connection. */
  applicationName?: string | undefined;
}

/** What differs between the engines: how to hear `EVENT_CHANNEL`. */
interface Listener {
  /**
   * Starts listening. `onNotification` gets each payload; `onConnect` is called once
   * listening has begun again after a break. Resolves when listening has begun.
   */
  start(onNotification: (payload: string) => void, onConnect: () => void): Promise<void>;
  stop(): Promise<void>;
}

const DEFAULT_BATCH_SIZE = 200;
const RETRY_AFTER_FAILED_READ_MS = 1000;

class Subscription implements EventSubscription {
  private busy = false;
  private current: Promise<void> = Promise.resolve();
  private again = false;
  private closed = false;
  private retry: NodeJS.Timeout | null = null;
  private lastSeq: number;
  private readonly workspaceId: string;
  private readonly onEvent: (event: Event) => void | Promise<void>;
  private readonly load: (workspaceId: string, afterSeq: number) => Promise<Event[]>;
  private readonly batchSize: number;
  private readonly onError: (error: unknown) => void;
  private readonly onClose: (subscription: Subscription) => void;

  constructor(init: {
    workspaceId: string;
    fromSeq: number;
    onEvent: (event: Event) => void | Promise<void>;
    load: (workspaceId: string, afterSeq: number) => Promise<Event[]>;
    batchSize: number;
    onError: (error: unknown) => void;
    onClose: (subscription: Subscription) => void;
  }) {
    this.workspaceId = init.workspaceId;
    this.lastSeq = init.fromSeq;
    this.onEvent = init.onEvent;
    this.load = init.load;
    this.batchSize = init.batchSize;
    this.onError = init.onError;
    this.onClose = init.onClose;
  }

  /** The `seq` of the last event delivered. */
  get delivered(): number {
    return this.lastSeq;
  }

  /**
   * Reads what the table has after the last delivered `seq` and delivers it. Only one
   * read runs at a time; a call that arrives during a read makes it look once more
   * when it is done, so nothing that committed in between is left behind.
   */
  catchUp(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.busy) {
      this.again = true;
      return this.current;
    }
    this.busy = true;
    this.current = this.drain();
    return this.current;
  }

  private async drain(): Promise<void> {
    try {
      do {
        this.again = false;
        for (;;) {
          if (this.closed) return;
          const batch = await this.load(this.workspaceId, this.lastSeq);
          for (const event of batch) {
            if (this.closed) return;
            if (event.seq <= this.lastSeq) continue;
            try {
              await this.onEvent(event);
            } catch (error) {
              this.onError(error);
            }
            this.lastSeq = event.seq;
          }
          if (batch.length < this.batchSize) break;
        }
      } while (this.again);
    } catch (error) {
      // The read failed, for example because the database was away for a moment.
      // Nothing was skipped: the next read starts after the last delivered seq.
      this.onError(error);
      if (!this.closed && this.retry === null) {
        this.retry = setTimeout(() => {
          this.retry = null;
          void this.catchUp();
        }, RETRY_AFTER_FAILED_READ_MS);
        this.retry.unref();
      }
    } finally {
      // Set here, with no await after the loop's last check, so a call to catchUp
      // either lands in that check or starts a new read.
      this.busy = false;
    }
  }

  unsubscribe(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.onClose(this);
  }
}

class TableEventBus implements EventBus {
  private readonly subscriptions = new Map<string, Set<Subscription>>();
  private started: Promise<void> | null = null;
  private closed = false;
  private readonly db: Database;
  private readonly listener: Listener;
  private readonly batchSize: number;
  private readonly onError: (error: unknown) => void;

  constructor(db: Database, listener: Listener, options: EventBusOptions) {
    this.db = db;
    this.listener = listener;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.onError = options.onError ?? (() => {});
  }

  start(): Promise<void> {
    this.started ??= this.listener.start(
      (payload) => this.onNotification(payload),
      () => this.catchUpAll(),
    );
    return this.started;
  }

  async subscribe(
    workspaceId: string,
    fromSeq: number,
    onEvent: (event: Event) => void | Promise<void>,
  ): Promise<EventSubscription> {
    if (this.closed) throw new Error('This event bus is closed.');
    if (!Number.isSafeInteger(fromSeq) || fromSeq < 0) {
      throw new RangeError('fromSeq must be a whole number that is not negative.');
    }
    // Listen first, then read: an event that commits between the two is in the read,
    // or in a notification, or in both, and never in neither.
    await this.start();
    const key = workspaceId.toLowerCase();
    const subscription = new Subscription({
      workspaceId: key,
      fromSeq,
      onEvent,
      load: (id, afterSeq) => this.load(id, afterSeq),
      batchSize: this.batchSize,
      onError: this.onError,
      onClose: (closed) => {
        const set = this.subscriptions.get(key);
        set?.delete(closed);
        if (set?.size === 0) this.subscriptions.delete(key);
      },
    });
    let set = this.subscriptions.get(key);
    if (!set) {
      set = new Set();
      this.subscriptions.set(key, set);
    }
    set.add(subscription);
    await subscription.catchUp();
    return subscription;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const set of [...this.subscriptions.values()]) {
      for (const subscription of [...set]) subscription.unsubscribe();
    }
    if (this.started) {
      await this.started.catch(() => {});
      await this.listener.stop();
    }
  }

  private async load(workspaceId: string, afterSeq: number): Promise<Event[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(and(eq(events.workspaceId, workspaceId), gt(events.seq, afterSeq)))
      .orderBy(asc(events.seq))
      .limit(this.batchSize);
    return rows.map(toEvent);
  }

  /** A payload is `<workspace id>:<seq>`. Anything else is ignored. */
  private onNotification(payload: string): void {
    const separator = payload.lastIndexOf(':');
    if (separator <= 0) return;
    const workspaceId = payload.slice(0, separator).toLowerCase();
    const seq = Number(payload.slice(separator + 1));
    if (!Number.isSafeInteger(seq)) return;
    for (const subscription of this.subscriptions.get(workspaceId) ?? []) {
      if (seq > subscription.delivered) void subscription.catchUp();
    }
  }

  private catchUpAll(): void {
    for (const set of this.subscriptions.values()) {
      for (const subscription of set) void subscription.catchUp();
    }
  }
}

/**
 * Postgres: one dedicated, long-lived connection that runs LISTEN, made from the
 * direct URL because LISTEN does not survive a transaction-mode pooler. When the
 * connection is lost it is made again, and every subscription then reads the table.
 */
class PostgresListener implements Listener {
  private client: pg.Client | null = null;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private delay: number;
  private onNotification: (payload: string) => void = () => {};
  private onConnect: () => void = () => {};
  private readonly connectionString: string;
  private readonly options: EventBusOptions;

  constructor(connectionString: string, options: EventBusOptions) {
    this.connectionString = connectionString;
    this.options = options;
    this.delay = this.firstDelay;
  }

  private get firstDelay(): number {
    return this.options.reconnectDelayMs ?? 250;
  }

  async start(onNotification: (payload: string) => void, onConnect: () => void): Promise<void> {
    this.onNotification = onNotification;
    this.onConnect = onConnect;
    // The first connection is awaited, so a database that cannot be reached is an
    // error at start and not a silent wait.
    await this.connect();
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({
      connectionString: this.connectionString,
      keepAlive: true,
      application_name: this.options.applicationName ?? 'turnkeel-events',
    });
    let lost = false;
    const onLost = (error?: Error) => {
      if (lost) return;
      lost = true;
      if (this.client === client) this.client = null;
      client.removeAllListeners('notification');
      if (this.stopped) return;
      if (error) this.options.onError?.(error);
      this.options.onConnectionChange?.(false);
      this.scheduleReconnect();
    };
    client.on('error', onLost);
    client.on('end', () => onLost());
    client.on('notification', (message) => {
      if (message.channel === EVENT_CHANNEL && message.payload !== undefined) {
        this.onNotification(message.payload);
      }
    });

    try {
      await client.connect();
      await client.query(`listen ${EVENT_CHANNEL}`);
    } catch (error) {
      lost = true;
      client.removeAllListeners();
      client.on('error', () => {});
      await client.end().catch(() => {});
      throw error;
    }
    if (this.stopped) {
      lost = true;
      await client.end().catch(() => {});
      return;
    }
    this.client = client;
    this.delay = this.firstDelay;
    this.options.onConnectionChange?.(true);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer) return;
    const wait = this.delay;
    this.delay = Math.min(this.delay * 2, 5000);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect().then(
        // Listening again: read what was missed while away.
        () => {
          if (!this.stopped) this.onConnect();
        },
        (error: unknown) => {
          this.options.onError?.(error);
          this.scheduleReconnect();
        },
      );
    }, wait);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => {});
  }
}

/** PGlite: the instance's own `listen`. There is no connection to lose. */
class PgliteListener implements Listener {
  private unlisten: (() => Promise<void>) | null = null;
  private readonly pglite: Extract<DatabaseHandle, { engine: 'pglite' }>['pglite'];

  constructor(pglite: Extract<DatabaseHandle, { engine: 'pglite' }>['pglite']) {
    this.pglite = pglite;
  }

  async start(onNotification: (payload: string) => void): Promise<void> {
    this.unlisten = await this.pglite.listen(EVENT_CHANNEL, onNotification);
  }

  async stop(): Promise<void> {
    const unlisten = this.unlisten;
    this.unlisten = null;
    if (unlisten && !this.pglite.closed) await unlisten();
  }
}

/**
 * Makes the event bus for a database and starts listening. One per server process.
 * It rejects when the listening connection cannot be made.
 */
export async function createEventBus(
  handle: DatabaseHandle,
  options: EventBusOptions = {},
): Promise<EventBus> {
  const listener =
    handle.engine === 'postgres'
      ? new PostgresListener(handle.directUrl, options)
      : new PgliteListener(handle.pglite);
  const bus = new TableEventBus(handle.db, listener, options);
  await bus.start();
  return bus;
}

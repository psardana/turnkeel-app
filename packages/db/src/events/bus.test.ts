import { randomUUID } from 'node:crypto';
import type { Event } from '@turnkeel/protocol';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestWorkspace,
  deferred,
  postgresTestUrl,
  sleep,
  testEngines,
  waitFor,
  type TestDatabase,
  type TestWorkspace,
} from '../testing/index.js';
import { appendEvent } from './append.js';
import { createEventBus, type EventBus } from './bus.js';

async function append(test: TestDatabase, ws: TestWorkspace, count = 1): Promise<Event[]> {
  return test.db.transaction(async (tx) => {
    const appended: Event[] = [];
    for (let index = 0; index < count; index += 1) {
      appended.push(
        await appendEvent(tx, {
          workspaceId: ws.workspace.id,
          type: 'workspace.updated',
          actor: { kind: 'user', id: ws.owner.id, name: ws.owner.name },
          via: 'web',
          requestId: randomUUID(),
          subject: { type: 'workspace', id: ws.workspace.id },
          data: { name: [null, `Name ${index}`] },
        }),
      );
    }
    return appended;
  });
}

const seqsOf = (events: Event[]) => events.map((event) => event.seq);

describe.each(testEngines)('the event bus on %s', (engine) => {
  let test: TestDatabase;
  let bus: EventBus;
  const errors: unknown[] = [];

  beforeAll(async () => {
    test = await createTestDatabase(engine);
    bus = await createEventBus(test.handle, { onError: (error) => errors.push(error) });
  });

  afterAll(async () => {
    await bus.close();
    await test.destroy();
  });

  it('delivers an event when it commits', async () => {
    const ws = await createTestWorkspace(test.db);
    const received: Event[] = [];
    const subscription = await bus.subscribe(ws.workspace.id, 0, (event) => {
      received.push(event);
    });
    expect(received).toEqual([]);

    const [first] = await append(test, ws);
    await waitFor(() => received.length === 1, { what: 'the first live event' });
    expect(received[0]).toEqual(first);

    await append(test, ws, 3);
    await waitFor(() => received.length === 4, { what: 'three more live events' });
    expect(seqsOf(received)).toEqual([1, 2, 3, 4]);
    subscription.unsubscribe();
  });

  it('replays what the table already has, before subscribe resolves', async () => {
    const ws = await createTestWorkspace(test.db);
    const appended = await append(test, ws, 5);
    const received: Event[] = [];
    const subscription = await bus.subscribe(ws.workspace.id, 0, (event) => {
      received.push(event);
    });
    expect(received).toEqual(appended);
    subscription.unsubscribe();
  });

  it('replays only the events after fromSeq, as a client that resumes needs', async () => {
    const ws = await createTestWorkspace(test.db);
    await append(test, ws, 5);
    const received: Event[] = [];
    const subscription = await bus.subscribe(ws.workspace.id, 3, (event) => {
      received.push(event);
    });
    expect(seqsOf(received)).toEqual([4, 5]);

    await append(test, ws, 2);
    await waitFor(() => received.length === 4, { what: 'the live events after a replay' });
    expect(seqsOf(received)).toEqual([4, 5, 6, 7]);
    subscription.unsubscribe();
  });

  it('replays in batches when more is missing than one read takes', async () => {
    const ws = await createTestWorkspace(test.db);
    await append(test, ws, 25);
    const small = await createEventBus(test.handle, { batchSize: 10 });
    try {
      const received: Event[] = [];
      await small.subscribe(ws.workspace.id, 2, (event) => {
        received.push(event);
      });
      expect(seqsOf(received)).toEqual(Array.from({ length: 23 }, (_, index) => index + 3));
    } finally {
      await small.close();
    }
  });

  it('delivers each event once and in seq order, also when the handler is slow', async () => {
    const ws = await createTestWorkspace(test.db);
    await append(test, ws, 3);
    const received: number[] = [];
    let running = 0;
    let overlapped = false;
    const subscription = await bus.subscribe(ws.workspace.id, 0, async (event) => {
      running += 1;
      if (running > 1) overlapped = true;
      await sleep(15);
      received.push(event.seq);
      running -= 1;
    });
    // Appended one transaction at a time, so several notifications arrive while the
    // handler is still busy with an earlier event.
    for (let index = 0; index < 6; index += 1) await append(test, ws);
    await waitFor(() => received.length === 9, { what: 'nine events through a slow handler' });
    await sleep(100);
    expect(received).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(overlapped).toBe(false);
    subscription.unsubscribe();
  });

  it('keeps the events of one workspace from the subscriber of another', async () => {
    const a = await createTestWorkspace(test.db);
    const b = await createTestWorkspace(test.db);
    const forA: Event[] = [];
    const forB: Event[] = [];
    const subA = await bus.subscribe(a.workspace.id, 0, (event) => {
      forA.push(event);
    });
    const subB = await bus.subscribe(b.workspace.id, 0, (event) => {
      forB.push(event);
    });
    await append(test, a, 2);
    await append(test, b, 1);
    await waitFor(() => forA.length === 2 && forB.length === 1, { what: 'both subscribers' });
    await sleep(100);
    expect(forA.every((event) => event.workspaceId === a.workspace.id)).toBe(true);
    expect(forB.every((event) => event.workspaceId === b.workspace.id)).toBe(true);
    expect(seqsOf(forA)).toEqual([1, 2]);
    expect(seqsOf(forB)).toEqual([1]);
    subA.unsubscribe();
    subB.unsubscribe();
  });

  it('gives every subscriber of a workspace every event', async () => {
    const ws = await createTestWorkspace(test.db);
    const one: number[] = [];
    const two: number[] = [];
    const subOne = await bus.subscribe(ws.workspace.id, 0, (event) => {
      one.push(event.seq);
    });
    await append(test, ws, 2);
    const subTwo = await bus.subscribe(ws.workspace.id, 1, (event) => {
      two.push(event.seq);
    });
    await append(test, ws, 1);
    await waitFor(() => one.length === 3 && two.length === 2, { what: 'two subscribers' });
    expect(one).toEqual([1, 2, 3]);
    expect(two).toEqual([2, 3]);
    subOne.unsubscribe();
    subTwo.unsubscribe();
  });

  it('delivers nothing from a transaction that rolls back', async () => {
    const ws = await createTestWorkspace(test.db);
    const received: number[] = [];
    const subscription = await bus.subscribe(ws.workspace.id, 0, (event) => {
      received.push(event.seq);
    });
    await test.db
      .transaction(async (tx) => {
        await appendEvent(tx, {
          workspaceId: ws.workspace.id,
          type: 'workspace.updated',
          actor: { kind: 'user', id: ws.owner.id, name: ws.owner.name },
          via: 'web',
          requestId: randomUUID(),
          subject: { type: 'workspace', id: ws.workspace.id },
        });
        throw new Error('rolled back');
      })
      .catch(() => {});
    await append(test, ws);
    await waitFor(() => received.length === 1, { what: 'the committed event' });
    await sleep(100);
    expect(received).toEqual([1]);
    subscription.unsubscribe();
  });

  it('stops delivering after unsubscribe', async () => {
    const ws = await createTestWorkspace(test.db);
    const received: number[] = [];
    const subscription = await bus.subscribe(ws.workspace.id, 0, (event) => {
      received.push(event.seq);
    });
    await append(test, ws);
    await waitFor(() => received.length === 1, { what: 'the event before unsubscribe' });
    subscription.unsubscribe();
    subscription.unsubscribe();
    await append(test, ws, 2);
    await sleep(200);
    expect(received).toEqual([1]);
  });

  it('reports a handler that throws and goes on with the next event', async () => {
    const ws = await createTestWorkspace(test.db);
    errors.length = 0;
    const received: number[] = [];
    const subscription = await bus.subscribe(ws.workspace.id, 0, (event) => {
      if (event.seq === 2) throw new Error('the handler failed on 2');
      received.push(event.seq);
    });
    await append(test, ws, 3);
    await waitFor(() => received.length === 2, { what: 'the events around the failing one' });
    expect(received).toEqual([1, 3]);
    expect(errors.map((error) => (error as Error).message)).toEqual(['the handler failed on 2']);
    errors.length = 0;
    subscription.unsubscribe();
  });

  it('refuses a fromSeq that is not a whole number from 0 up', async () => {
    const ws = await createTestWorkspace(test.db);
    await expect(bus.subscribe(ws.workspace.id, -1, () => {})).rejects.toBeInstanceOf(RangeError);
    await expect(bus.subscribe(ws.workspace.id, 1.5, () => {})).rejects.toBeInstanceOf(RangeError);
  });

  it('refuses to subscribe after close, and closing twice is fine', async () => {
    const ws = await createTestWorkspace(test.db);
    const other = await createEventBus(test.handle);
    const received: number[] = [];
    await other.subscribe(ws.workspace.id, 0, (event) => {
      received.push(event.seq);
    });
    await other.close();
    await other.close();
    await expect(other.subscribe(ws.workspace.id, 0, () => {})).rejects.toThrow('closed');
    await append(test, ws);
    await sleep(150);
    expect(received).toEqual([]);
  });
});

describe.skipIf(!postgresTestUrl)('the event bus on Postgres, when the connection is lost', () => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase('postgres');
  });

  afterAll(async () => {
    await test.destroy();
  });

  async function terminate(applicationName: string): Promise<number> {
    const admin = new pg.Client({ connectionString: test.url });
    await admin.connect();
    try {
      const result = await admin.query<{ terminated: boolean }>(
        'select pg_terminate_backend(pid) as terminated from pg_stat_activity where application_name = $1',
        [applicationName],
      );
      return result.rowCount ?? 0;
    } finally {
      await admin.end();
    }
  }

  it('reconnects, and replays from the table what was appended while it was away', async () => {
    const ws = await createTestWorkspace(test.db);
    const applicationName = `turnkeel-events-test-${randomUUID().slice(0, 8)}`;
    const changes: boolean[] = [];
    const lost = deferred();
    const back = deferred();
    const errors: unknown[] = [];
    const bus = await createEventBus(test.handle, {
      applicationName,
      // Long enough that the events below are appended while nothing listens.
      reconnectDelayMs: 600,
      onError: (error) => errors.push(error),
      onConnectionChange: (connected) => {
        changes.push(connected);
        if (!connected) lost.resolve();
        if (connected && changes.includes(false)) back.resolve();
      },
    });
    try {
      const received: number[] = [];
      await bus.subscribe(ws.workspace.id, 0, (event) => {
        received.push(event.seq);
      });
      await append(test, ws, 2);
      await waitFor(() => received.length === 2, { what: 'the events before the break' });

      expect(await terminate(applicationName)).toBe(1);
      await lost.promise;

      // Nothing listens now, so these three notifications reach nobody.
      await append(test, ws, 3);
      expect(changes).toEqual([true, false]);
      expect(received).toEqual([1, 2]);

      await back.promise;
      await waitFor(() => received.length === 5, { what: 'the replay after the reconnect' });
      expect(received).toEqual([1, 2, 3, 4, 5]);

      // And it is live again.
      await append(test, ws, 1);
      await waitFor(() => received.length === 6, { what: 'a live event after the reconnect' });
      expect(received).toEqual([1, 2, 3, 4, 5, 6]);
      expect(changes).toEqual([true, false, true]);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      await bus.close();
    }
  }, 30_000);

  it('holds one listening connection, under the application name it was given', async () => {
    const applicationName = `turnkeel-events-test-${randomUUID().slice(0, 8)}`;
    const bus = await createEventBus(test.handle, { applicationName });
    try {
      const admin = new pg.Client({ connectionString: test.url });
      await admin.connect();
      try {
        const result = await admin.query<{ count: number }>(
          'select count(*)::int as count from pg_stat_activity where application_name = $1',
          [applicationName],
        );
        expect(result.rows[0]?.count).toBe(1);
      } finally {
        await admin.end();
      }
    } finally {
      await bus.close();
    }
  });

  // The pool of this handle works; only its direct URL leads nowhere. So this fails
  // only because the listening connection is opened from the direct URL.
  it('opens its listening connection from the direct URL, and rejects at start when that cannot be reached', async () => {
    const unreachable = { ...test.handle, directUrl: 'postgres://nobody:nothing@127.0.0.1:1/none' };
    await expect(createEventBus(unreachable)).rejects.toThrow();
  });
});

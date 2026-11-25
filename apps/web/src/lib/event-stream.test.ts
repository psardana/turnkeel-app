import { describe, expect, it, vi } from 'vitest';
import type { StreamMessage } from '@turnkeel/protocol';
import { testId } from '@/testing/events';
import {
  openEventStream,
  RETRY_FIRST_MS,
  RETRY_MAX_MS,
  streamUrl,
  type EventSourceLike,
  type StreamEnvironment,
  type StreamState,
} from './event-stream';

const BASE = '/api/v1/workspaces/acme/stream';

class FakeSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  readonly url: string;
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  emit(type: string, data = '', lastEventId = ''): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data, lastEventId } as MessageEvent<string>);
    }
  }

  open(): void {
    this.readyState = 1;
    this.emit('open');
  }

  /** The connection dropped and the browser is reconnecting by itself. */
  drop(): void {
    this.readyState = 0;
    this.emit('error');
  }

  /** The server answered with an error, so the browser gave up. */
  refuse(): void {
    this.readyState = 2;
    this.emit('error');
  }
}

function message(seq: number): StreamMessage {
  return {
    seq,
    type: 'project.created',
    subject: { type: 'project', id: testId(20) },
    projectId: testId(20),
    actor: { kind: 'user', id: testId(10) },
    at: '2026-11-11T09:00:00.000Z',
    fields: ['name', 'key'],
  };
}

function setup() {
  const sources: FakeSource[] = [];
  let hidden = false;
  const visibilityListeners = new Set<() => void>();
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 1;

  const env: StreamEnvironment = {
    createSource(url) {
      const source = new FakeSource(url);
      sources.push(source);
      return source;
    },
    isHidden: () => hidden,
    onVisibilityChange(listener) {
      visibilityListeners.add(listener);
      return () => visibilityListeners.delete(listener);
    },
    setTimeout(run, ms) {
      const handle = nextTimer++;
      timers.set(handle, { run, ms });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };

  const onChange = vi.fn<(message: StreamMessage) => void>();
  const onReset = vi.fn<() => void>();
  const onRefused = vi.fn<() => void>();
  const states: StreamState[] = [];

  return {
    env,
    sources,
    timers,
    visibilityListeners,
    onChange,
    onReset,
    onRefused,
    states,
    handlers: { onChange, onReset, onRefused, onState: (state: StreamState) => states.push(state) },
    latest: () => sources.at(-1) as FakeSource,
    live: () => sources.filter((source) => !source.closed),
    setHidden(value: boolean) {
      hidden = value;
      for (const listener of visibilityListeners) listener();
    },
    runTimer() {
      const [handle, timer] = [...timers.entries()][0] ?? [];
      if (handle === undefined || !timer) throw new Error('No timer is waiting.');
      timers.delete(handle);
      timer.run();
      return timer.ms;
    },
  };
}

describe('streamUrl', () => {
  it('names the last seq as ?lastEventId= when there is one', () => {
    expect(streamUrl(BASE, null)).toBe(BASE);
    expect(streamUrl(BASE, 41)).toBe(`${BASE}?lastEventId=41`);
  });
});

describe('openEventStream', () => {
  it('opens one connection and hands each change on, remembering its seq', () => {
    const t = setup();
    const stream = openEventStream(BASE, t.handlers, t.env);
    expect(t.sources).toHaveLength(1);
    expect(t.latest().url).toBe(BASE);
    expect(stream.state()).toBe('connecting');

    t.latest().open();
    expect(stream.state()).toBe('open');

    t.latest().emit('change', JSON.stringify(message(7)), '7');
    t.latest().emit('change', JSON.stringify(message(8)), '8');
    expect(t.onChange).toHaveBeenCalledTimes(2);
    expect(t.onChange.mock.calls[1]?.[0].fields).toEqual(['name', 'key']);
    expect(stream.lastSeq()).toBe(8);
    expect(t.onReset).not.toHaveBeenCalled();
  });

  it('closes the connection while the tab is hidden and resumes after the last seq when it is shown', () => {
    const t = setup();
    const stream = openEventStream(BASE, t.handlers, t.env);
    t.latest().open();
    t.latest().emit('change', JSON.stringify(message(12)), '12');

    t.setHidden(true);
    expect(t.live()).toHaveLength(0);
    expect(stream.state()).toBe('paused');

    t.setHidden(false);
    expect(t.live()).toHaveLength(1);
    expect(t.latest().url).toBe(`${BASE}?lastEventId=12`);
    t.latest().open();
    expect(stream.state()).toBe('open');
    // The server replays what was missed, so nothing has to be read again.
    expect(t.onReset).not.toHaveBeenCalled();
  });

  it('does not connect at all while the tab starts hidden', () => {
    const t = setup();
    t.setHidden(true);
    const stream = openEventStream(BASE, t.handlers, t.env);
    expect(t.sources).toHaveLength(0);
    expect(stream.state()).toBe('paused');
    t.setHidden(false);
    expect(t.sources).toHaveLength(1);
  });

  it('never holds more than one connection', () => {
    const t = setup();
    openEventStream(BASE, t.handlers, t.env);
    t.latest().open();
    t.setHidden(true);
    t.setHidden(false);
    t.setHidden(false);
    t.setHidden(true);
    t.setHidden(false);
    expect(t.live()).toHaveLength(1);
  });

  it('reads everything again when it resumes without a seq to resume from', () => {
    const t = setup();
    openEventStream(BASE, t.handlers, t.env);
    t.latest().open();
    t.setHidden(true);
    t.setHidden(false);
    expect(t.latest().url).toBe(BASE);
    expect(t.onReset).not.toHaveBeenCalled();
    t.latest().open();
    expect(t.onReset).toHaveBeenCalledTimes(1);
  });

  it('handles "reset" by asking for a refetch and going on from the seq it names', () => {
    const t = setup();
    const stream = openEventStream(BASE, t.handlers, t.env);
    t.latest().open();
    t.latest().emit('change', JSON.stringify(message(3)), '3');
    t.latest().emit('reset', JSON.stringify({ seq: 2040 }), '2040');
    expect(t.onReset).toHaveBeenCalledTimes(1);
    expect(stream.lastSeq()).toBe(2040);

    t.setHidden(true);
    t.setHidden(false);
    expect(t.latest().url).toBe(`${BASE}?lastEventId=2040`);
  });

  it('takes the seq of a reset even when it is lower than a stale one', () => {
    const t = setup();
    const stream = openEventStream(BASE, t.handlers, t.env);
    t.latest().open();
    t.latest().emit('change', JSON.stringify(message(900)), '900');
    t.latest().emit('reset', JSON.stringify({ seq: 5 }), '5');
    expect(stream.lastSeq()).toBe(5);
  });

  it('lets the browser reconnect by itself after a dropped connection', () => {
    const t = setup();
    const stream = openEventStream(BASE, t.handlers, t.env);
    t.latest().open();
    t.latest().emit('change', JSON.stringify(message(4)), '4');
    t.latest().drop();
    // The same EventSource reconnects and sends Last-Event-ID itself.
    expect(t.sources).toHaveLength(1);
    expect(t.latest().closed).toBe(false);
    expect(stream.state()).toBe('connecting');
    expect(t.onRefused).not.toHaveBeenCalled();
    t.latest().open();
    expect(stream.state()).toBe('open');
  });

  it('says so when the server refuses the stream, and asks again later with a growing wait', () => {
    const t = setup();
    const stream = openEventStream(BASE, t.handlers, t.env);
    t.latest().open();
    t.latest().emit('change', JSON.stringify(message(4)), '4');

    t.latest().refuse();
    expect(t.onRefused).toHaveBeenCalledTimes(1);
    expect(stream.state()).toBe('waiting');
    expect(t.live()).toHaveLength(0);

    expect(t.runTimer()).toBe(RETRY_FIRST_MS);
    expect(t.latest().url).toBe(`${BASE}?lastEventId=4`);
    t.latest().refuse();
    expect(t.runTimer()).toBe(RETRY_FIRST_MS * 2);
    t.latest().refuse();
    expect(t.runTimer()).toBe(RETRY_FIRST_MS * 4);

    // The wait starts again from the beginning once a connection opened.
    t.latest().open();
    t.latest().refuse();
    expect(t.runTimer()).toBe(RETRY_FIRST_MS);
  });

  it('never waits longer than the longest wait', () => {
    const t = setup();
    openEventStream(BASE, t.handlers, t.env);
    let last = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      t.latest().refuse();
      last = t.runTimer();
    }
    expect(last).toBe(RETRY_MAX_MS);
  });

  it('drops a waiting retry when the tab is hidden, and connects at once when it is shown', () => {
    const t = setup();
    openEventStream(BASE, t.handlers, t.env);
    t.latest().refuse();
    expect(t.timers.size).toBe(1);
    t.setHidden(true);
    expect(t.timers.size).toBe(0);
    t.setHidden(false);
    expect(t.live()).toHaveLength(1);
  });

  it('asks for a refetch when a message cannot be read, and still moves on', () => {
    const t = setup();
    const stream = openEventStream(BASE, t.handlers, t.env);
    t.latest().open();
    // A type a newer server knows and this app does not.
    t.latest().emit('change', JSON.stringify({ ...message(9), type: 'later.kind' }), '9');
    expect(t.onChange).not.toHaveBeenCalled();
    expect(t.onReset).toHaveBeenCalledTimes(1);
    expect(stream.lastSeq()).toBe(9);

    t.latest().emit('change', 'not json', '10');
    expect(t.onReset).toHaveBeenCalledTimes(2);
    expect(stream.lastSeq()).toBe(10);
  });

  it('ignores what an earlier connection still says', () => {
    const t = setup();
    openEventStream(BASE, t.handlers, t.env);
    const first = t.latest();
    first.open();
    t.setHidden(true);
    t.setHidden(false);
    first.emit('change', JSON.stringify(message(5)), '5');
    expect(t.onChange).not.toHaveBeenCalled();
  });

  it('closes for good: no connection, no timer, no listener left', () => {
    const t = setup();
    const stream = openEventStream(BASE, t.handlers, t.env);
    t.latest().refuse();
    stream.close();
    expect(stream.state()).toBe('closed');
    expect(t.live()).toHaveLength(0);
    expect(t.timers.size).toBe(0);
    expect(t.visibilityListeners.size).toBe(0);

    t.setHidden(false);
    expect(t.sources).toHaveLength(1);
    expect(t.states.at(-1)).toBe('closed');
  });
});

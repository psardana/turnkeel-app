import { streamMessageSchema, type StreamMessage } from '@turnkeel/protocol';

/**
 * The live stream of one workspace, as the page holds it.
 *
 * - One connection, closed while the tab is hidden and opened again when it is shown.
 * - A stream the page opens itself carries the last `seq` it saw as `?lastEventId=`,
 *   because a browser sends `Last-Event-ID` only when it reconnects by itself.
 * - `event: reset` means the page is too far behind: it refetches what it shows.
 * - When the server refuses the stream or ends it for good, the page asks again
 *   later, a little longer after each failure.
 */
export type StreamState = 'connecting' | 'open' | 'paused' | 'waiting' | 'closed';

export interface StreamHandlers {
  /** Something changed. The message names the fields and carries no values. */
  onChange(message: StreamMessage): void;
  /** The page is too far behind, or got a message it cannot read: refetch what is shown. */
  onReset(): void;
  /** The server refused the stream. Access may have ended. */
  onRefused?(): void;
  onState?(state: StreamState): void;
}

/** The part of `EventSource` the client uses. */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

/** What the client needs from the page. Tests pass their own. */
export interface StreamEnvironment {
  createSource(url: string): EventSourceLike;
  isHidden(): boolean;
  /** Calls `listener` when the tab is hidden or shown. Returns how to stop. */
  onVisibilityChange(listener: () => void): () => void;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface EventStream {
  /** Closes the connection for good. */
  close(): void;
  state(): StreamState;
  /** The `seq` of the last message that arrived, or null before the first. */
  lastSeq(): number | null;
}

/** `EventSource.CLOSED`: the browser gave up and will not reconnect by itself. */
const CLOSED = 2;

export const RETRY_FIRST_MS = 1_000;
export const RETRY_MAX_MS = 30_000;

export function browserStreamEnvironment(): StreamEnvironment {
  return {
    createSource: (url) => new EventSource(url, { withCredentials: true }),
    isHidden: () => document.visibilityState === 'hidden',
    onVisibilityChange(listener) {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  };
}

/** The stream's address, resuming after `lastSeq` when there is one. */
export function streamUrl(base: string, lastSeq: number | null): string {
  return lastSeq === null ? base : `${base}?lastEventId=${lastSeq}`;
}

const seqOf = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined || !/^\d{1,15}$/.test(value)) return null;
  return Number(value);
};

/**
 * Opens the stream at `base` (`/api/v1/workspaces/<slug>/stream`) and keeps it open
 * while the tab is shown, until `close()`.
 */
export function openEventStream(
  base: string,
  handlers: StreamHandlers,
  env: StreamEnvironment = browserStreamEnvironment(),
): EventStream {
  let source: EventSourceLike | null = null;
  let lastSeq: number | null = null;
  let state: StreamState = 'connecting';
  let retryMs = RETRY_FIRST_MS;
  let retryTimer: unknown = null;
  let ended = false;
  let opened = false;

  const setState = (next: StreamState) => {
    if (state === next) return;
    state = next;
    handlers.onState?.(next);
  };

  const drop = () => {
    source?.close();
    source = null;
    if (retryTimer !== null) {
      env.clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const remember = (seq: number | null) => {
    if (seq !== null && (lastSeq === null || seq > lastSeq)) lastSeq = seq;
  };

  const connect = () => {
    if (ended) return;
    drop();
    if (env.isHidden()) {
      setState('paused');
      return;
    }
    setState('connecting');
    const current = env.createSource(streamUrl(base, lastSeq));
    source = current;
    const mine = () => source === current && !ended;

    current.addEventListener('open', () => {
      if (!mine()) return;
      retryMs = RETRY_FIRST_MS;
      setState('open');
      // A stream that is opened again without a `seq` to resume from starts at the
      // newest event, so whatever happened in between is read again.
      if (opened && lastSeq === null) handlers.onReset();
      opened = true;
    });

    current.addEventListener('change', (event) => {
      if (!mine()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        parsed = undefined;
      }
      const message = streamMessageSchema.safeParse(parsed);
      if (message.success) {
        remember(message.data.seq);
        handlers.onChange(message.data);
      } else {
        // A message this version of the app cannot read, such as a type a newer
        // server added. Something changed, so what is shown is read again.
        remember(seqOf(event.lastEventId));
        handlers.onReset();
      }
    });

    current.addEventListener('reset', (event) => {
      if (!mine()) return;
      let seq = seqOf(event.lastEventId);
      try {
        const data = JSON.parse(event.data) as { seq?: unknown };
        if (typeof data.seq === 'number') seq = data.seq;
      } catch {
        // The id of the message says the same.
      }
      // After a reset the stream goes on from the newest event, which may be
      // lower than what a stale id claimed.
      lastSeq = seq;
      handlers.onReset();
    });

    current.addEventListener('error', () => {
      if (!mine()) return;
      if (current.readyState !== CLOSED) {
        // The browser reconnects by itself and sends Last-Event-ID.
        setState('connecting');
        return;
      }
      // The server answered with an error, or the browser gave up.
      drop();
      setState('waiting');
      handlers.onRefused?.();
      const wait = retryMs;
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
      retryTimer = env.setTimeout(() => {
        retryTimer = null;
        connect();
      }, wait);
    });
  };

  const stopWatching = env.onVisibilityChange(() => {
    if (ended) return;
    if (env.isHidden()) {
      drop();
      setState('paused');
    } else if (source === null) {
      retryMs = RETRY_FIRST_MS;
      connect();
    }
  });

  connect();

  return {
    close() {
      if (ended) return;
      ended = true;
      stopWatching();
      drop();
      setState('closed');
    },
    state: () => state,
    lastSeq: () => lastSeq,
  };
}

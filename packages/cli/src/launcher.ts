import { fork, type ChildProcess } from 'node:child_process';
import { messages } from './messages.js';

/** Where the command writes. The bin passes the console; tests pass arrays. */
export interface Output {
  out: (line: string) => void;
  err: (line: string) => void;
}

/**
 * What the server says over the channel when it listens, and again each time it is
 * asked for another one-time URL.
 */
interface ReadyMessage {
  type: 'turnkeel.ready';
  mode: 'local' | 'server';
  url: string;
  oneTimeUrl: string | null;
  /** True when this start loaded the demo workspace. */
  demo?: boolean;
}

function isReady(message: unknown): message is ReadyMessage {
  if (typeof message !== 'object' || message === null) return false;
  const value = message as Record<string, unknown>;
  return (
    value.type === 'turnkeel.ready' &&
    (value.mode === 'local' || value.mode === 'server') &&
    typeof value.url === 'string' &&
    (typeof value.oneTimeUrl === 'string' || value.oneTimeUrl === null)
  );
}

export interface LaunchOptions {
  /** The port to listen on. Left to the server (`TURNKEEL_PORT`, or 4400) when not given. */
  port: number | undefined;
  /** Whether to open the browser at the one-time URL. */
  open: boolean;
  /**
   * True for `--demo`: the first run loads the demo workspace. Without it the
   * first run starts empty and the app asks what you are shipping.
   */
  demo?: boolean;
}

export interface LaunchDeps {
  output: Output;
  /** The environment the server starts in. The data folder and the rest of the configuration are read from it by the server. */
  env: NodeJS.ProcessEnv;
  /** The file to start: the entry of `@turnkeel/server`. */
  serverEntry: string;
  /** Opens an address in the browser, and says whether that worked. */
  openBrowser: (url: string) => Promise<boolean>;
  /** Calls `stop` when this process is told to stop (Ctrl-C, SIGTERM). Returns what removes the listener. */
  onStop: (stop: () => void) => () => void;
  /** Calls `ask` each time the person presses Enter. Not given when nobody is at a terminal. */
  onEnter?: (ask: () => void) => () => void;
  /** Where the server's own output goes. The terminal, unless a test says otherwise. */
  serverOutput?: 'inherit' | 'ignore';
  /** How long the server gets to stop before it is killed. */
  stopTimeoutMs?: number;
}

/**
 * Starts the Turnkeel server as a process of its own and stays until it has stopped.
 * Returns the exit code.
 *
 * The launcher never holds the local secret. The server makes it, keeps
 * it in its own memory and sends only a one-time URL, which the launcher hands to
 * the browser or prints.
 */
export function launch(options: LaunchOptions, deps: LaunchDeps): Promise<number> {
  const { output } = deps;
  const stopTimeoutMs = deps.stopTimeoutMs ?? 15_000;

  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = fork(deps.serverEntry, [], {
        env: {
          ...deps.env,
          ...(options.port === undefined ? {} : { TURNKEEL_PORT: String(options.port) }),
          ...(options.demo === true ? { TURNKEEL_DEMO: 'true' } : {}),
        },
        stdio: ['ignore', deps.serverOutput ?? 'inherit', deps.serverOutput ?? 'inherit', 'ipc'],
      });
    } catch (error) {
      output.err(messages.serverNotStarted(error instanceof Error ? error.message : String(error)));
      resolve(1);
      return;
    }

    let ready = false;
    let stopping = false;
    let finished = false;
    let killTimer: NodeJS.Timeout | undefined;
    const listeners: (() => void)[] = [];

    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      clearTimeout(killTimer);
      for (const remove of listeners) remove();
      resolve(code);
    };

    const stop = () => {
      if (stopping) return;
      stopping = true;
      // A server that listens stops when its channel closes, on every system. One that
      // is still starting has no such listener yet, so it is told by signal.
      if (ready && child.connected) child.disconnect();
      else child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), stopTimeoutMs);
    };

    const announce = async (message: ReadyMessage) => {
      // With sign-in on (TURNKEEL_PUBLIC_URL is set) there is no local session to
      // hand over, and the server has said where people reach it.
      if (message.mode !== 'local' || message.oneTimeUrl === null) return;
      if (options.open && (await deps.openBrowser(message.oneTimeUrl))) {
        output.out(messages.opened(message.url));
      } else {
        if (options.open) output.out(messages.notOpened);
        output.out(messages.openOnce(message.oneTimeUrl));
      }
      // How agents and the CLI get in: a token, made in the app. Never the token
      // itself: on the demo's first run the page shows it once and this says where.
      if (message.demo === true) output.out(messages.demoLoaded);
      output.out(messages.howToGetToken);
      if (stopping || finished) return;
      output.out(messages.howToStop);
      if (deps.onEnter) {
        output.out(messages.howToGetAnother);
        listeners.push(
          deps.onEnter(() => {
            if (!stopping && child.connected) child.send({ type: 'turnkeel.one-time-url' });
          }),
        );
      }
    };

    child.on('message', (message) => {
      if (!isReady(message)) return;
      if (!ready) {
        ready = true;
        void announce(message);
      } else if (message.oneTimeUrl !== null) {
        output.out(messages.anotherOnce(message.oneTimeUrl));
      }
    });
    child.once('error', (error) => {
      output.err(messages.serverNotStarted(error.message));
      finish(1);
    });
    // The server has said why it stopped, when it had a reason.
    child.once('exit', (code) => finish(code ?? 1));

    listeners.push(deps.onStop(stop));
  });
}

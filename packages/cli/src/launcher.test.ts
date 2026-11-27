import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { launch, type LaunchDeps, type LaunchOptions } from './launcher.js';

const fakeServer = fileURLToPath(new URL('./testing/fake-server.mjs', import.meta.url));

type Behaviour = 'local' | 'sign-in' | 'exit-before-ready' | 'ignore-stop';

interface Run {
  out: string[];
  err: string[];
  opened: string[];
  /** What Ctrl-C does. */
  stop: () => void;
  /** What pressing Enter does. */
  enter: () => void;
  /** Resolves when `out` holds a line that matches. */
  said: (pattern: RegExp) => Promise<string>;
  code: Promise<number>;
}

function run(
  options: Partial<LaunchOptions> & {
    behaviour?: Behaviour;
    browserOpens?: boolean;
    terminal?: boolean;
    env?: NodeJS.ProcessEnv;
    serverEntry?: string;
    stopTimeoutMs?: number;
  } = {},
): Run {
  const out: string[] = [];
  const err: string[] = [];
  const opened: string[] = [];
  const waiting: { pattern: RegExp; resolve: (line: string) => void }[] = [];
  let stop = () => {};
  let enter = () => {};

  const deps: LaunchDeps = {
    output: {
      out(line) {
        out.push(line);
        for (const waiter of waiting.splice(0)) {
          if (waiter.pattern.test(line)) waiter.resolve(line);
          else waiting.push(waiter);
        }
      },
      err: (line) => err.push(line),
    },
    env: {
      PATH: process.env.PATH,
      FAKE_BEHAVIOUR: options.behaviour ?? 'local',
      ...options.env,
    },
    serverEntry: options.serverEntry ?? fakeServer,
    openBrowser(url) {
      opened.push(url);
      return Promise.resolve(options.browserOpens ?? true);
    },
    onStop(listener) {
      stop = listener;
      return () => {
        stop = () => {};
      };
    },
    ...(options.terminal === false
      ? {}
      : {
          onEnter(listener: () => void) {
            enter = listener;
            return () => {
              enter = () => {};
            };
          },
        }),
    serverOutput: 'ignore',
    ...(options.stopTimeoutMs === undefined ? {} : { stopTimeoutMs: options.stopTimeoutMs }),
  };

  const code = launch(
    { port: options.port, open: options.open ?? true, demo: options.demo ?? false },
    deps,
  );
  return {
    out,
    err,
    opened,
    stop: () => stop(),
    enter: () => enter(),
    said(pattern) {
      const line = out.find((candidate) => pattern.test(candidate));
      if (line !== undefined) return Promise.resolve(line);
      return new Promise((resolve) => waiting.push({ pattern, resolve }));
    },
    code,
  };
}

describe('launch', () => {
  it('starts the server, opens the browser at the one-time URL and says where Turnkeel is', async () => {
    const launched = run();
    await launched.said(/Press Enter/);
    expect(launched.opened).toEqual(['http://127.0.0.1:4400/api/v1/local/session?code=code-1']);
    expect(launched.out).toEqual([
      'Turnkeel is open in your browser, at http://127.0.0.1:4400',
      messages.howToGetToken,
      'Press Ctrl-C to stop Turnkeel.',
      'Press Enter for another one-time address, for a second browser.',
    ]);

    launched.stop();
    expect(await launched.code).toBe(0);
    expect(launched.err).toEqual([]);
  });

  it('never prints the one-time URL that the browser has used', async () => {
    const launched = run();
    await launched.said(/Press Ctrl-C/);
    launched.stop();
    await launched.code;
    expect(launched.out.join('\n')).not.toContain('code=');
  });

  it('with --no-open prints the one-time URL and opens nothing', async () => {
    const launched = run({ open: false });
    await launched.said(/Press Ctrl-C/);
    expect(launched.opened).toEqual([]);
    expect(launched.out.slice(0, 3)).toEqual([
      'Open this address once to use Turnkeel in your browser: http://127.0.0.1:4400/api/v1/local/session?code=code-1',
      messages.howToGetToken,
      'Press Ctrl-C to stop Turnkeel.',
    ]);
    launched.stop();
    expect(await launched.code).toBe(0);
  });

  it('prints the one-time URL when the browser could not be opened', async () => {
    const launched = run({ browserOpens: false });
    await launched.said(/Press Ctrl-C/);
    expect(launched.out.slice(0, 2)).toEqual([
      'The browser could not be opened from here.',
      'Open this address once to use Turnkeel in your browser: http://127.0.0.1:4400/api/v1/local/session?code=code-1',
    ]);
    launched.stop();
    expect(await launched.code).toBe(0);
  });

  it('passes --port to the server as TURNKEEL_PORT, over what the environment says', async () => {
    const launched = run({ port: 4567, open: false, env: { TURNKEEL_PORT: '4999' } });
    expect(await launched.said(/Open this address once/)).toContain('http://127.0.0.1:4567/');
    launched.stop();
    await launched.code;
  });

  it("on the demo's first run says where its token is shown, and never prints a token", async () => {
    const launched = run({ open: false, demo: true, env: { FAKE_FIRST_RUN: 'true' } });
    await launched.said(/Press Ctrl-C/);
    expect(launched.out).toContain(messages.demoLoaded);
    expect(launched.out.join('\n')).not.toMatch(/tk_/);
    launched.stop();
    await launched.code;
  });

  it('says the demo line once: not again for the address Enter asks for', async () => {
    const launched = run({ open: false, demo: true, env: { FAKE_FIRST_RUN: 'true' } });
    await launched.said(/Press Enter/);
    launched.enter();
    await launched.said(/code=code-2/);
    expect(launched.out.filter((line) => line === messages.demoLoaded)).toHaveLength(1);
    launched.stop();
    await launched.code;
  });

  it('says nothing of the demo when the server did not say it loaded one', async () => {
    const launched = run({ open: false, env: { FAKE_FIRST_RUN: 'unsaid' } });
    await launched.said(/Press Ctrl-C/);
    expect(launched.out).not.toContain(messages.demoLoaded);
    launched.stop();
    await launched.code;
  });

  it('a first run without --demo loads no demo, and says nothing of one', async () => {
    const launched = run({ open: false, env: { FAKE_FIRST_RUN: 'true' } });
    await launched.said(/Press Ctrl-C/);
    expect(launched.out).not.toContain(messages.demoLoaded);
    launched.stop();
    await launched.code;
  });

  it('--no-demo, kept for old scripts, loads no demo either', async () => {
    const launched = run({ open: false, demo: false, env: { FAKE_FIRST_RUN: 'true' } });
    await launched.said(/Press Ctrl-C/);
    expect(launched.out).not.toContain(messages.demoLoaded);
    launched.stop();
    await launched.code;
  });

  it('leaves the port to the environment when --port is not given', async () => {
    const launched = run({ open: false, env: { TURNKEEL_PORT: '4999' } });
    expect(await launched.said(/Open this address once/)).toContain('http://127.0.0.1:4999/');
    launched.stop();
    await launched.code;
  });

  it('asks the server for another one-time URL each time Enter is pressed', async () => {
    const launched = run();
    await launched.said(/Press Enter/);
    launched.enter();
    expect(await launched.said(/code-2/)).toBe(
      'Another address, which also works once: http://127.0.0.1:4400/api/v1/local/session?code=code-2',
    );
    launched.enter();
    await launched.said(/code-3/);
    launched.stop();
    expect(await launched.code).toBe(0);
  });

  it('does not offer another address when nobody is at a terminal', async () => {
    const launched = run({ terminal: false });
    await launched.said(/Press Ctrl-C/);
    launched.stop();
    await launched.code;
    expect(launched.out).toEqual([
      'Turnkeel is open in your browser, at http://127.0.0.1:4400',
      messages.howToGetToken,
      'Press Ctrl-C to stop Turnkeel.',
    ]);
  });

  it('opens nothing and adds nothing when the server runs with sign-in', async () => {
    const launched = run({ behaviour: 'sign-in' });
    // The fake server has sent its message when it has been running for a moment.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    launched.stop();
    expect(await launched.code).toBe(0);
    expect(launched.opened).toEqual([]);
    expect(launched.out).toEqual([]);
  });

  it('returns the exit code of a server that could not start, and opens nothing', async () => {
    const launched = run({ behaviour: 'exit-before-ready' });
    expect(await launched.code).toBe(1);
    expect(launched.opened).toEqual([]);
    expect(launched.out).toEqual([]);
  });

  it('fails when the server file is not there', async () => {
    const launched = run({
      serverEntry: fileURLToPath(new URL('./nothing-here.mjs', import.meta.url)),
    });
    expect(await launched.code).toBe(1);
    expect(launched.opened).toEqual([]);
    expect(launched.out).toEqual([]);
  });

  it('kills a server that does not stop in time', async () => {
    const launched = run({ behaviour: 'ignore-stop', stopTimeoutMs: 300 });
    await launched.said(/Press Ctrl-C/);
    launched.stop();
    // Killed, so there is no exit code of its own.
    expect(await launched.code).toBe(1);
  });

  it('stops once, however often it is told to', async () => {
    const launched = run();
    await launched.said(/Press Ctrl-C/);
    launched.stop();
    launched.stop();
    launched.enter();
    expect(await launched.code).toBe(0);
  });
});

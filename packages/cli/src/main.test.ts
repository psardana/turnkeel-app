import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from '../package.json' with { type: 'json' };
import { main, type MainDeps } from './index.js';
import { messages } from './messages.js';

const fakeServer = fileURLToPath(new URL('./testing/fake-server.mjs', import.meta.url));

function deps(overrides: Partial<MainDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const opened: string[] = [];
  let stop = () => {};
  const value: MainDeps = {
    output: { out: (line) => out.push(line), err: (line) => err.push(line) },
    env: { PATH: process.env.PATH },
    findServerEntry: () => fakeServer,
    openBrowser: (url) => {
      opened.push(url);
      // The test stops the server as soon as the browser has been "opened".
      setTimeout(() => stop(), 50);
      return Promise.resolve(true);
    },
    onStop(listener) {
      stop = listener;
      return () => {};
    },
    serverOutput: 'ignore',
    ...overrides,
  };
  return { value, out, err, opened };
}

describe('turnkeel', () => {
  it.each(['--version', '-V'])('prints its version for %s', async (flag) => {
    const { value, out, err } = deps();
    expect(await main([flag], value)).toBe(0);
    expect(out).toEqual([`turnkeel ${manifest.version}`]);
    expect(err).toEqual([]);
  });

  it.each(['--help', '-h'])('prints the help for %s', async (flag) => {
    const { value, out, err } = deps();
    expect(await main([flag], value)).toBe(0);
    expect(out).toEqual([messages.help]);
    expect(err).toEqual([]);
  });

  it('lists in the help what exists, and no command of a later step', () => {
    for (const option of [
      '--port',
      '--no-open',
      '--demo',
      'init [--template <name>]',
      '--help',
      '--version',
      'TURNKEEL_DATA_DIR',
      'import hub <dir> --as <user> [--repo <checkout>] [--dry-run]',
    ]) {
      expect(messages.help).toContain(option);
    }
  });

  it('names a command it does not have, and fails', async () => {
    const { value, out, err, opened } = deps();
    expect(await main(['launch'], value)).toBe(2);
    expect(out).toEqual([]);
    expect(err).toEqual([
      'turnkeel does not have the command "launch".',
      'Run "turnkeel --help" to see what it takes.',
    ]);
    expect(opened).toEqual([]);
  });

  it('refuses a bad port before it starts anything', async () => {
    const { value, err, opened } = deps({
      findServerEntry: () => {
        throw new Error('The server must not be looked for.');
      },
    });
    expect(await main(['--port', '70000'], value)).toBe(2);
    expect(err[0]).toBe('--port takes a number from 1 to 65535, not "70000".');
    expect(opened).toEqual([]);
  });

  it('with no arguments starts the server and opens the browser', async () => {
    const { value, out, opened } = deps();
    expect(await main([], value)).toBe(0);
    expect(opened).toEqual(['http://127.0.0.1:4400/api/v1/local/session?code=code-1']);
    expect(out[0]).toBe('Turnkeel is open in your browser, at http://127.0.0.1:4400');
  });

  it('says so when the server package is not installed', async () => {
    const { value, err } = deps({ findServerEntry: () => undefined });
    expect(await main([], value)).toBe(1);
    expect(err).toEqual([
      'The Turnkeel server (the package @turnkeel/server) was not found next to this command. Install turnkeel again.',
    ]);
  });
});

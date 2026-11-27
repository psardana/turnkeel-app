import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const url = 'http://127.0.0.1:4400/api/v1/local/session?code=abc&next=1';

describe('the page that hands the one-time URL to the browser', () => {
  it('is used on macOS and Windows, and not where a sandboxed browser could not read it', () => {
    expect(handsOverByFile('darwin')).toBe(true);
    expect(handsOverByFile('win32')).toBe(true);
    expect(handsOverByFile('linux')).toBe(false);
    expect(handsOverByFile('freebsd')).toBe(false);
  });

  it('writes an address so that nothing in it is read as HTML', () => {
    const page = handoverPage('http://127.0.0.1:4400/x?a=1&b="><script>alert(1)</script>');
    expect(page).not.toContain('<script>');
    expect(page).toContain('a=1&amp;b=&quot;&gt;&lt;script&gt;');
  });

  it('is removed again, with its folder, by the function that comes with it', () => {
    const { file, remove } = writeHandoverFile(url);
    expect(readFileSync(file, 'utf8')).toBe(handoverPage(url));
    remove();
    remove();
    expect(existsSync(path.dirname(file))).toBe(false);
  });
});

describe('browserCommand', () => {
  it('uses open on macOS', () => {
    expect(browserCommand('darwin', url)).toEqual({ command: 'open', args: [url] });
  });

  it('uses the URL handler on Windows, with the address as one argument', () => {
    expect(browserCommand('win32', url)).toEqual({
      command: 'rundll32',
      args: ['url.dll,FileProtocolHandler', url],
    });
  });

  it.each(['linux', 'freebsd'] as const)('uses xdg-open on %s', (platform) => {
    expect(browserCommand(platform, url)).toEqual({ command: 'xdg-open', args: [url] });
  });
});

// A stand-in for the system's opener, first and alone on the PATH, so that no
// browser is opened by a test. It is a shell script, which Windows does not run.
describe.skipIf(process.platform === 'win32')('openBrowser', () => {
  const realPath = process.env.PATH;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-opener-'));
    process.env.PATH = dir;
  });
  afterEach(() => {
    process.env.PATH = realPath;
    rmSync(dir, { recursive: true, force: true });
  });

  function opener(script: string) {
    writeFileSync(path.join(dir, 'xdg-open'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  }

  it('hands the whole address to the opener as one argument, and says that it worked', async () => {
    opener(`printf '%s' "$1" > "${dir}/address"\nprintf '%s' "$#" > "${dir}/count"`);
    expect(await openBrowser(url, 'linux')).toBe(true);
    expect(readFileSync(path.join(dir, 'address'), 'utf8')).toBe(url);
    expect(readFileSync(path.join(dir, 'count'), 'utf8')).toBe('1');
  });

  // On macOS and Windows the code of the one-time URL never is an argument: every
  // account on the machine can read the arguments of a running program.
  it('hands the opener a page that only this account can read, and no address, where the browser can read such a file', async () => {
    writeFileSync(
      path.join(dir, 'open'),
      [
        '#!/bin/sh',
        `printf '%s' "$*" > "${dir}/arguments"`,
        `/bin/cat "$1" > "${dir}/page"`,
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    expect(await openBrowser(url, 'darwin')).toBe(true);
    const file = readFileSync(path.join(dir, 'arguments'), 'utf8');
    expect(file).not.toContain('code=');
    expect(file).not.toContain('http');
    expect(path.isAbsolute(file)).toBe(true);
    expect(path.basename(file)).toBe('open.html');

    // The page sends the browser on to the address, written as HTML writes it.
    const page = readFileSync(path.join(dir, 'page'), 'utf8');
    const escaped = 'http://127.0.0.1:4400/api/v1/local/session?code=abc&amp;next=1';
    expect(page).toContain(`<meta http-equiv="refresh" content="0;url=${escaped}">`);
    expect(page).toContain(`<a href="${escaped}">Open Turnkeel</a>`);

    // The file is this account's alone, in a folder that is this account's alone.
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    // The launcher removes it half a minute later, or when it exits. The test does not wait.
    rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('removes the page when the opener fails', async () => {
    writeFileSync(
      path.join(dir, 'open'),
      `#!/bin/sh\nprintf '%s' "$1" > "${dir}/arguments"\nexit 3\n`,
      {
        mode: 0o755,
      },
    );
    expect(await openBrowser(url, 'darwin')).toBe(false);
    const file = readFileSync(path.join(dir, 'arguments'), 'utf8');
    expect(existsSync(file)).toBe(false);
    expect(existsSync(path.dirname(file))).toBe(false);
  });

  it('says that it did not work when the opener fails', async () => {
    opener('exit 3');
    expect(await openBrowser(url, 'linux')).toBe(false);
  });

  it('says that it did not work when the system has no opener', async () => {
    expect(await openBrowser(url, 'linux')).toBe(false);
  });
});

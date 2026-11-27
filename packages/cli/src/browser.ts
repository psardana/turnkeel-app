import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { messages } from './messages.js';

/**
 * The program that opens something in the person's browser on each system. `target`
 * is an address, or the path of a page on this machine.
 */
export function browserCommand(
  platform: NodeJS.Platform,
  target: string,
): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [target] };
  // Not `cmd /c start`, which would read the `&` of a query as its own.
  if (platform === 'win32') {
    return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', target] };
  }
  return { command: 'xdg-open', args: [target] };
}

/**
 * Whether the address is handed to the browser in a file and not as an argument.
 *
 * The one-time URL carries the code that gives a browser the local session. The
 * arguments of a program can be read by every account on the machine while it runs,
 * so on macOS and Windows the opener is given the path of a page that only this
 * account can read, and that page sends the browser on.
 *
 * Elsewhere the address stays an argument. A browser installed as a Snap or a Flatpak,
 * which is the usual one on several Linux desktops, cannot read a file in a private
 * folder of this account, and would show an error in place of Turnkeel.
 * `--no-open` prints the address and starts no program with it.
 */
export function handsOverByFile(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The page that sends the browser on to `url`, with a link for a browser that does not go by itself. */
export function handoverPage(url: string): string {
  const address = escapeHtml(url);
  return [
    '<!doctype html>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(messages.productName)}</title>`,
    `<meta http-equiv="refresh" content="0;url=${address}">`,
    `<a href="${address}">${escapeHtml(messages.handoverLink)}</a>`,
    '',
  ].join('\n');
}

/** How long the page stays on disk. The browser reads it within a moment of being started. */
export const HANDOVER_FILE_MS = 30_000;

/**
 * Writes the page into a new folder that only this account can enter, and returns its
 * path with the function that removes it. It is removed after `HANDOVER_FILE_MS`, or
 * when this process exits, whichever is first.
 */
export function writeHandoverFile(url: string): { file: string; remove: () => void } {
  // A folder made by mkdtemp is open to its owner alone (mode 0700).
  const folder = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-'));
  const file = path.join(folder, 'open.html');
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    clearTimeout(timer);
    process.off('exit', remove);
    rmSync(folder, { recursive: true, force: true });
  };
  const timer = setTimeout(remove, HANDOVER_FILE_MS);
  timer.unref();
  process.once('exit', remove);
  try {
    writeFileSync(file, handoverPage(url), { mode: 0o600, flag: 'wx' });
  } catch (error) {
    remove();
    throw error;
  }
  return { file, remove };
}

/** How long the opener gets to say that it failed. One that is still running by then has a browser to talk to. */
const OPENER_WAIT_MS = 3000;

/**
 * Opens the address in the browser. Answers false when that could not be done:
 * no opener on this system, or it said it failed.
 */
export function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  let handover: { file: string; remove: () => void } | null = null;
  if (handsOverByFile(platform)) {
    try {
      handover = writeHandoverFile(url);
    } catch {
      // No file, no browser: the launcher then prints the address.
      return Promise.resolve(false);
    }
  }
  const { command, args } = browserCommand(platform, handover?.file ?? url);
  return new Promise((resolve) => {
    const failed = () => {
      handover?.remove();
      resolve(false);
    };
    let child;
    try {
      child = spawn(command, args, { stdio: 'ignore', detached: true });
    } catch {
      failed();
      return;
    }
    const timer = setTimeout(() => resolve(true), OPENER_WAIT_MS);
    child.once('error', () => {
      clearTimeout(timer);
      failed();
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(true);
      else failed();
    });
    child.unref();
  });
}

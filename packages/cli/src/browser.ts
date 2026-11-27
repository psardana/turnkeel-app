import { spawn } from 'node:child_process';

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

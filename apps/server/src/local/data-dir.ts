import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { messages } from '../messages.js';

/** Another server process holds the data folder. */
export class DataDirInUseError extends Error {
  override readonly name = 'DataDirInUseError';
}

/** The data folders this process holds. */
const held = new Set<string>();

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists and belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Makes a folder that only the OS user can enter, or makes an existing one so.
 * `mkdir` sets a mode only on what it creates, and a folder that was there before,
 * made by hand or by a script, usually lets every account in. PGlite writes its files
 * readable and writable by everyone, so this mode is all that keeps other accounts
 * out of the database.
 *
 * A folder that belongs to another account cannot be changed and is left as it is,
 * with a warning: a mounted volume can look that way and still be the right place.
 */
function makePrivate(folder: string, warn: (line: string) => void): void {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  // A mode says nothing on Windows, where the folder is in the user's profile.
  if (process.platform === 'win32') return;
  const info = statSync(folder);
  if ((info.mode & 0o077) === 0) return;
  try {
    chmodSync(folder, 0o700);
  } catch {
    warn(messages.log.dataDirNotPrivate(folder));
  }
}

export interface ClaimDataDirOptions {
  /** Hears about a data folder that other accounts may be able to read. */
  warn?: (line: string) => void;
}

/**
 * Makes the data folder and the database's folder inside it, open to the OS user
 * only, and marks the data folder as in use by this process. PGlite keeps its data
 * in files, and one process opens them at a time ("Demo seed and
 * importer"); a second server on the same folder would damage them. Returns the
 * function that removes the mark.
 */
export function claimDataDir(dataDir: string, options: ClaimDataDirOptions = {}): () => void {
  const folder = path.resolve(dataDir);
  if (held.has(folder)) {
    throw new DataDirInUseError(messages.log.dataDirInUse(dataDir, process.pid));
  }
  const warn = options.warn ?? (() => {});
  makePrivate(folder, warn);
  // Private whatever its parent is. PGlite fills an empty folder that is there already.
  makePrivate(databaseDir(folder), warn);
  const lockFile = path.join(folder, 'server.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockFile, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
      held.add(folder);
      return () => {
        held.delete(folder);
        rmSync(lockFile, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = Number(readFileSync(lockFile, 'utf8').trim());
      // This process's own id in the file, while it holds nothing: left by an earlier
      // process that had the same id.
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && isRunning(pid)) {
        throw new DataDirInUseError(messages.log.dataDirInUse(dataDir, pid));
      }
      // Left behind by a process that is gone.
      rmSync(lockFile, { force: true });
    }
  }
  throw new DataDirInUseError(messages.log.dataDirInUse(dataDir, 0));
}

/** Where PGlite keeps the database inside the data folder. */
export function databaseDir(dataDir: string): string {
  return path.join(dataDir, 'db');
}

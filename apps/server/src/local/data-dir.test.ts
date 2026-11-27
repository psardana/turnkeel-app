import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claimDataDir, databaseDir, DataDirInUseError } from './data-dir.js';

const modeOf = (target: string) => statSync(target).mode & 0o777;

describe('the data folder of local mode', () => {
  let parent: string;

  beforeEach(() => {
    parent = mkdtempSync(path.join(os.tmpdir(), 'turnkeel-data-dir-'));
  });
  afterEach(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  // A mode says nothing on Windows.
  describe.skipIf(process.platform === 'win32')('is open to the OS user only', () => {
    it('when the server makes it, with the folder of the database inside it', () => {
      const folder = path.join(parent, 'new', 'turnkeel');
      const release = claimDataDir(folder);
      try {
        expect(modeOf(folder)).toBe(0o700);
        expect(modeOf(databaseDir(folder))).toBe(0o700);
        expect(modeOf(path.join(folder, 'server.lock'))).toBe(0o600);
      } finally {
        release();
      }
    });

    it('when it was there before with a wider mode, as a folder made by hand is', () => {
      const folder = path.join(parent, 'by-hand');
      mkdirSync(folder);
      chmodSync(folder, 0o755);
      mkdirSync(databaseDir(folder));
      chmodSync(databaseDir(folder), 0o755);
      const warnings: string[] = [];
      const release = claimDataDir(folder, { warn: (line) => warnings.push(line) });
      try {
        expect(modeOf(folder)).toBe(0o700);
        expect(modeOf(databaseDir(folder))).toBe(0o700);
        // It is this user's own folder, so there is nothing to warn about.
        expect(warnings).toEqual([]);
      } finally {
        release();
      }
    });
  });

  it('is held by one server at a time, and free again once it is released', () => {
    const folder = path.join(parent, 'held');
    const release = claimDataDir(folder);
    expect(() => claimDataDir(folder)).toThrow(DataDirInUseError);
    release();
    claimDataDir(folder)();
  });
});

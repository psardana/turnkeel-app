import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../workspace.js';
import { boundaryConfigs } from './config.js';

/**
 * These tests run the boundary rules as the repository configures them, on text that
 * is given the path of a file in a real package. No file is written.
 */
const boundaryLint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } },
    ...boundaryConfigs(),
  ],
});

async function lint(file: string, code: string): Promise<string[]> {
  const [result] = await boundaryLint.lintText(code, { filePath: `${repoRoot}/${file}` });
  return (result?.messages ?? []).map((message) => `${message.ruleId}: ${message.message}`);
}

describe('the boundary rules, as configured for this repository', () => {
  it('stops the CLI (MIT) from importing core (AGPL)', async () => {
    const messages = await lint(
      'packages/cli/src/fixture.ts',
      "import { sameRef } from '@turnkeel/core';",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(
      /^turnkeel\/boundaries: turnkeel is under MIT and must not import @turnkeel\/core, which is under AGPL-3\.0-only\./,
    );
  });

  it.each([
    ['packages/cli/src/fixture.ts', '@turnkeel/db'],
    ['packages/mcp/src/fixture.ts', '@turnkeel/core'],
    ['packages/mcp/src/fixture.ts', '@turnkeel/db'],
    ['packages/mcp/src/fixture.ts', '@turnkeel/server'],
    ['packages/protocol/src/fixture.ts', '@turnkeel/core'],
    ['packages/connector-sdk/src/fixture.ts', '@turnkeel/core'],
  ])('stops %s (MIT) from importing %s (AGPL)', async (file, target) => {
    const messages = await lint(file, `import { x } from '${target}';`);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('turnkeel/boundaries');
    expect(messages[0]).toContain('must not import');
  });

  it('lets the CLI name the server only in a dynamic import of the package name', async () => {
    const file = 'packages/cli/src/fixture.ts';
    expect(await lint(file, "const server = await import('@turnkeel/server');")).toEqual([]);

    const staticImport = await lint(file, "import { start } from '@turnkeel/server';");
    expect(staticImport).toHaveLength(1);
    expect(staticImport[0]).toContain("only as import('@turnkeel/server')");

    const insidePath = await lint(file, "const x = await import('@turnkeel/server/src/app.js');");
    expect(insidePath).toHaveLength(1);
  });

  it('stops a relative path from one package into another', async () => {
    const messages = await lint(
      'packages/cli/src/fixture.ts',
      "import { sameRef } from '../../core/src/index.js';",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('This path leads into @turnkeel/core');
  });

  it('lets core import protocol and nothing else from this repository', async () => {
    const file = 'packages/core/src/fixture.ts';
    expect(await lint(file, "import type { Ref } from '@turnkeel/protocol';")).toEqual([]);

    for (const target of ['@turnkeel/db', '@turnkeel/server', '@turnkeel/mcp', 'turnkeel']) {
      const messages = await lint(file, `import { x } from '${target}';`);
      expect(messages, target).toHaveLength(1);
      expect(messages[0]).toContain('@turnkeel/core may not import');
    }
  });

  it.each([
    ['a database driver', "import pg from 'pg';"],
    ['the PGlite driver', "import { PGlite } from '@electric-sql/pglite';"],
    ['the ORM', "import { eq } from 'drizzle-orm';"],
    ['an HTTP library', "import { Hono } from 'hono';"],
    ['the file system', "import { readFile } from 'node:fs/promises';"],
    ['the file system without the node: prefix', "import fs from 'fs';"],
    ['the network', "import { connect } from 'node:net';"],
    ['child processes', "import { spawn } from 'node:child_process';"],
  ])('stops core from importing %s', async (_what, code) => {
    const messages = await lint('packages/core/src/fixture.ts', code);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^turnkeel\/no-io: This package does no I\/O/);
  });

  it('stops core and protocol from calling fetch', async () => {
    for (const file of ['packages/core/src/fixture.ts', 'packages/protocol/src/fixture.ts']) {
      const messages = await lint(file, "export const page = () => fetch('https://example.com');");
      expect(messages, file).toHaveLength(1);
      expect(messages[0]).toContain('no-restricted-globals');
    }
  });

  it('lets a test in core read a fixture file', async () => {
    const messages = await lint(
      'packages/core/src/gates.test.ts',
      "import { readFileSync } from 'node:fs';",
    );
    expect(messages).toEqual([]);
  });

  it('lets the web app import protocol and core, and nothing that does I/O', async () => {
    const file = 'apps/web/src/fixture.tsx';
    expect(await lint(file, "import type { Ref } from '@turnkeel/protocol';")).toEqual([]);
    expect(await lint(file, "import { sameRef } from '@turnkeel/core';")).toEqual([]);

    for (const target of ['@turnkeel/db', '@turnkeel/server', '@turnkeel/mcp', 'turnkeel']) {
      const messages = await lint(file, `import { x } from '${target}';`);
      expect(messages, target).toHaveLength(1);
      expect(messages[0]).toContain('@turnkeel/web may not import');
    }
  });

  it('lets the server import every package except the CLI', async () => {
    const file = 'apps/server/src/fixture.ts';
    for (const target of [
      '@turnkeel/protocol',
      '@turnkeel/core',
      '@turnkeel/db',
      '@turnkeel/connector-sdk',
      '@turnkeel/mcp',
    ]) {
      expect(await lint(file, `import { x } from '${target}';`), target).toEqual([]);
    }
    expect(await lint(file, "import { main } from 'turnkeel';")).toHaveLength(1);
    expect(await lint(file, "import { App } from '@turnkeel/web';")).toHaveLength(1);
  });
});

describe('the root eslint.config.js', () => {
  const rootLint = new ESLint({ cwd: repoRoot });

  async function rules(file: string): Promise<Partial<Linter.RulesRecord>> {
    const config = (await rootLint.calculateConfigForFile(`${repoRoot}/${file}`)) as Linter.Config;
    return config.rules ?? {};
  }

  const severity = (entry: Linter.RuleEntry | undefined) =>
    Array.isArray(entry) ? entry[0] : entry;

  it.each([
    'packages/protocol/src/index.ts',
    'packages/core/src/index.ts',
    'packages/db/src/index.ts',
    'packages/connector-sdk/src/index.ts',
    'packages/mcp/src/index.ts',
    'packages/cli/src/index.ts',
    'packages/cli/bin/turnkeel.js',
    'apps/server/src/index.ts',
    'apps/web/src/main.tsx',
  ])('checks boundaries in %s as an error', async (file) => {
    expect(severity((await rules(file))['turnkeel/boundaries'])).toBe(2);
  });

  it.each(['packages/protocol/src/index.ts', 'packages/core/src/index.ts'])(
    'checks %s for I/O as an error',
    async (file) => {
      const fileRules = await rules(file);
      expect(severity(fileRules['turnkeel/no-io'])).toBe(2);
      expect(severity(fileRules['no-restricted-globals'])).toBe(2);
    },
  );

  it('does not apply the I/O rule outside protocol and core', async () => {
    expect((await rules('packages/db/src/index.ts'))['turnkeel/no-io']).toBeUndefined();
    expect((await rules('apps/server/src/index.ts'))['turnkeel/no-io']).toBeUndefined();
  });
});

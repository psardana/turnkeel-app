import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { boundariesRule } from './boundaries-rule.js';
import { noIoRule } from './no-io-rule.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
});

// A made-up workspace, so these cases do not change when the real one does.
const root = '/repo';
const boundaries = {
  root,
  packages: [
    { name: '@turnkeel/protocol', dir: 'packages/protocol', license: 'MIT' },
    { name: '@turnkeel/core', dir: 'packages/core', license: 'AGPL-3.0-only' },
    { name: '@turnkeel/db', dir: 'packages/db', license: 'AGPL-3.0-only' },
    { name: '@turnkeel/connector-sdk', dir: 'packages/connector-sdk', license: 'MIT' },
    { name: '@turnkeel/connector-github', dir: 'packages/connectors/github', license: 'MIT' },
    { name: '@turnkeel/mcp', dir: 'packages/mcp', license: 'MIT' },
    { name: 'turnkeel', dir: 'packages/cli', license: 'MIT' },
    { name: '@turnkeel/server', dir: 'apps/server', license: 'AGPL-3.0-only' },
    { name: '@turnkeel/web', dir: 'apps/web', license: 'AGPL-3.0-only' },
  ],
  allow: {
    '@turnkeel/protocol': [],
    '@turnkeel/core': ['@turnkeel/protocol'],
    '@turnkeel/db': ['@turnkeel/protocol', '@turnkeel/core'],
    '@turnkeel/connector-sdk': [],
    '@turnkeel/connector-github': ['@turnkeel/connector-sdk'],
    '@turnkeel/mcp': ['@turnkeel/protocol'],
    turnkeel: ['@turnkeel/protocol'],
    '@turnkeel/server': [
      '@turnkeel/protocol',
      '@turnkeel/core',
      '@turnkeel/db',
      '@turnkeel/connector-sdk',
      '@turnkeel/connector-github',
      '@turnkeel/mcp',
    ],
    '@turnkeel/web': ['@turnkeel/protocol', '@turnkeel/core'],
  },
  dynamicOnly: { turnkeel: ['@turnkeel/server'] },
};

const inPackage = (dir: string, code: string) => ({
  code,
  filename: `${root}/${dir}/src/file.ts`,
  options: [boundaries],
});

ruleTester.run('turnkeel/boundaries', boundariesRule, {
  valid: [
    inPackage('packages/core', "import type { Ref } from '@turnkeel/protocol';"),
    inPackage('packages/db', "import { sameRef } from '@turnkeel/core';"),
    inPackage('packages/mcp', "export * from '@turnkeel/protocol';"),
    inPackage('packages/connectors/github', "import { x } from '@turnkeel/connector-sdk';"),
    inPackage('apps/web', "import { sameRef } from '@turnkeel/core';"),
    inPackage('apps/server', "import { x } from '@turnkeel/db';"),
    inPackage('apps/server', "import { x } from '@turnkeel/connector-github';"),
    // A package may import its own files and anything from outside the repository.
    inPackage('packages/cli', "import { messages } from './messages.js';"),
    inPackage('packages/cli', "import { z } from 'zod';"),
    inPackage('packages/cli', "import { readFile } from 'node:fs/promises';"),
    // The launcher may name the server in a dynamic import of the package name.
    inPackage('packages/cli', "const server = await import('@turnkeel/server');"),
    inPackage('packages/cli', "const entry = import.meta.resolve('@turnkeel/server');"),
    // A name that only starts like a package name is another package.
    inPackage('packages/mcp', "import { x } from '@turnkeel/core-utils';"),
    // Files outside every package are not checked.
    {
      code: "import { x } from '@turnkeel/db';",
      filename: `${root}/tooling/script.ts`,
      options: [boundaries],
    },
  ],
  invalid: [
    // No MIT package imports an AGPL one.
    {
      ...inPackage('packages/cli', "import { can } from '@turnkeel/core';"),
      errors: [{ messageId: 'licence' }],
    },
    {
      ...inPackage('packages/mcp', "import type { Db } from '@turnkeel/db';"),
      errors: [{ messageId: 'licence' }],
    },
    {
      ...inPackage('packages/protocol', "export { can } from '@turnkeel/core';"),
      errors: [{ messageId: 'licence' }],
    },
    {
      ...inPackage('packages/connector-sdk', "export * from '@turnkeel/core/permissions';"),
      errors: [{ messageId: 'licence' }],
    },
    {
      ...inPackage('packages/connectors/github', "import { x } from '@turnkeel/server';"),
      errors: [{ messageId: 'licence' }],
    },
    {
      ...inPackage('packages/mcp', "const core = await import('@turnkeel/core');"),
      errors: [{ messageId: 'licence' }],
    },
    {
      ...inPackage('packages/mcp', "type Can = import('@turnkeel/core').Can;"),
      errors: [{ messageId: 'licence' }],
    },
    {
      ...inPackage('packages/mcp', "import core = require('@turnkeel/core');"),
      errors: [{ messageId: 'licence' }],
    },
    // The launcher never imports the server statically, and never by a path inside it.
    {
      ...inPackage('packages/cli', "import { start } from '@turnkeel/server';"),
      errors: [{ messageId: 'dynamicOnly' }],
    },
    {
      ...inPackage('packages/cli', "const server = await import('@turnkeel/server/internal');"),
      errors: [{ messageId: 'dynamicOnly' }],
    },
    // The list of what each package may import.
    {
      ...inPackage('packages/core', "import { db } from '@turnkeel/db';"),
      errors: [{ messageId: 'notAllowed' }],
    },
    {
      ...inPackage('packages/connector-sdk', "import type { Ref } from '@turnkeel/protocol';"),
      errors: [{ messageId: 'notAllowed' }],
    },
    {
      ...inPackage('packages/connectors/github', "import type { Ref } from '@turnkeel/protocol';"),
      errors: [{ messageId: 'notAllowed' }],
    },
    {
      ...inPackage('apps/web', "import { db } from '@turnkeel/db';"),
      errors: [{ messageId: 'notAllowed' }],
    },
    {
      ...inPackage('apps/web', "import { app } from '@turnkeel/server';"),
      errors: [{ messageId: 'notAllowed' }],
    },
    {
      ...inPackage('apps/server', "import { main } from 'turnkeel';"),
      errors: [{ messageId: 'notAllowed' }],
    },
    // A relative path into another package gets round the package name.
    {
      ...inPackage('packages/cli', "import { can } from '../../core/src/index.js';"),
      errors: [{ messageId: 'relative' }],
    },
    {
      ...inPackage('packages/core', "import type { Ref } from '../../protocol/src/ref.js';"),
      errors: [{ messageId: 'relative' }],
    },
  ],
});

const noIo = {
  allowedBuiltins: ['crypto', 'util'],
  bannedPackages: ['pg', 'hono', '@hono/*'],
};

const pure = (code: string) => ({
  code,
  filename: `${root}/packages/core/src/file.ts`,
  options: [noIo],
});

ruleTester.run('turnkeel/no-io', noIoRule, {
  valid: [
    pure("import { z } from 'zod';"),
    pure("import type { Ref } from '@turnkeel/protocol';"),
    pure("import { createHash } from 'node:crypto';"),
    pure("import { isDeepStrictEqual } from 'util';"),
    pure("import { types } from 'node:util/types';"),
    pure("import { turn } from './turn.js';"),
    // A name that only starts like a banned one is another package.
    pure("import { x } from 'pg-format';"),
  ],
  invalid: [
    { ...pure("import { readFile } from 'node:fs/promises';"), errors: [{ messageId: 'builtin' }] },
    { ...pure("import fs from 'fs';"), errors: [{ messageId: 'builtin' }] },
    { ...pure("import { request } from 'node:https';"), errors: [{ messageId: 'builtin' }] },
    { ...pure("const net = await import('node:net');"), errors: [{ messageId: 'builtin' }] },
    { ...pure("import { DatabaseSync } from 'node:sqlite';"), errors: [{ messageId: 'builtin' }] },
    { ...pure("import pg from 'pg';"), errors: [{ messageId: 'banned' }] },
    { ...pure("import { Hono } from 'hono';"), errors: [{ messageId: 'banned' }] },
    { ...pure("import { cors } from 'hono/cors';"), errors: [{ messageId: 'banned' }] },
    { ...pure("import { serve } from '@hono/node-server';"), errors: [{ messageId: 'banned' }] },
    { ...pure("export { Pool } from 'pg';"), errors: [{ messageId: 'banned' }] },
  ],
});

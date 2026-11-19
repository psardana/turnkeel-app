// @ts-check

/**
 * Who may import whom, which licence each package has and which are published.
 * The lint rule `turnkeel/boundaries` and the test in tooling/workspace.test.ts read it.
 */

export const MIT = 'MIT';
export const AGPL = 'AGPL-3.0-only';

/**
 * @typedef {object} PackageRule
 * @property {string} name The package name.
 * @property {string} dir Its folder, relative to the repository root.
 * @property {string} license `MIT` or `AGPL-3.0-only`.
 * @property {boolean} published Whether it is one of the published packages.
 * @property {readonly string[] | 'every-package-except-cli'} mayImport The workspace packages it may import.
 * @property {readonly string[]} [dynamicOnly] Packages it may name only in `import('<name>')`.
 * @property {readonly string[]} [mayDependOn] Packages it may list in package.json without importing them.
 */

/** @type {readonly PackageRule[]} */
export const packageRules = [
  {
    name: '@turnkeel/protocol',
    dir: 'packages/protocol',
    license: MIT,
    published: true,
    mayImport: [],
  },
  {
    name: '@turnkeel/core',
    dir: 'packages/core',
    license: AGPL,
    published: false,
    mayImport: ['@turnkeel/protocol'],
  },
  {
    name: '@turnkeel/db',
    dir: 'packages/db',
    license: AGPL,
    published: false,
    mayImport: ['@turnkeel/protocol', '@turnkeel/core'],
  },
  {
    name: '@turnkeel/markdown',
    dir: 'packages/markdown',
    license: AGPL,
    published: false,
    mayImport: [],
  },
  {
    name: '@turnkeel/connector-sdk',
    dir: 'packages/connector-sdk',
    license: MIT,
    published: true,
    mayImport: [],
  },
  {
    name: '@turnkeel/mcp',
    dir: 'packages/mcp',
    license: MIT,
    published: true,
    mayImport: ['@turnkeel/protocol'],
  },
  {
    // The launcher starts the server as a separate process. It finds the entry point
    // through the published package name and never imports the server's code statically.
    name: 'turnkeel',
    dir: 'packages/cli',
    license: MIT,
    published: true,
    mayImport: ['@turnkeel/protocol'],
    dynamicOnly: ['@turnkeel/server'],
    mayDependOn: ['@turnkeel/server'],
  },
  {
    // The server serves the web app's build and carries it in its package, so it is
    // built after the web app. It lists the web app for that order and never imports it.
    name: '@turnkeel/server',
    dir: 'apps/server',
    license: AGPL,
    published: true,
    mayImport: 'every-package-except-cli',
    mayDependOn: ['@turnkeel/web'],
  },
  {
    name: '@turnkeel/web',
    dir: 'apps/web',
    license: AGPL,
    published: false,
    mayImport: ['@turnkeel/protocol', '@turnkeel/core', '@turnkeel/markdown'],
  },
];

/** Every folder in here is one connector: MIT, and it imports the connector SDK only. */
export const connectorsDir = 'packages/connectors';
export const connectorNamePrefix = '@turnkeel/connector-';
export const connectorMayImport = ['@turnkeel/connector-sdk'];

/**
 * The rule for one workspace package, or undefined when the table does not know it.
 *
 * @param {{ name: string, dir: string }} pkg
 * @returns {PackageRule | undefined}
 */
export function ruleFor(pkg) {
  if (pkg.dir.startsWith(`${connectorsDir}/`)) {
    return {
      name: pkg.name,
      dir: pkg.dir,
      license: MIT,
      published: false,
      mayImport: connectorMayImport,
    };
  }
  return packageRules.find((rule) => rule.name === pkg.name && rule.dir === pkg.dir);
}

/**
 * The names of the workspace packages that `pkg` may import. A package the table does
 * not know may import nothing.
 *
 * @param {{ name: string, dir: string }} pkg
 * @param {readonly { name: string, dir: string }[]} packages Every workspace package.
 * @returns {string[]}
 */
export function allowedImports(pkg, packages) {
  const rule = ruleFor(pkg);
  if (!rule) return [];
  if (rule.mayImport === 'every-package-except-cli') {
    return packages
      .filter((other) => other.dir.startsWith('packages/') && other.dir !== 'packages/cli')
      .map((other) => other.name);
  }
  return [...rule.mayImport];
}

/**
 * Node built-ins that do no I/O. `protocol` and `core` may import these and no other built-in.
 */
export const pureBuiltins = [
  'assert',
  'buffer',
  'crypto',
  'events',
  'path',
  'punycode',
  'querystring',
  'string_decoder',
  'url',
  'util',
];

/**
 * Database drivers, HTTP libraries and other packages whose job is I/O. `protocol` and
 * `core` may not import them. A name that ends in `/*` covers a whole scope.
 */
export const ioPackages = [
  // Databases and jobs
  '@electric-sql/*',
  '@libsql/*',
  '@neondatabase/*',
  '@prisma/*',
  'better-sqlite3',
  'drizzle-kit',
  'drizzle-orm',
  'ioredis',
  'knex',
  'kysely',
  'mongodb',
  'mysql2',
  'pg',
  'pg-boss',
  'pg-pool',
  'postgres',
  'prisma',
  'redis',
  'sqlite3',
  // HTTP, sockets, mail and object storage
  '@aws-sdk/*',
  '@hono/*',
  '@modelcontextprotocol/*',
  'axios',
  'better-auth',
  'express',
  'fastify',
  'got',
  'hono',
  'ky',
  'node-fetch',
  'nodemailer',
  'undici',
  'ws',
];

/** Globals that do I/O. `protocol` and `core` may not use them. */
export const ioGlobals = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];

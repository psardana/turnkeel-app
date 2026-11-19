// @ts-check
import {
  allowedImports,
  ioGlobals,
  ioPackages,
  packageRules,
  pureBuiltins,
} from '../boundaries.js';
import { readWorkspacePackages, repoRoot } from '../workspace.js';
import { boundariesRule } from './boundaries-rule.js';
import { noIoRule } from './no-io-rule.js';

/** The repository's own lint rules. */
export const turnkeelPlugin = {
  meta: { name: 'turnkeel' },
  rules: {
    boundaries: boundariesRule,
    'no-io': noIoRule,
  },
};

/** The packages that hold no I/O: their sources, without their tests. */
const pureSources = ['packages/protocol/src/**', 'packages/core/src/**'];

/**
 * The lint configuration that keeps the package boundaries of tooling/boundaries.js.
 * The root eslint.config.js spreads it in; tooling/eslint/config.test.ts runs it.
 *
 * @param {string} [root] The repository root.
 * @returns {import('eslint').Linter.Config[]}
 */
export function boundaryConfigs(root = repoRoot) {
  const packages = readWorkspacePackages(root);

  /** @type {Record<string, string[]>} */
  const allow = {};
  /** @type {Record<string, string[]>} */
  const dynamicOnly = {};
  for (const pkg of packages) {
    allow[pkg.name] = allowedImports(pkg, packages);
    const rule = packageRules.find((candidate) => candidate.name === pkg.name);
    if (rule?.dynamicOnly) dynamicOnly[pkg.name] = [...rule.dynamicOnly];
  }

  return [
    {
      name: 'turnkeel/boundaries',
      files: ['packages/**/*.{js,mjs,ts,tsx}', 'apps/**/*.{js,mjs,ts,tsx}'],
      plugins: { turnkeel: turnkeelPlugin },
      rules: {
        'turnkeel/boundaries': [
          'error',
          {
            root,
            packages: packages.map(({ name, dir, license }) => ({ name, dir, license })),
            allow,
            dynamicOnly,
          },
        ],
      },
    },
    {
      name: 'turnkeel/no-io',
      files: pureSources,
      ignores: ['**/*.test.{ts,tsx}'],
      plugins: { turnkeel: turnkeelPlugin },
      rules: {
        'turnkeel/no-io': ['error', { allowedBuiltins: pureBuiltins, bannedPackages: ioPackages }],
        'no-restricted-globals': [
          'error',
          ...ioGlobals.map((name) => ({
            name,
            message:
              'This package does no I/O. The caller does the request and passes the result in.',
          })),
        ],
      },
    },
  ];
}

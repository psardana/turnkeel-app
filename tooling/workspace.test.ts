import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGPL,
  MIT,
  allowedImports,
  connectorNamePrefix,
  packageRules,
  ruleFor,
} from './boundaries.js';
import { readWorkspacePackages, repoRoot } from './workspace.js';

/**
 * The package.json files against the package rules of tooling/boundaries.js.
 */
const packages = readWorkspacePackages();
const names = new Set(packages.map((pkg) => pkg.name));

const read = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), 'utf8');

function workspaceDependencies(manifest: Record<string, unknown>, field: string): string[] {
  const dependencies = (manifest[field] ?? {}) as Record<string, string>;
  return Object.keys(dependencies).filter((name) => names.has(name));
}

describe('the workspace', () => {
  it('has every package of the table that is built so far, and no other', () => {
    const known = packageRules.map((rule) => rule.dir);
    for (const pkg of packages) {
      expect(ruleFor(pkg), `${pkg.dir} is not in tooling/boundaries.js`).toBeDefined();
    }
    const notBuiltYet = known.filter((dir) => !packages.some((pkg) => pkg.dir === dir));
    expect(notBuiltYet).toEqual([]);
  });

  it('has an engines.node of >=22.12 in the root package', () => {
    const root = JSON.parse(read('package.json')) as { engines?: { node?: string } };
    expect(root.engines?.node).toBe('>=22.12');
  });

  it('has the AGPL-3.0 text in the root LICENSE', () => {
    const text = read('LICENSE');
    expect(text).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(text).toContain('Version 3, 19 November 2007');
  });
});

describe.each(packages)('$dir', (pkg) => {
  const rule = ruleFor(pkg);
  const manifest = pkg.manifest;

  it('has the name and the licence of the table', () => {
    expect(rule).toBeDefined();
    expect(pkg.license).toBe(rule?.license);
    expect([MIT, AGPL]).toContain(pkg.license);
    if (pkg.dir.startsWith('packages/connectors/')) {
      expect(pkg.name.startsWith(connectorNamePrefix)).toBe(true);
    }
  });

  it('is an ES module at version 0.0.0 with exports', () => {
    expect(manifest.type).toBe('module');
    expect(manifest.version).toBe('0.0.0');
    expect(manifest.exports).toBeDefined();
    expect(existsSync(path.join(repoRoot, pkg.dir, 'src', 'index.ts'))).toBe(true);
  });

  it('is private unless it is one of the published packages', () => {
    expect(manifest.private === true).toBe(rule?.published === false);
  });

  it('carries the MIT text when it is under MIT', () => {
    const licenceFile = path.join(repoRoot, pkg.dir, 'LICENSE');
    if (pkg.license === MIT) {
      const text = readFileSync(licenceFile, 'utf8');
      expect(text).toMatch(/^MIT License\n/);
      expect(text).toContain('Copyright (c) 2026 Piyush Sardana and Turnkeel contributors');
    } else {
      expect(existsSync(licenceFile)).toBe(false);
    }
  });

  it('depends only on the workspace packages it may import', () => {
    const allowed = new Set([...allowedImports(pkg, packages), ...(rule?.mayDependOn ?? [])]);
    const declared = [
      ...workspaceDependencies(manifest, 'dependencies'),
      ...workspaceDependencies(manifest, 'devDependencies'),
      ...workspaceDependencies(manifest, 'peerDependencies'),
      ...workspaceDependencies(manifest, 'optionalDependencies'),
    ];
    for (const name of declared) {
      expect(allowed.has(name), `${pkg.name} lists ${name}`).toBe(true);
    }
  });

  it('does not make a published package depend on a private one at run time', () => {
    if (rule?.published !== true) return;
    for (const name of workspaceDependencies(manifest, 'dependencies')) {
      const target = packages.find((other) => other.name === name);
      expect(target?.manifest.private, `${pkg.name} depends on ${name}`).not.toBe(true);
    }
  });
});

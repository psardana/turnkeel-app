// @ts-check
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, as an absolute path. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The folders whose sub-folders are workspace packages, as in pnpm-workspace.yaml. */
export const packageParents = ['packages', 'packages/connectors', 'apps'];

/**
 * @typedef {object} WorkspacePackage
 * @property {string} name The `name` field of its package.json.
 * @property {string} dir Its folder, relative to the repository root, with forward slashes.
 * @property {string} license The `license` field of its package.json.
 * @property {Record<string, unknown>} manifest The whole package.json.
 */

/**
 * Reads the package.json of every workspace package.
 *
 * @param {string} [root]
 * @returns {WorkspacePackage[]}
 */
export function readWorkspacePackages(root = repoRoot) {
  /** @type {WorkspacePackage[]} */
  const found = [];

  for (const parent of packageParents) {
    const parentPath = path.join(root, parent);
    if (!existsSync(parentPath)) continue;

    for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const manifestPath = path.join(parentPath, entry.name, 'package.json');
      if (!existsSync(manifestPath)) continue;

      const manifest = /** @type {Record<string, unknown>} */ (
        JSON.parse(readFileSync(manifestPath, 'utf8'))
      );
      const dir = `${parent}/${entry.name}`;
      if (typeof manifest.name !== 'string' || typeof manifest.license !== 'string') {
        throw new Error(`${dir}/package.json needs a "name" and a "license".`);
      }
      found.push({ name: manifest.name, dir, license: manifest.license, manifest });
    }
  }

  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

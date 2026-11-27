import { fileURLToPath } from 'node:url';

/**
 * The file that is the Turnkeel server: the entry of the separately packaged
 * `@turnkeel/server`, which `turnkeel` names as a dependency. The launcher looks the
 * file up and starts it as a process of its own. It imports nothing from it, so no
 * server code is ever part of this package.
 *
 * Undefined when the package is not installed.
 */
export function findServerEntry(): string | undefined {
  try {
    return fileURLToPath(import.meta.resolve('@turnkeel/server'));
  } catch {
    return undefined;
  }
}

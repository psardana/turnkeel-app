// @ts-check
/**
 * Copies the licence of each bundled typeface into public/licenses, so that it ships
 * with the build next to the font files. IBM Plex is under the
 * SIL Open Font License 1.1, which asks for its text to go with the fonts.
 *
 * The `build` script of apps/web runs this before `vite build`, because Vite copies
 * public/ as it is and takes nothing out of node_modules by itself. The copies are
 * written by the build and are not committed.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(web, 'public', 'licenses');
const require = createRequire(path.join(web, 'package.json'));

/** The package of each typeface, and the name its licence gets in the build. */
const fonts = [
  { pkg: '@fontsource/ibm-plex-sans', file: 'ibm-plex-sans.txt' },
  { pkg: '@fontsource/ibm-plex-mono', file: 'ibm-plex-mono.txt' },
];

await mkdir(target, { recursive: true });
for (const { pkg, file } of fonts) {
  // Both packages export their licence as `<package>/LICENSE`.
  await copyFile(require.resolve(`${pkg}/LICENSE`), path.join(target, file));
}

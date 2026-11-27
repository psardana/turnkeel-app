import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * No font host. The fonts are files of the web build, and the
 * built files name no other host for a font or a stylesheet. The service worker keeps
 * every `woff2` file of the build, so an installed app starts with its own type.
 *
 * `pnpm test:e2e` builds the web app first, so `apps/web/dist` is the build under test.
 */
const dist = path.join(import.meta.dirname, '..', 'apps', 'web', 'dist');

async function filesIn(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dist, path.join(entry.parentPath, entry.name)));
}

const textFile = /\.(html|js|css|webmanifest|json)$/;

/** An address of another host for a font or a stylesheet. */
const foreignFontOrStyle = [
  // A font or stylesheet file by its address.
  /https?:\/\/[^\s"'`()<>]+\.(?:woff2?|ttf|otf|eot|css)\b/gi,
  // A stylesheet that imports or loads from another host.
  /@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//gi,
  /url\(\s*["']?(?:https?:)?\/\//gi,
  /<link[^>]+href=["'](?:https?:)?\/\//gi,
  // The font hosts by name.
  /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|rsms\.me/gi,
];

test.describe('the web build', () => {
  test.skip(({ isMobile }) => isMobile, 'The build is the same for every viewport.');

  test('names no other host for a font or a stylesheet', async () => {
    const files = (await filesIn(dist)).filter((file) => textFile.test(file));
    expect(files.length).toBeGreaterThan(5);
    const found: string[] = [];
    for (const file of files) {
      const text = await readFile(path.join(dist, file), 'utf8');
      for (const pattern of foreignFontOrStyle) {
        for (const match of text.matchAll(pattern)) found.push(`${file}: ${match[0]}`);
      }
    }
    expect(found).toEqual([]);
  });

  test('has the two typefaces as its own files, and the service worker keeps every woff2', async () => {
    const files = await filesIn(dist);
    const woff2 = files.filter((file) => file.endsWith('.woff2'));
    expect(woff2.some((file) => /ibm-plex-sans-latin-400-normal/.test(file))).toBe(true);
    expect(woff2.some((file) => /ibm-plex-sans-latin-600-normal/.test(file))).toBe(true);
    expect(woff2.some((file) => /ibm-plex-mono-latin-400-normal/.test(file))).toBe(true);
    // Only the weights the design guide lists (3.1): no 700, no mono other than 400.
    expect(woff2.filter((file) => /-700-|-mono-[^/]*-(?:500|600)-/.test(file))).toEqual([]);

    const worker = await readFile(path.join(dist, 'sw.js'), 'utf8');
    const missing = woff2.filter((file) => !worker.includes(`"${file}"`));
    expect(missing).toEqual([]);
    // The `.woff` fallbacks are not kept.
    expect(worker).not.toMatch(/\.woff"/);

    // The fonts' licence ships with the build and is kept too.
    for (const licence of ['licenses/ibm-plex-sans.txt', 'licenses/ibm-plex-mono.txt']) {
      expect(files).toContain(licence);
      expect(worker).toContain(`"${licence}"`);
      expect(await readFile(path.join(dist, licence), 'utf8')).toContain(
        'SIL Open Font License, Version 1.1',
      );
    }
  });
});

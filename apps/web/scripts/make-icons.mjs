// @ts-check
/**
 * Makes the PNG icons of the web app from its SVG mark, by drawing the SVG in
 * Chromium at each size. Run it after the mark changes:
 *
 *   node apps/web/scripts/make-icons.mjs
 *
 * The PNG files are committed, so nothing runs this during a build.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const icons = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/** @type {{ file: string, from: string, size: number }[]} */
const targets = [
  { file: 'icon-192.png', from: 'mark.svg', size: 192 },
  { file: 'icon-512.png', from: 'mark.svg', size: 512 },
  { file: 'maskable-512.png', from: 'maskable.svg', size: 512 },
  // iOS draws its own corners, so this one is a full square.
  { file: 'apple-touch-icon.png', from: 'maskable.svg', size: 180 },
];

const browser = await chromium.launch();
try {
  for (const { file, from, size } of targets) {
    const svg = await readFile(path.join(icons, from), 'utf8');
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({ path: path.join(icons, file), omitBackground: true });
    await page.close();
    console.log(`${file} (${size} x ${size})`);
  }
} finally {
  await browser.close();
}

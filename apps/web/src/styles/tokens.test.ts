import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { themeColors } from '@/lib/theme';

/**
 * The colour tokens, as src/styles/app.css has them for the
 * light theme (`:root`) and the dark one (`.dark`). A token the dark theme does not
 * name keeps its light value, which is a `var()` of another token.
 */
const web = path.resolve(import.meta.dirname, '../..');
const css = readFileSync(path.join(web, 'src/styles/app.css'), 'utf8');

/** The custom properties declared in the first rule with this selector. */
function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `app.css has no ${selector} rule`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  const body = css.slice(start, end);
  return new Map(
    [...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((match) => [
      match[1] ?? '',
      (match[2] ?? '').trim(),
    ]),
  );
}

const light = {
  '--background': '#ffffff',
  '--popover': '#ffffff',
  '--card': '#ffffff',
  '--muted': '#f4f4f5',
  '--secondary': '#f4f4f5',
  '--accent': '#f4f4f5',
  '--selected': '#e6f4f1',
  '--border': '#e4e4e7',
  '--border-strong': '#d4d4d8',
  '--input': '#8a8a93',
  '--foreground': '#18181b',
  '--foreground-soft': '#3f3f46',
  '--muted-foreground': '#52525b',
  '--primary': '#0f766e',
  '--primary-hover': '#115e59',
  '--primary-foreground': '#ffffff',
  '--ring': '#0f766e',
  '--state-passed': 'var(--foreground-soft)',
  '--state-open': 'var(--primary)',
  '--state-changes': '#92400e',
  '--state-failed': 'var(--destructive)',
  '--destructive': '#b91c1c',
  '--destructive-hover': '#991b1b',
  '--destructive-foreground': '#ffffff',
  '--state-new': 'var(--primary)',
  '--state-new-foreground': 'var(--primary-foreground)',
  '--raised-shadow': '0 8px 24px rgb(0 0 0 / 0.12)',
  '--radius': '0.375rem',
};

const dark = {
  '--background': '#18181b',
  '--popover': '#1f1f23',
  '--card': '#1f1f23',
  '--muted': '#27272a',
  '--secondary': '#27272a',
  '--accent': '#27272a',
  '--selected': '#12302d',
  '--border': '#303036',
  '--border-strong': '#3f3f46',
  '--input': '#85858f',
  '--foreground': '#f4f4f5',
  '--foreground-soft': '#d4d4d8',
  '--muted-foreground': '#a1a1aa',
  '--primary': '#14b8a6',
  '--primary-hover': '#2dd4bf',
  '--primary-foreground': '#042f2e',
  '--ring': '#14b8a6',
  '--state-changes': '#fbbf24',
  '--destructive': '#f87171',
  '--destructive-hover': '#fca5a5',
  '--destructive-foreground': '#18181b',
  '--raised-shadow': '0 8px 24px rgb(0 0 0 / 0.5)',
};

describe('the design tokens', () => {
  it('has every token of the light theme with its value', () => {
    const root = block(':root');
    expect(Object.fromEntries(Object.keys(light).map((name) => [name, root.get(name)]))).toEqual(
      light,
    );
  });

  it('has every colour of the dark theme with its value', () => {
    const night = block('.dark');
    expect(Object.fromEntries(Object.keys(dark).map((name) => [name, night.get(name)]))).toEqual(
      dark,
    );
  });

  it('maps the tokens to the names Tailwind and shadcn/ui use', () => {
    const theme = block('@theme inline');
    for (const name of [
      'background',
      'foreground',
      'foreground-soft',
      'popover',
      'muted',
      'muted-foreground',
      'accent',
      'selected',
      'primary',
      'primary-hover',
      'primary-foreground',
      'border',
      'border-strong',
      'input',
      'ring',
      'destructive',
      'destructive-hover',
      'destructive-foreground',
      'state-passed',
      'state-open',
      'state-changes',
      'state-failed',
      'state-new',
      'state-new-foreground',
    ]) {
      expect(theme.get(`--color-${name}`), name).toBe(`var(--${name})`);
    }
    expect(theme.get('--font-sans')).toBe('var(--font-ui)');
    expect(theme.get('--font-mono')).toBe('var(--font-code)');
    expect(theme.get('--shadow-raised')).toBe('var(--raised-shadow)');
  });

  it('sets the two typefaces first in their stacks', () => {
    const root = block(':root');
    expect(root.get('--font-ui')).toMatch(/^'IBM Plex Sans',/);
    expect(root.get('--font-code')).toMatch(/^'IBM Plex Mono',/);
  });

  it('keeps the two rules that hold the contrast: selected text and the underline of a link', () => {
    expect(css).toMatch(
      /::selection\s*{\s*background: var\(--primary\);\s*color: var\(--primary-foreground\);/,
    );
    expect(css).toMatch(/@utility link\s*{[^}]*text-decoration-color: currentColor;/);
    expect(css).not.toMatch(/color-mix\(/);
  });
});

describe('the theme colour of the browser', () => {
  it('is the ground of each theme, in all four places that name it', () => {
    expect(themeColors).toEqual({ light: '#ffffff', dark: '#18181b' });
    expect(block(':root').get('--background')).toBe(themeColors.light);
    expect(block('.dark').get('--background')).toBe(themeColors.dark);

    const html = readFileSync(path.join(web, 'index.html'), 'utf8');
    expect(html).toContain(`<meta name="theme-color" content="${themeColors.light}" />`);
    const init = readFileSync(path.join(web, 'public/theme-init.js'), 'utf8');
    expect(init).toContain(`dark ? '${themeColors.dark}' : '${themeColors.light}'`);
    const vite = readFileSync(path.join(web, 'vite.config.ts'), 'utf8');
    expect(vite).toContain(`background_color: '${themeColors.light}'`);
    expect(vite).toContain(`theme_color: '${themeColors.light}'`);
  });

  it('keeps the fonts and their licence in the service worker, and not the woff fallbacks', () => {
    const vite = readFileSync(path.join(web, 'vite.config.ts'), 'utf8');
    expect(vite).toMatch(/globPatterns: \['\*\*\/\*\.\{[^}]*\bwoff2\b[^}]*\btxt\b[^}]*\}'\]/);
    expect(vite).not.toMatch(/globPatterns: \['\*\*\/\*\.\{[^}]*\bwoff\b[,}]/);
  });
});

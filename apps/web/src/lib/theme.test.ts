import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInThisContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  createThemeController,
  DARK_QUERY,
  readThemeChoice,
  resolveTheme,
  THEME_STORAGE_KEY,
  themeColors,
  type ThemeChoice,
} from './theme';

/** A `matchMedia` result whose answer a test can change. */
function fakeMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  return {
    matches,
    addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
    set(next: boolean) {
      this.matches = next;
      for (const listener of listeners) listener();
    },
    listeners,
  };
}

function setup(options: { stored?: string; systemDark?: boolean } = {}) {
  if (options.stored !== undefined) window.localStorage.setItem(THEME_STORAGE_KEY, options.stored);
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff" />';
  const media = fakeMedia(options.systemDark ?? false);
  const controller = createThemeController({
    document,
    storage: window.localStorage,
    media: media as unknown as MediaQueryList,
  });
  return { controller, media };
}

const isDark = () => document.documentElement.classList.contains('dark');

describe('the theme', () => {
  it('is Light unless the person picked something else', () => {
    expect(readThemeChoice(window.localStorage)).toBe('light');
    const { controller } = setup({ systemDark: true });
    expect(controller.get()).toEqual({ choice: 'light', resolved: 'light' });
    expect(isDark()).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('reads a stored choice and ignores a stored value it does not know', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readThemeChoice(window.localStorage)).toBe('dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readThemeChoice(window.localStorage)).toBe('light');
    expect(readThemeChoice(null)).toBe('light');
    expect(
      readThemeChoice({
        getItem() {
          throw new Error('blocked');
        },
      }),
    ).toBe('light');
  });

  it('resolves System by what the device prefers', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('applies a pick at once, keeps it, and tells its listeners', () => {
    const { controller } = setup();
    let calls = 0;
    controller.subscribe(() => {
      calls += 1;
    });

    controller.set('dark');
    expect(isDark()).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      themeColors.dark,
    );
    expect(controller.get()).toEqual({ choice: 'dark', resolved: 'dark' });
    expect(calls).toBe(1);

    controller.set('light');
    expect(isDark()).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(calls).toBe(2);
  });

  it('follows the device while the choice is System, and only then', () => {
    const { controller, media } = setup({ stored: 'system', systemDark: false });
    expect(controller.get()).toEqual({ choice: 'system', resolved: 'light' });

    media.set(true);
    expect(isDark()).toBe(true);
    expect(controller.get().resolved).toBe('dark');

    controller.set('light');
    media.set(false);
    media.set(true);
    expect(isDark()).toBe(false);
  });

  it('still switches when the choice cannot be stored', () => {
    const media = fakeMedia(false);
    const controller = createThemeController({
      document,
      storage: {
        getItem: () => null,
        setItem() {
          throw new Error('full');
        },
      },
      media: media as unknown as MediaQueryList,
    });
    controller.set('dark');
    expect(isDark()).toBe(true);
  });

  it('stops listening to the device when it is disposed', () => {
    const { controller, media } = setup({ stored: 'system' });
    controller.dispose();
    expect(media.listeners.size).toBe(0);
  });
});

/**
 * public/theme-init.js sets the theme before the first paint. It is a separate
 * classic script, so this runs it as the browser would and compares it with the rule
 * above for every choice.
 */
describe('public/theme-init.js', () => {
  const script = readFileSync(
    path.resolve(import.meta.dirname, '../../public/theme-init.js'),
    'utf8',
  );

  const run = (stored: string | null, systemDark: boolean) => {
    window.localStorage.clear();
    if (stored !== null) window.localStorage.setItem(THEME_STORAGE_KEY, stored);
    document.documentElement.className = '';
    document.head.innerHTML = '<meta name="theme-color" content="" />';
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === DARK_QUERY && systemDark,
    }));
    try {
      // As a classic script in the page: it reads `window` and `document` and nothing else.
      runInThisContext(script);
    } finally {
      vi.unstubAllGlobals();
    }
  };

  const stored: (ThemeChoice | 'sepia' | null)[] = [null, 'light', 'dark', 'system', 'sepia'];

  it.each(stored.flatMap((choice) => [true, false].map((dark) => [choice, dark] as const)))(
    'agrees with the app for a stored choice of %s when the device prefers dark: %s',
    (choice, systemDark) => {
      run(choice, systemDark);
      const expected = resolveTheme(readThemeChoice(window.localStorage), systemDark);
      expect(isDark()).toBe(expected === 'dark');
      expect(document.documentElement.style.colorScheme).toBe(expected);
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
        themeColors[expected],
      );
    },
  );

  it('uses the same storage key as the app', () => {
    expect(script).toContain(`'${THEME_STORAGE_KEY}'`);
  });
});

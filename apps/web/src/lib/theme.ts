/**
 * Light, Dark or System, with Light as the default. The choice is
 * kept in this browser. `public/theme-init.js` applies the same rule before the first
 * paint; a test keeps the two in step.
 */
export const themeChoices = ['light', 'dark', 'system'] as const;

export type ThemeChoice = (typeof themeChoices)[number];
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'turnkeel.theme';
export const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * The colour the browser paints its own bars with, per theme: the ground of each
 * theme. index.html, public/theme-init.js and the manifest in
 * vite.config.ts name the same values, and a test holds them together.
 */
export const themeColors: Record<ResolvedTheme, string> = { light: '#ffffff', dark: '#18181b' };

const isChoice = (value: unknown): value is ThemeChoice =>
  typeof value === 'string' && (themeChoices as readonly string[]).includes(value);

/** What the person picked, or Light when they picked nothing or storage cannot be read. */
export function readThemeChoice(storage: Pick<Storage, 'getItem'> | null): ThemeChoice {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return isChoice(stored) ? stored : 'light';
  } catch {
    return 'light';
  }
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}

export function applyTheme(doc: Document, theme: ResolvedTheme): void {
  const root = doc.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[theme]);
}

export interface ThemeState {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
}

export interface ThemeController {
  get(): ThemeState;
  /** Picks a theme, keeps the choice and applies it at once. */
  set(choice: ThemeChoice): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export interface ThemeEnvironment {
  document: Document;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  media: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'> | null;
}

/** The theme of the running app. With System it follows the device as it changes. */
export function createThemeController(env: ThemeEnvironment): ThemeController {
  const listeners = new Set<() => void>();
  const prefersDark = () => env.media?.matches ?? false;

  let choice = readThemeChoice(env.storage);
  let state: ThemeState = { choice, resolved: resolveTheme(choice, prefersDark()) };

  const update = () => {
    const resolved = resolveTheme(choice, prefersDark());
    applyTheme(env.document, resolved);
    if (state.choice !== choice || state.resolved !== resolved) {
      state = { choice, resolved };
      for (const listener of listeners) listener();
    }
  };

  const onSystemChange = () => {
    if (choice === 'system') update();
  };
  env.media?.addEventListener('change', onSystemChange);
  applyTheme(env.document, state.resolved);

  return {
    get: () => state,
    set(next) {
      choice = next;
      try {
        env.storage?.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Storage is full or blocked: the choice holds for this page.
      }
      update();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      env.media?.removeEventListener('change', onSystemChange);
      listeners.clear();
    },
  };
}

let shared: ThemeController | undefined;

/** The one controller of this page. */
export function themeController(): ThemeController {
  if (!shared) {
    let storage: Storage | null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    shared = createThemeController({
      document,
      storage,
      media: typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null,
    });
  }
  return shared;
}

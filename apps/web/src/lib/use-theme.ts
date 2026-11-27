import { useSyncExternalStore } from 'react';
import { themeController, type ThemeChoice, type ThemeState } from '@/lib/theme';

/** The theme of the page, and how to change it. */
export function useTheme(): ThemeState & { setTheme: (choice: ThemeChoice) => void } {
  const controller = themeController();
  const state = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.get(),
    () => controller.get(),
  );
  return { ...state, setTheme: (choice) => controller.set(choice) };
}

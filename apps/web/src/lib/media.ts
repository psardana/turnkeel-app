import { useSyncExternalStore } from 'react';

/** Below 640 px the phone layout starts. */
export const PHONE_QUERY = '(max-width: 639.98px)';

/** Whether a media query matches now. It follows the window as it changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
      media?.addEventListener('change', listener);
      return () => media?.removeEventListener('change', listener);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** True below 640 px: the top bar and the bottom bar in place of the header. */
export function usePhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}

import { useRouter } from '@tanstack/react-router';

/**
 * For a dialog that is opened by state and not by a trigger of its own: remembers
 * what had the focus when it opened and gives the focus back when it closes, so a
 * person on the keyboard is where they were. A dialog opened from a menu item, which
 * is gone by then, names with `fallback` where the focus goes instead, such as the
 * menu's button; a fallback that gives null leaves the focus to the page, as after a
 * write that moves to another view.
 */
export function useReturnFocus(fallback?: () => HTMLElement | null) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const element = opener.current;
      opener.current = null;
      if (fallback) {
        event.preventDefault();
        fallback()?.focus();
        return;
      }
      if (element?.isConnected) {
        event.preventDefault();
        element.focus();
      }
    },
  };
}

/**
 * For a sheet that shows an item: when it opens, the focus goes to the item's title,
 * which has `tabindex="-1"`, not to the sheet's Close. The title
 * may appear only once the item has loaded: until then the sheet itself holds the focus,
 * and the title takes it when it appears. Pass `onOpenAutoFocus` to the sheet and
 * `titleRef` to the title.
 */
export function useSheetTitleFocus(titleId: string) {
  const waiting = useRef(false);
  const titleRef = useCallback((node: HTMLElement | null) => {
    if (!node || !waiting.current) return;
    waiting.current = false;
    node.focus({ preventScroll: true });
  }, []);
  const onOpenAutoFocus = (event: Event) => {
    event.preventDefault();
    const title = document.getElementById(titleId);
    if (title) {
      title.focus({ preventScroll: true });
      return;
    }
    waiting.current = true;
    (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
  };
  return { titleRef, onOpenAutoFocus };
}

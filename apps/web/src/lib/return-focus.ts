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

/** Focus on the `h1` of the view that is shown, which has `tabindex="-1"`. */
export function focusViewHeading(): void {
  document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
}

/** How long after a move to another view a heading that appears late still takes focus. */
const HEADING_FOCUS_WINDOW_MS = 10_000;

/**
 * For a menu or a sheet whose entries can lead to another view. Radix gives the focus
 * back to the button that opened it once it has closed, which comes after the new
 * view has taken it, so the new view would lose it again. When the path changed while
 * it was open, the focus goes to the new view's `h1` instead;
 * when it did not, such as after a filter or Escape, it goes back to the button.
 */
export function useNavigatingMenuFocus() {
  const router = useRouter();
  const pathAtOpen = useRef<string | null>(null);
  return {
    onOpenChange: (open: boolean) => {
      if (open) pathAtOpen.current = router.latestLocation.pathname;
    },
    onCloseAutoFocus: (event: Event) => {
      const before = pathAtOpen.current;
      pathAtOpen.current = null;
      if (before !== null && before !== router.latestLocation.pathname) {
        event.preventDefault();
        focusViewHeading();
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

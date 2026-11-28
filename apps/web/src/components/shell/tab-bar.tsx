import { Link, useMatchRoute } from '@tanstack/react-router';
import { ChevronDownIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { CountPill } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { foldedCount, foldTabs } from '@/lib/fold';
import { useNavigatingMenuFocus } from '@/lib/return-focus';
import { cn } from '@/lib/utils';
import { messages } from '@/messages';
import type { NavItem } from '@/navigation';

/** A tab with the number of its items that wait on the viewer, when it has one. */
export interface TabEntry {
  item: NavItem;
  count?: number | undefined;
}

/** The index of the tab whose view is open, or -1 on a page that belongs to no tab. */
export function useCurrentTab(entries: readonly TabEntry[], slug: string): number {
  const matchRoute = useMatchRoute();
  return entries.findIndex(
    (entry) => matchRoute({ to: entry.item.to, params: { ws: slug }, fuzzy: true }) !== false,
  );
}

const tabClass =
  'flex h-tabbar shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 whitespace-nowrap text-foreground-soft transition-colors hover:border-border-strong hover:text-foreground';

const currentClass =
  'aria-[current=page]:border-primary aria-[current=page]:font-semibold aria-[current=page]:text-primary aria-[current=page]:hover:border-primary';

/** The divider after Your turn, with 6 px on each side. */
function Divider() {
  return <span aria-hidden="true" className="mx-1.5 h-5 w-px shrink-0 self-center bg-border" />;
}

function TabLabel({ entry }: { entry: TabEntry }) {
  return (
    <>
      <span aria-hidden="true">{entry.item.label}</span>
      <CountPill count={entry.count} />
    </>
  );
}

/**
 * The tab bar of a workspace, from 640 px up: a list of links,
 * one per tab, each a page with its own URL, so it is a `<nav>` and not a `tablist`.
 * Tabs that do not fit fold, from the end, into More. The widths are measured on a
 * copy of the tabs that nobody sees, whenever the bar or the copy changes size.
 */
export function TabBar({
  entries,
  slug,
  project = null,
}: {
  entries: readonly TabEntry[];
  slug: string;
  /** The project the URL names; a tab opens the same project. */
  project?: string | null;
}) {
  const search = { project: project ?? undefined } as never;
  const current = useCurrentTab(entries, slug);
  const focus = useNavigatingMenuFocus();
  const barRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ visible: number[]; folded: number[] }>(() => ({
    visible: entries.map((_, index) => index),
    folded: [],
  }));

  useLayoutEffect(() => {
    const bar = barRef.current;
    const measure = measureRef.current;
    if (!bar || !measure) return;
    const update = () => {
      const widths = [...measure.querySelectorAll('[data-measure="tab"]')].map(
        (element) => element.getBoundingClientRect().width,
      );
      const more = measure.querySelector('[data-measure="more"]')?.getBoundingClientRect().width;
      const next = foldTabs(widths, bar.clientWidth, more ?? 0, current);
      setLayout((previous) =>
        previous.visible.join() === next.visible.join() &&
        previous.folded.join() === next.folded.join()
          ? previous
          : next,
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [entries, current]);

  // Until the first measure, and where nothing can be measured, every tab shows.
  const visible = layout.visible.filter((index) => index < entries.length);
  const folded = layout.folded.filter((index) => index < entries.length);
  const moreCount = foldedCount(folded.map((index) => entries[index]?.count));
  const moreCurrent = folded.includes(current);

  return (
    <nav aria-label={messages.nav.tabBarLabel} className="h-tabbar border-b px-3">
      <div ref={barRef} className="relative flex h-full min-w-0 items-stretch">
        <ul className="flex h-full min-w-0 items-stretch">
          {visible.map((index) => {
            const entry = entries[index];
            if (!entry) return null;
            return (
              <li key={entry.item.id} className="flex items-stretch">
                <Link
                  to={entry.item.to}
                  params={{ ws: slug }}
                  search={search}
                  aria-label={messages.nav.withCount(entry.item.label, entry.count ?? 0)}
                  className={cn(tabClass, currentClass)}
                  data-touch
                >
                  <TabLabel entry={entry} />
                </Link>
                {entry.item.id === 'turn' ? <Divider /> : null}
              </li>
            );
          })}
        </ul>
        {folded.length > 0 ? (
          <DropdownMenu onOpenChange={focus.onOpenChange}>
            <DropdownMenuTrigger
              className={cn(
                tabClass,
                'aria-expanded:text-foreground',
                moreCurrent && 'border-primary font-semibold text-primary',
              )}
              aria-label={messages.nav.withCount(messages.nav.more, moreCount)}
              data-current={moreCurrent ? '' : undefined}
            >
              <span aria-hidden="true">{messages.nav.more}</span>
              <CountPill count={moreCount} />
              <ChevronDownIcon className="size-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56"
              onCloseAutoFocus={focus.onCloseAutoFocus}
            >
              {folded.map((index) => {
                const entry = entries[index];
                if (!entry) return null;
                return (
                  <DropdownMenuItem key={entry.item.id} asChild>
                    <Link
                      to={entry.item.to}
                      params={{ ws: slug }}
                      search={search}
                      aria-label={messages.nav.withCount(entry.item.label, entry.count ?? 0)}
                      className="aria-[current=page]:font-semibold aria-[current=page]:text-primary"
                    >
                      <span aria-hidden="true">{entry.item.label}</span>
                      <CountPill count={entry.count} className="ml-auto" />
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {/* A copy of every tab and of More, never seen, to measure their widths. */}
        <div
          aria-hidden="true"
          className="pointer-events-none invisible absolute top-0 left-0 h-0 w-0 overflow-hidden"
        >
          <div ref={measureRef} className="flex w-max">
            {entries.map((entry) => (
              <span key={entry.item.id} data-measure="tab" className="flex">
                <span className={cn(tabClass, 'font-semibold')}>
                  <TabLabel entry={entry} />
                </span>
                {entry.item.id === 'turn' ? <Divider /> : null}
              </span>
            ))}
            <span data-measure="more" className={cn(tabClass, 'font-semibold')}>
              {messages.nav.more}
              <CountPill count={foldedCount(entries.map((entry) => entry.count))} />
              <ChevronDownIcon className="size-4" />
            </span>
          </div>
        </div>
      </div>
    </nav>
  );
}

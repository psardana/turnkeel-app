import { Link } from '@tanstack/react-router';
import { EllipsisIcon, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { CountPill } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { foldedCount } from '@/lib/fold';
import { useNavigatingMenuFocus } from '@/lib/return-focus';
import { cn } from '@/lib/utils';
import { messages } from '@/messages';
import { useCurrentTab, type TabEntry } from './tab-bar';

/** How many tabs get a cell of their own. The rest are behind More. */
export const BOTTOM_BAR_CELLS = 3;

/**
 * A cell: a 20 px icon over a 12 px label. Its count pill sits at the top right of the
 * icon. The current cell is in the accent at 600 with a 2 px bar along its top edge;
 * the bar is the sign, because the accent against soft text is under 2:1. The focus
 * ring sits inside the cell.
 */
const cellClass =
  'relative flex h-bottombar w-full flex-col items-center justify-center gap-1 border-t-2 border-transparent px-1 text-small text-foreground-soft focus-visible:outline-offset-[-2px] aria-[current=page]:border-primary aria-[current=page]:font-semibold aria-[current=page]:text-primary';

function CellIcon({ icon: Icon, count }: { icon: LucideIcon; count: number | undefined }) {
  return (
    <span className="relative">
      <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
      <CountPill
        count={count}
        className="absolute -top-1.5 left-3 h-4 min-w-4 px-1 text-[0.625rem] leading-4"
      />
    </span>
  );
}

/**
 * The bar at the bottom on a phone: the first three tabs, then
 * More, which opens the others in a sheet. It is a `<nav>` of links and comes last in
 * the page, after the content. When the window is under 480 px high it is not fixed
 * and scrolls with the page.
 */
export function BottomBar({
  entries,
  slug,
  project = null,
}: {
  entries: readonly TabEntry[];
  slug: string;
  /** The project the URL names; a cell opens the same project. */
  project?: string | null;
}) {
  const search = { project: project ?? undefined } as never;
  const current = useCurrentTab(entries, slug);
  const [moreOpen, setMoreOpen] = useState(false);
  const focus = useNavigatingMenuFocus();
  const cells = entries.slice(0, BOTTOM_BAR_CELLS);
  const rest = entries.slice(BOTTOM_BAR_CELLS);
  const moreCount = foldedCount(rest.map((entry) => entry.count));
  const moreCurrent = current >= BOTTOM_BAR_CELLS;
  const columns = cells.length + (rest.length > 0 ? 1 : 0);

  return (
    <nav
      aria-label={messages.nav.label}
      data-slot="bottom-bar"
      className="z-40 border-t border-border-strong bg-background pb-[env(safe-area-inset-bottom)] tall:fixed tall:inset-x-0 tall:bottom-0"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {cells.map((entry) => (
          <li key={entry.item.id}>
            <Link
              to={entry.item.to}
              params={{ ws: slug }}
              search={search}
              aria-label={messages.nav.withCount(entry.item.label, entry.count ?? 0)}
              className={cellClass}
              data-touch
            >
              {entry.item.icon ? <CellIcon icon={entry.item.icon} count={entry.count} /> : null}
              <span aria-hidden="true" className="max-w-full truncate">
                {entry.item.label}
              </span>
            </Link>
          </li>
        ))}
        {rest.length > 0 ? (
          <li>
            <Sheet
              open={moreOpen}
              onOpenChange={(open) => {
                focus.onOpenChange(open);
                setMoreOpen(open);
              }}
            >
              {/* The trigger of the sheet, so the focus comes back to it when it closes. */}
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label={messages.nav.withCount(messages.nav.more, moreCount)}
                  aria-current={moreCurrent ? 'page' : undefined}
                  className={cellClass}
                >
                  <CellIcon icon={EllipsisIcon} count={moreCount} />
                  <span aria-hidden="true">{messages.nav.more}</span>
                </button>
              </SheetTrigger>
              <SheetContent
                side="bottom"
                title={messages.nav.more}
                onCloseAutoFocus={focus.onCloseAutoFocus}
              >
                <ul className="py-1">
                  {rest.map((entry) => (
                    <li key={entry.item.id}>
                      <Link
                        to={entry.item.to}
                        params={{ ws: slug }}
                        search={search}
                        aria-label={messages.nav.withCount(entry.item.label, entry.count ?? 0)}
                        className={cn(
                          'flex min-h-12 items-center gap-3 border-b px-4 text-foreground focus-visible:outline-offset-[-2px]',
                          'aria-[current=page]:font-semibold aria-[current=page]:text-primary',
                        )}
                        onClick={() => setMoreOpen(false)}
                        data-touch
                      >
                        <span aria-hidden="true">{entry.item.label}</span>
                        <CountPill count={entry.count} className="ml-auto" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </SheetContent>
            </Sheet>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

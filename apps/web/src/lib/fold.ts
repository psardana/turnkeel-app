/**
 * Which tabs stay in the tab bar and which fold into More.
 *
 * The bar never wraps and never scrolls. Tabs that do not fit move, from the end of
 * the order, into More. If the current tab would be inside More, it takes the last
 * visible place instead, and the tab that was there moves into More.
 *
 * `widths` are the widths of the tabs in navigation order, `available` the width of
 * the bar, `moreWidth` the width of the More button, and `current` the index of the
 * current tab, or -1 when no tab is current. Both lists hold indexes in navigation
 * order.
 */
export function foldTabs(
  widths: readonly number[],
  available: number,
  moreWidth: number,
  current: number,
): { visible: number[]; folded: number[] } {
  const all = widths.map((_, index) => index);
  const sum = (indexes: readonly number[]) =>
    indexes.reduce((total, index) => total + (widths[index] ?? 0), 0);

  if (sum(all) <= available) return { visible: all, folded: [] };

  for (let kept = widths.length - 1; kept >= 0; kept -= 1) {
    let visible = all.slice(0, kept);
    if (current >= kept && kept > 0) visible = [...all.slice(0, kept - 1), current];
    if (sum(visible) + moreWidth <= available) {
      return { visible, folded: all.filter((index) => !visible.includes(index)) };
    }
  }
  return { visible: [], folded: all };
}

/** What a count pill shows: nothing at 0, the number up to 99, then "99+". */
export function countLabel(count: number | undefined): string | null {
  if (count === undefined || count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

/** The sum of the counts of the tabs inside More, which the More button shows. */
export function foldedCount(counts: readonly (number | undefined)[]): number {
  return counts.reduce<number>((total, count) => total + (count ?? 0), 0);
}

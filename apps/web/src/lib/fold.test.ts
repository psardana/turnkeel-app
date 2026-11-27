import { describe, expect, it } from 'vitest';
import { countLabel, foldedCount, foldTabs } from './fold';

// Twelve tabs of 100 px each, as the full navigation will have them.
const twelve = Array.from({ length: 12 }, () => 100);

describe('which tabs fold into More', () => {
  it('keeps every tab when they fit, and draws no More', () => {
    expect(foldTabs([100, 100, 100], 300, 80, 0)).toEqual({ visible: [0, 1, 2], folded: [] });
    expect(foldTabs([], 300, 80, -1)).toEqual({ visible: [], folded: [] });
  });

  it('folds from the end of the order, leaving room for More', () => {
    // 650 px: five tabs of 100 and More of 80 fit, six do not.
    expect(foldTabs(twelve, 650, 80, 0)).toEqual({
      visible: [0, 1, 2, 3, 4],
      folded: [5, 6, 7, 8, 9, 10, 11],
    });
  });

  it('puts the current tab in the last visible place when it would be inside More', () => {
    expect(foldTabs(twelve, 650, 80, 9)).toEqual({
      visible: [0, 1, 2, 3, 9],
      folded: [4, 5, 6, 7, 8, 10, 11],
    });
  });

  it('keeps the order when the current tab is visible, or when no tab is current', () => {
    expect(foldTabs(twelve, 650, 80, 2).visible).toEqual([0, 1, 2, 3, 4]);
    expect(foldTabs(twelve, 650, 80, -1).visible).toEqual([0, 1, 2, 3, 4]);
  });

  it('takes the widths as they are, so a wide current tab can push one more into More', () => {
    const widths = [100, 100, 100, 100, 250];
    expect(foldTabs(widths, 450, 80, 4)).toEqual({ visible: [0, 4], folded: [1, 2, 3] });
  });

  it('folds everything into More when not even one tab fits beside it', () => {
    expect(foldTabs([200, 200], 150, 80, 0)).toEqual({ visible: [], folded: [0, 1] });
  });
});

describe('counts', () => {
  it('shows nothing at 0, the number up to 99, then 99+', () => {
    expect(countLabel(undefined)).toBeNull();
    expect(countLabel(0)).toBeNull();
    expect(countLabel(1)).toBe('1');
    expect(countLabel(99)).toBe('99');
    expect(countLabel(100)).toBe('99+');
  });

  it('More shows the sum of the counts inside it', () => {
    expect(foldedCount([2, undefined, 0, 5])).toBe(7);
    expect(foldedCount([])).toBe(0);
  });
});

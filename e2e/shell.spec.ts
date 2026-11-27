import type { Page } from '@playwright/test';
import { expect, fitsViewport, test } from './support/fixtures.ts';

/**
 * The shell in its look: the tab
 * bar at the top from 640 px up and the bar at the bottom below that, the tokens of
 * both themes, the two typefaces, no other host asked, and one focus ring.
 */

/** The colour tokens, as `getComputedStyle` gives them. */
const tokens = {
  light: {
    '--background': '#ffffff',
    '--foreground': '#18181b',
    '--primary': '#0f766e',
    '--ring': '#0f766e',
    '--border': '#e4e4e7',
    '--input': '#8a8a93',
    '--selected': '#e6f4f1',
    '--destructive': '#b91c1c',
    '--state-changes': '#92400e',
  },
  dark: {
    '--background': '#18181b',
    '--foreground': '#f4f4f5',
    '--primary': '#14b8a6',
    '--ring': '#14b8a6',
    '--border': '#303036',
    '--input': '#85858f',
    '--selected': '#12302d',
    '--destructive': '#f87171',
    '--state-changes': '#fbbf24',
  },
} as const;

/** The tokens on <html>. The build writes `#ffffff` as `#fff`, so short hex is spelt out. */
const readTokens = (page: Page, names: readonly string[]) =>
  page.evaluate((list) => {
    const style = getComputedStyle(document.documentElement);
    const long = (value: string) =>
      /^#[0-9a-f]{3}$/i.test(value)
        ? `#${[...value.slice(1)].map((digit) => digit + digit).join('')}`
        : value;
    return Object.fromEntries(
      list.map((name) => [name, long(style.getPropertyValue(name).trim().toLowerCase())]),
    );
  }, names);

/** The computed outline of the element that has focus. */
const focusOutline = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      width: style.outlineWidth,
      style: style.outlineStyle,
      color: style.outlineColor,
      offset: style.outlineOffset,
    };
  });

const TEAL = 'rgb(15, 118, 110)';

test('the tokens of both themes are set before the first paint, and the typefaces load', async ({
  page,
  enter,
}) => {
  await enter(page);
  await expect(page.getByRole('heading', { name: 'Your turn', level: 1 })).toBeVisible();
  expect(await readTokens(page, Object.keys(tokens.light))).toEqual(tokens.light);
  expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#ffffff');

  // Dark is on <html> before the app runs, with its own tokens and theme colour.
  await page.evaluate(() => window.localStorage.setItem('turnkeel.theme', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await readTokens(page, Object.keys(tokens.dark))).toEqual(tokens.dark);
  expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#18181b');

  // IBM Plex Sans for text, IBM Plex Mono for keys, both loaded from the build.
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    await document.fonts.load('400 14px "IBM Plex Mono"');
    return {
      body: getComputedStyle(document.body).fontFamily,
      sans: document.fonts.check('600 14px "IBM Plex Sans"'),
      mono: document.fonts.check('400 13px "IBM Plex Mono"'),
      loaded: [...document.fonts]
        .filter((face) => face.status === 'loaded')
        .map((face) => face.family),
    };
  });
  expect(fonts.body).toMatch(/^"?IBM Plex Sans"?,/);
  expect(fonts.sans).toBe(true);
  expect(fonts.mono).toBe(true);
  expect(fonts.loaded).toContain('IBM Plex Sans');
  expect(fonts.loaded).toContain('IBM Plex Mono');
});

test('no page asks another host for anything', async ({ page, enter, local }) => {
  const origin = new URL(local.url).origin;
  const elsewhere: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.origin !== origin) elsewhere.push(request.url());
  });
  await enter(page);
  await expect(page.getByRole('heading', { name: 'Your turn', level: 1 })).toBeVisible();
  for (const path of [
    '/w/my-workspace/settings',
    '/w/my-workspace/settings/projects',
    '/w/my-workspace/settings/members',
    '/account',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
  }
  expect(elsewhere).toEqual([]);
});

test('from 640 px up: the header, and the tab bar holding Your turn, Board, Ship, Marketing, Money and Inbox', async ({
  page,
  enter,
  isMobile,
}) => {
  test.skip(isMobile, 'The phone has its own bars.');
  await enter(page);
  const tabBar = page.getByRole('navigation', { name: 'Project' });
  await expect(tabBar).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

  // The six tabs; the workspace opens on Your turn.
  const links = tabBar.getByRole('link');
  await expect(links).toHaveCount(6);
  await expect(links.first()).toHaveAccessibleName('Your turn');
  await expect(links.first()).toHaveAttribute('aria-current', 'page');
  await expect(links.nth(1)).toHaveAccessibleName('Board');
  await expect(links.nth(2)).toHaveAccessibleName('Ship');
  await expect(links.nth(3)).toHaveAccessibleName('Marketing');
  await expect(links.nth(4)).toHaveAccessibleName('Money');
  await expect(links.nth(5)).toHaveAccessibleName('Inbox');
  // Nothing to fold at 1280 px: there is no More.
  await expect(tabBar.getByRole('button', { name: /^More/ })).toHaveCount(0);

  // Row 1 is 48 px and the tab bar 44 px, and both stay at the top.
  const banner = page.getByRole('banner');
  expect((await banner.boundingBox())?.height).toBe(92);
  expect((await tabBar.boundingBox())?.height).toBe(44);
  expect(await banner.evaluate((element) => getComputedStyle(element).position)).toBe('sticky');

  // On a page that belongs to no tab the bar stays, with no tab current.
  await page.goto('/w/my-workspace/settings/projects');
  await expect(tabBar.getByRole('link', { name: 'Your turn' })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  await tabBar.getByRole('link', { name: 'Your turn' }).click();
  await expect(page).toHaveURL(/\/turn$/);
  // Focus goes to the heading of the view that opened.
  await expect(page.getByRole('heading', { name: 'Your turn', level: 1 })).toBeFocused();
  await expect(page).toHaveTitle('Your turn · Turnkeel');
});

test('below 640 px: the top bar, and the bar at the bottom holding Your turn, Board, Ship and More', async ({
  page,
  enter,
  isMobile,
}) => {
  test.skip(!isMobile, 'This is the phone layout.');
  await enter(page);
  await expect(page.getByRole('navigation', { name: 'Project' })).toHaveCount(0);
  const bottom = page.getByRole('navigation', { name: 'Main' });
  await expect(bottom).toBeVisible();
  const cells = bottom.getByRole('link');
  await expect(cells).toHaveCount(3);
  await expect(cells.first()).toHaveAccessibleName('Your turn');
  await expect(cells.nth(1)).toHaveAccessibleName('Board');
  await expect(cells.nth(2)).toHaveAccessibleName('Ship');
  await expect(cells.first()).toHaveAttribute('aria-current', 'page');
  // The tabs past the third are behind More: Marketing, Money and Inbox.
  const more = bottom.getByRole('button', { name: /^More/ });
  await expect(more).toHaveCount(1);
  await more.click();
  const others = page.getByRole('dialog', { name: 'More' }).getByRole('link');
  await expect(others).toHaveCount(3);
  await expect(others.first()).toHaveAccessibleName('Marketing');
  await expect(others.nth(1)).toHaveAccessibleName('Money');
  await expect(others.nth(2)).toHaveAccessibleName('Inbox');
  await page.keyboard.press('Escape');

  // The top bar is 56 px. The bottom bar is 64 px and sits at the bottom of the window.
  // 56 px and the hairline under it.
  expect((await page.getByRole('banner').boundingBox())?.height).toBe(57);
  const viewport = page.viewportSize();
  const box = await bottom.boundingBox();
  // 64 px and the line above it.
  expect(box?.height).toBe(65);
  expect((await cells.first().boundingBox())?.height).toBe(64);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBe(viewport?.height);

  // The brand and the theme switch are not in the top bar; the account menu holds the theme.
  await expect(page.getByRole('banner').getByRole('link', { name: 'Turnkeel' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Theme:/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);

  // The last line is never under the bar: the page ends above it.
  await page.goto('/w/my-workspace/settings/projects');
  await expect(bottom.getByRole('link', { name: 'Your turn' })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(await fitsViewport(page)).toBe(true);
  const padding = await page
    .getByRole('main')
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom));
  expect(padding).toBeGreaterThanOrEqual(64);
});

test('a window under 480 px high keeps its room: nothing is sticky or fixed', async ({
  page,
  enter,
  isMobile,
}) => {
  await page.setViewportSize({ width: isMobile ? 390 : 1280, height: 400 });
  await enter(page);
  await page.goto('/w/my-workspace/activity');
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
  expect(
    await page.getByRole('banner').evaluate((element) => getComputedStyle(element).position),
  ).toBe('static');
  if (isMobile) {
    expect(
      await page
        .getByRole('navigation', { name: 'Main' })
        .evaluate((element) => getComputedStyle(element).position),
    ).toBe('static');
  }
});

test('one focus ring, 2 px in the accent, on every kind of control', async ({
  page,
  enter,
  isMobile,
}) => {
  test.skip(isMobile, 'A phone has no keyboard to tab with.');
  await enter(page);
  await page.goto('/w/my-workspace/activity');
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();

  // The colour of a control changes in 120 ms, its outline's too, so this waits for it.
  const expectRing = async (inside = false) => {
    await expect
      .poll(() => focusOutline(page))
      .toMatchObject({
        width: '2px',
        style: 'solid',
        color: TEAL,
        offset: inside ? '-2px' : '2px',
      });
  };

  // A button, reached with Tab: the skip link, the brand, then the workspace menu.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Workspace My workspace' })).toBeFocused();
  await expectRing();

  // A menu entry: the ring sits inside.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Home' })).toBeFocused();
  await expectRing(true);
  await page.keyboard.press('Escape');

  // A tab of the tab bar.
  const tab = page.getByRole('navigation', { name: 'Project' }).getByRole('link').first();
  await tab.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(tab).toBeFocused();
  await expectRing();

  // A select and a text field of the filters.
  await page.getByLabel('Area').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Area')).toBeFocused();
  await expectRing();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('From')).toBeFocused();
  await expectRing();
});

test('a menu entry that opens another view gives the focus to its h1 and names the page', async ({
  page,
  enter,
}) => {
  await enter(page);
  await expect(page.getByRole('heading', { name: 'Your turn', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Workspace My workspace' }).click();
  await page.getByRole('menuitem', { name: 'Members' }).click();
  await expect(page).toHaveURL(/\/settings\/members$/);
  await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeFocused();
  await expect(page).toHaveTitle('Members · Turnkeel');

  // The same from the keyboard, back to Activity.
  await page.getByRole('button', { name: 'Workspace My workspace' }).focus();
  await page.keyboard.press('Enter');
  // Home is first, Activity next.
  await expect(page.getByRole('menuitem', { name: 'Home' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Activity' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeFocused();
  await expect(page).toHaveTitle('Activity · Turnkeel');

  // A menu closed with Escape gives the focus back to its button.
  await page.getByRole('button', { name: 'Workspace My workspace' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Workspace My workspace' })).toBeFocused();
});

test('a toast is set in IBM Plex Sans, like every other text', async ({ page, enter }) => {
  await enter(page);
  await page.goto('/w/my-workspace/settings/workspace');
  await expect(page.getByRole('heading', { name: 'Workspace', level: 1 })).toBeVisible();
  // Save is pressable with nothing changed, writes nothing and says so.
  await page.getByRole('button', { name: 'Save' }).click();
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Saved.' });
  await expect(toast).toBeVisible();
  const family = await toast
    .locator('[data-title]')
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(family).toMatch(/^"?IBM Plex Sans"?,/);
});

test('the area filter shows its longest option whole', async ({ page, enter, isMobile }) => {
  test.skip(isMobile, 'On a phone the filters are in a sheet, a field to a row.');
  await enter(page);
  await page.goto('/w/my-workspace/activity?area=workspace');
  const select = page.getByLabel('Area');
  await expect(select).toHaveValue('workspace');
  await page.evaluate(() => document.fonts.ready);
  const room = await select.evaluate((element) => {
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('No 2D canvas.');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const text = (element as HTMLSelectElement).selectedOptions[0]?.text ?? '';
    const inner =
      element.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight);
    return { text, inner, needed: context.measureText(text).width };
  });
  expect(room.text).toBe('Workspace and projects');
  expect(room.inner).toBeGreaterThanOrEqual(room.needed);
});

test('on a phone the filter sheet gives the focus back to Filters when it closes', async ({
  page,
  enter,
  isMobile,
}) => {
  test.skip(!isMobile, 'From 640 px up the filters are a row on the page.');
  await enter(page);
  await page.goto('/w/my-workspace/activity');
  const filters = page.getByRole('button', { name: /^Filters/ });
  await filters.click();
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(filters).toBeFocused();
});

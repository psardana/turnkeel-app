import type { Page } from '@playwright/test';
import { expect, fitsViewport, test, uniqueProject } from './support/fixtures.ts';

/**
 * Local mode, started through the server's programmatic start: the
 * one-time address lands in the app, on Your turn, a project is created, and its event shows in
 * Activity on a second page that is not reloaded. The `phone` project runs the same
 * flow in a phone viewport.
 */

/** Marks the page, so a later check can tell that it was never loaded again. */
const mark = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { neverReloaded?: boolean }).neverReloaded = true;
  });

const marked = (page: Page) =>
  page.evaluate(() => (window as unknown as { neverReloaded?: boolean }).neverReloaded === true);

test('the one-time address lands in the workspace, and a new project shows live on a second page', async ({
  page,
  context,
  enter,
  isMobile,
}) => {
  // There is no sign-in page: the one-time address sets the session and opens the app.
  await enter(page);
  await expect(page).toHaveURL(/\/w\/my-workspace\/turn$/);
  await expect(page.getByRole('button', { name: 'Workspace My workspace' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your turn', level: 1 })).toBeVisible();
  await page.goto('/w/my-workspace/activity');
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
  await expect(page.getByText('created the workspace')).toBeVisible();

  // A second page of the same browser, on Activity, with its live stream open.
  const second = await context.newPage();
  await second.goto('/w/my-workspace/activity');
  await expect(second.getByText('Live', { exact: true })).toBeVisible();
  await mark(second);

  // Create a project on the first page, from the project switcher.
  const project = uniqueProject();
  await page.getByRole('button', { name: /^Switch project/ }).click();
  // On a phone the project switcher is a sheet of buttons and links.
  await page.getByRole(isMobile ? 'link' : 'menuitem', { name: 'New project' }).click();
  await expect(page).toHaveURL(/\/settings\/projects\/new$/);
  await page.getByLabel('Name').fill(project.name);
  await page.getByLabel('Key').fill(project.key);
  await page.getByLabel('Kind').selectOption('web');
  await page.getByLabel('Languages').fill('en, de');
  await page.getByLabel('Launch date').fill('2027-03-01');
  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page).toHaveURL(/\/settings\/projects$/);
  const row = page.getByRole('row').filter({ hasText: project.name });
  await expect(row).toContainText(project.key);
  await expect(row).toContainText('1 Mar 2027');

  // The second page shows the event without having been loaded again.
  const line = second.getByRole('listitem').filter({ hasText: project.name });
  await expect(line).toContainText('created the project');
  await expect(line).toContainText('Web app');
  await expect(line.getByRole('link', { name: project.name })).toBeVisible();
  expect(await marked(second)).toBe(true);

  // The layout holds in this viewport.
  expect(await fitsViewport(page)).toBe(true);
  expect(await fitsViewport(second)).toBe(true);

  if (isMobile) {
    // On a phone every control is at least 44 px high.
    for (const target of [second, page]) {
      const controls = target.locator(
        // A checkbox keeps its 18 px box; its label is the target.
        'button:not([role=checkbox]):visible, a[data-touch]:visible, a[data-slot=button]:visible, label[data-touch]:visible, select:visible, input:not([type=checkbox]):visible',
      );
      expect(await controls.count()).toBeGreaterThan(3);
      for (const control of await controls.all()) {
        const box = await control.boundingBox();
        expect(
          box?.height ?? 0,
          await control.evaluate((element) => element.outerHTML.slice(0, 120)),
        ).toBeGreaterThanOrEqual(44);
      }
    }
  }
});

test('filters are part of the address, and the project switcher sets the project', async ({
  page,
  enter,
  isMobile,
}) => {
  await enter(page);
  const project = uniqueProject();
  await page.goto('/w/my-workspace/settings/projects/new');
  await page.getByLabel('Name').fill(project.name);
  await page.getByLabel('Key').fill(project.key);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/settings\/projects$/);

  // A section of Marketing stays open when the project changes.
  await page.goto('/w/my-workspace/marketing/posts');
  await page.getByRole('button', { name: /^Switch project/ }).click();
  await page
    .getByRole(isMobile ? 'button' : 'menuitem', { name: new RegExp(project.name) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/marketing/posts\\?.*project=${project.key}`));

  await page.goto('/w/my-workspace/activity');
  await page.getByRole('button', { name: /^Switch project/ }).click();
  await page
    .getByRole(isMobile ? 'button' : 'menuitem', { name: new RegExp(project.name) })
    .click();
  await expect(page).toHaveURL(new RegExp(`project=${project.key}`));

  // Only this project's lines are left. The switcher's own entry for the project can
  // still be on the page while its sheet closes, so look only in the content.
  await expect(
    page.getByRole('main').getByRole('listitem').filter({ hasText: project.name }),
  ).toBeVisible();
  await expect(page.getByText('created the workspace')).toHaveCount(0);

  // The address alone brings the same view back.
  await page.reload();
  await expect(
    page.getByRole('button', { name: `Switch project, now ${project.name}` }),
  ).toBeVisible();
  await expect(page.getByText('created the workspace')).toHaveCount(0);

  // A range of days that ended before today leaves nothing, and says so. On a phone the
  // filters are in a sheet behind one button.
  if (isMobile) await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByLabel('To', { exact: true }).fill('2020-01-01');
  await expect(page).toHaveURL(/to=2020-01-01/);
  await expect(page.getByText('Nothing matches these filters')).toBeVisible();
  // Clearing the filters leaves the project, which the project switcher sets.
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(page).not.toHaveURL(/to=/);
  await expect(page).toHaveURL(new RegExp(`project=${project.key}`));
  await expect(page.getByText('created the project')).toBeVisible();
});

test('a project can be edited and archived, and the theme is kept', async ({
  page,
  enter,
  isMobile,
}) => {
  await enter(page);
  const project = uniqueProject();
  await page.goto('/w/my-workspace/settings/projects/new');
  await page.getByLabel('Name').fill(project.name);
  await page.getByLabel('Key').fill(project.key);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name: project.name }).click();

  await page.getByLabel('Name').fill(`${project.name} two`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.getByRole('button', { name: 'Archive project' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('read-only');
  await dialog.getByRole('button', { name: 'Archive project' }).click();
  await expect(page).toHaveURL(/\/settings\/projects$/);
  await expect(page.getByRole('row').filter({ hasText: project.name })).toHaveCount(0);

  await page.getByLabel('Show archived projects').check();
  await expect(page).toHaveURL(/archived=true/);
  await expect(page.getByRole('row').filter({ hasText: project.name })).toContainText('Archived');

  // Dark is set on <html> and is there again after a reload, before the app runs. On a
  // phone the theme is in the account menu.
  await page
    .getByRole('button', isMobile ? { name: 'Account', exact: true } : { name: /^Theme:/ })
    .click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('without the local session the app says how to get in', async ({ browser, local }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${local.url}/w/my-workspace/activity`);
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(
    page.getByRole('heading', { name: 'This install runs in local mode' }),
  ).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveCount(0);
  await context.close();
});

test('menus and dialogs work from the keyboard', async ({ page, enter, isMobile }) => {
  test.skip(isMobile, 'A phone has no keyboard to tab with.');
  await enter(page);
  await expect(page.getByRole('heading', { name: 'Your turn', level: 1 })).toBeVisible();

  // The first stop is the link that skips the header.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to the content' })).toBeFocused();

  // The workspace menu: open with Enter, move with the arrows, choose with Enter.
  const menuButton = page.getByRole('button', { name: 'Workspace My workspace' });
  await menuButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  // Home comes first, then Activity, then Reference.
  await expect(page.getByRole('menuitem', { name: 'Home' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Activity' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Reference' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(menuButton).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Home' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Activity' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Reference' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Projects' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\/projects$/);

  // A dialog: it takes the focus, Escape closes it, and the focus goes back.
  const project = uniqueProject();
  await page.goto('/w/my-workspace/settings/projects/new');
  await page.getByLabel('Name').fill(project.name);
  await page.getByLabel('Key').fill(project.key);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\/projects$/);
  await page.getByRole('link', { name: project.name }).click();
  // A new view takes the focus on its heading.
  await expect(
    page.getByRole('heading', { name: `Project ${project.name}`, level: 1 }),
  ).toBeFocused();
  const archive = page.getByRole('button', { name: 'Archive project' });
  await archive.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  // Tab stays inside the dialog.
  for (let press = 0; press < 4; press += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(archive).toBeFocused();
});

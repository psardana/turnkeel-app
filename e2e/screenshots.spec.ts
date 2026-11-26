import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './support/fixtures.ts';
import { linkFromMail } from './support/mail.ts';
import { composeIsUp, startSignInServer } from './support/servers.ts';

/**
 * Pictures of the main views, in light and in dark, in the desktop and in the phone
 * project, for looking at the layout. They go to e2e/screenshots, which is not
 * committed. The tests only check that each view shows; a person looks at the files.
 */
const folder = path.join(import.meta.dirname, 'screenshots');
mkdirSync(folder, { recursive: true });

const themes = ['light', 'dark'] as const;

/**
 * A picture of the page. A menu, a dialog or a sheet is taken as the window shows it,
 * because a picture of the whole page would draw its backdrop over one window's height
 * only.
 */
async function shot(
  page: Page,
  project: string,
  theme: string,
  name: string,
  { open = false }: { open?: boolean } = {},
) {
  // Let a menu or a dialog finish opening, and the fonts load.
  await page.waitForTimeout(250);
  await page.evaluate(() => document.fonts.ready);
  // A whole page is taken from its top: a page scrolled down would draw the sticky bar
  // in the middle of the picture.
  if (!open) await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(folder, `${project}-${theme}-${name}.png`),
    fullPage: !open,
    // In a picture of the whole page a fixed bar would be drawn one window's height
    // down, over the content. Here it is drawn at the end of the page, as it is in a
    // window under 480 px high.
    style: open ? undefined : "[data-slot='bottom-bar'] { position: static !important; }",
  });
}

const useTheme = (page: Page, theme: string) =>
  page.addInitScript((choice) => window.localStorage.setItem('turnkeel.theme', choice), theme);

for (const theme of themes) {
  test(`the Agents tab and Agents and tokens in ${theme}`, async ({ page, enter }, testInfo) => {
    const project = testInfo.project.name;
    await useTheme(page, theme);
    await enter(page);
    await expect(page.getByRole('heading', { name: 'Your turn', level: 1 })).toBeVisible();
    const call = callFrom(page);
    const made = (await call('POST', '/workspaces/my-workspace/projects', {
      name: 'Lighthouse',
      key: 'LHS',
      slug: 'lhs',
      kind: 'app',
    })) as { id: string };
    const agent = (await call('POST', '/workspaces/my-workspace/agents', {
      name: 'claude',
      kind: 'claude-code',
    })) as { id: string };
    const token = (await call('POST', `/agents/${agent.id}/tokens`, {
      name: 'Hooks',
      scopes: ['sessions:write', 'cards:read'],
      projectIds: [made.id],
    })) as { value: string };
    const origin = new URL(page.url()).origin;
    const report = (session: string, state: string, needs?: string, title?: string) =>
      page.request.post(`${origin}/api/v1/workspaces/my-workspace/sessions/report`, {
        headers: { authorization: `Bearer ${token.value}` },
        data: { session, state, ...(needs ? { needs } : {}), ...(title ? { title } : {}) },
      });
    await report('one', 'needs_you', 'permission', 'Fix the share sheet');
    await report('two', 'working', undefined, 'Port the importer');
    await report('three', 'idle', undefined, 'Write the release notes');
    await page.goto('/w/my-workspace/settings/sessions');
    await expect(page.getByText('Fix the share sheet')).toBeVisible();
    await shot(page, project, theme, 'agents');
    await page.goto('/w/my-workspace/settings/agents');
    await expect(page.getByRole('heading', { name: 'claude' })).toBeVisible();
    await shot(page, project, theme, 'agents-and-tokens');
  });
}

for (const theme of themes) {
  test(`Your turn, the Board and the open card in ${theme}`, async ({ page, enter }, testInfo) => {
    const project = testInfo.project.name;
    const phone = project === 'phone';
    const snap = (name: string, open = false) => shot(page, project, theme, name, { open });
    await useTheme(page, theme);
    await enter(page);
    await expect(page.getByRole('heading', { name: 'Your turn', level: 1 })).toBeVisible();
    await expect(page.getByText('Nothing needs you right now.')).toBeVisible();
    await snap('turn-empty');

    const seeded = await seed(page);
    const { key } = seeded.project;
    const { cards } = seeded;
    await page.goto(`/w/my-workspace/turn?project=${key}`);
    await expect(page.getByRole('list', { name: 'Your turn' }).getByRole('listitem')).toHaveCount(
      3,
    );
    await snap('turn');
    if (phone) {
      await page.getByRole('button', { name: /Waiting on others/ }).click();
      await expect(page.getByRole('list', { name: 'Unassigned, 1 line' })).toBeVisible();
      await snap('turn-others-open');
    }

    await page.goto(`/w/my-workspace/turn?project=${key}&item=card:${cards.first!.key}`);
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(cards.first!.title);
    await expect(page.getByRole('region', { name: 'History' })).toContainText('Created the card');
    await snap(phone ? 'turn-card-sheet' : 'turn-pane', phone);

    await page.goto(`/w/my-workspace/board?project=${key}`);
    await expect(page.locator(`[data-key="${cards.first!.key}"]`)).toBeVisible();
    await snap('board');

    await page.locator(`[data-key="${cards.second!.key}"]`).hover();
    await page.getByRole('button', { name: `Move ${cards.second!.key} to…` }).click();
    await expect(
      phone
        ? page.getByRole('dialog', { name: `Move ${cards.second!.key} to…` })
        : page.getByRole('menu'),
    ).toBeVisible();
    await snap('board-move-to', true);
    if (phone) {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Waiting on someone else…' })
        .click();
    } else {
      await page.getByRole('menuitem', { name: 'Waiting on someone else…' }).click();
    }
    await expect(
      page.getByRole('dialog', { name: 'Waiting on whom, or until when?' }),
    ).toBeVisible();
    await snap('board-waiting-dialog', true);
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'New card' }).click();
    await expect(page.getByRole('dialog', { name: 'New card' })).toBeVisible();
    await snap('board-new-card', true);
    await page.keyboard.press('Escape');

    await page.goto(`/w/my-workspace/board?project=${key}&card=${cards.first!.key}`);
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(cards.first!.title);
    await expect(page.getByRole('region', { name: 'History' })).toContainText('Created the card');
    await snap(phone ? 'board-card-sheet' : 'board-card', phone);

    // Both texts of the save rule, beside an unsaved title.
    await page.route('**/api/v1/cards/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      const current = (await (await route.fetch({ method: 'GET' })).json()) as {
        card: Record<string, unknown>;
      };
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'rev_mismatch', message: 'The card changed.', rule: 'R51' },
          current: { ...current.card, title: 'Write the store description in German' },
        }),
      });
    });
    const title = page.getByRole('textbox', { name: 'Title' });
    await title.fill('Write the short store description');
    await title.blur();
    await expect(page.getByRole('button', { name: 'Keep mine' })).toBeVisible();
    await snap(phone ? 'card-conflict-sheet' : 'card-conflict', phone);
  });

  test(`local mode in ${theme}`, async ({ page, enter }, testInfo) => {
    const project = testInfo.project.name;
    const snap = (name: string, open = false) => shot(page, project, theme, name, { open });
    await useTheme(page, theme);
    await enter(page);
    await expect(page.getByRole('heading', { name: 'Your turn', level: 1 })).toBeVisible();

    // Some life for the pictures: two projects, one changed, one archived.
    const suffix = `${theme === 'light' ? 'L' : 'D'}${project === 'phone' ? 'P' : 'D'}`;
    const create = async (name: string, key: string, date: string) => {
      await page.goto('/w/my-workspace/settings/projects/new');
      await page.getByLabel('Name').fill(name);
      await page.getByLabel('Key').fill(key);
      await page.getByLabel('Languages').fill('en, de, pt-BR');
      if (date) await page.getByLabel('Launch date').fill(date);
      await page.getByRole('button', { name: 'Create project' }).click();
      await expect(page).toHaveURL(/\/settings\/projects$/);
    };
    await create(`Harbor app ${suffix}`, `HA${suffix}`, '2027-03-01');
    await create(`Tide tables ${suffix}`, `TT${suffix}`, '');
    await page.getByRole('link', { name: `Tide tables ${suffix}` }).click();
    await page.getByLabel('Kind').selectOption('library');
    await page.getByLabel('Launch date').fill('2026-12-15');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.goto('/w/my-workspace/activity');
    await expect(page.getByText('created the workspace')).toBeVisible();
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await snap('activity');

    await page.getByRole('button', { name: 'Workspace My workspace' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await snap('workspace-menu', true);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /^Switch project/ }).click();
    // On a phone the project switcher is a sheet.
    await expect(
      project === 'phone' ? page.getByRole('dialog', { name: 'Project' }) : page.getByRole('menu'),
    ).toBeVisible();
    await snap('project-switcher', true);
    await page.keyboard.press('Escape');

    // On a phone the account menu also holds the theme; elsewhere the theme switch does.
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await snap('account-menu', true);
    await page.keyboard.press('Escape');

    if (project === 'phone') {
      await page.getByRole('button', { name: 'Filters' }).click();
      await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
      await snap('activity-filters', true);
      await page.keyboard.press('Escape');
    }

    // Loading, and an error with Retry: the list of events is held back, then refused.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/workspaces/my-workspace/events?**', async (route) => {
      await held;
      await route.fallback();
    });
    await page.goto('/w/my-workspace/activity?area=people');
    await expect(page.getByRole('status').getByText('Loading')).toBeAttached();
    await snap('activity-loading');
    release();
    await page.unroute('**/api/v1/workspaces/my-workspace/events?**');
    await page.route('**/api/v1/workspaces/my-workspace/events?**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: { 'X-Request-Id': 'screenshot' },
        body: JSON.stringify({
          error: { code: 'internal', message: 'Something went wrong on the server.' },
        }),
      }),
    );
    await page.goto('/w/my-workspace/activity?area=workspace');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 60_000 });
    await snap('activity-error');
    await page.unroute('**/api/v1/workspaces/my-workspace/events?**');

    await page.goto('/w/my-workspace/activity?to=2020-01-01');
    await expect(page.getByText('Nothing matches these filters')).toBeVisible();
    await snap('activity-empty');

    await page.goto('/w/my-workspace/settings/projects');
    await expect(page.getByRole('link', { name: `Harbor app ${suffix}` })).toBeVisible();
    await snap('projects');

    await page.goto('/w/my-workspace/settings/projects/new');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByText('Use 1 to 80 characters.')).toBeVisible();
    await snap('project-new-errors');

    await page.goto(`/w/my-workspace/settings/projects/HA${suffix}`);
    await expect(page.getByRole('button', { name: 'Archive project' })).toBeVisible();
    await snap('project-edit');
    await page.getByRole('button', { name: 'Archive project' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await snap('project-archive-dialog', true);
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.goto('/w/my-workspace/settings/members');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
    await expect(page.getByText('(you)')).toBeVisible();
    await snap('members-local');

    await page.goto('/w/my-workspace/settings/workspace');
    await expect(page.getByLabel('Name')).toHaveValue('My workspace');
    await snap('workspace-settings');

    // /account is Settings, Profile.
    await page.goto('/account');
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible();
    await snap('account-local');

    await page.goto('/w/my-workspace/settings/projects/new');
    await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible();
    await snap('project-new');

    await page.goto('/w/nothing-here/activity');
    await expect(
      page.getByRole('heading', { name: 'There is nothing at this address' }),
    ).toBeVisible();
    await snap('not-found');

    // Without the local session: the page that says how to get in.
    await page.context().clearCookies();
    await page.goto('/sign-in');
    await expect(
      page.getByRole('heading', { name: 'This install runs in local mode' }),
    ).toBeVisible();
    await snap('sign-in-local');
  });
}

let stub: StubProvider;

plain.describe('with sign-in', () => {
  plain(
    'sign-in, first run, members and the invitation, in light and dark',
    async ({ browser }, testInfo) => {
      plain.skip(
        !(await composeIsUp()),
        'The Postgres and the mail catcher of docker compose are not running.',
      );
      const project = testInfo.project.name;
      const server = await startSignInServer();
      const run = Math.random().toString(36).slice(2, 8);
      // Closed before the server stops: a page left open would go on talking to the next
      // server that listens on the same port.
      const contexts: BrowserContext[] = [];
      try {
        const contextOf = async (theme: string) => {
          const context = await browser.newContext({ baseURL: server.url });
          contexts.push(context);
          const page = await context.newPage();
          await useTheme(page, theme);
          return { context, page };
        };
        const signIn = async (page: Page, email: string) => {
          await page.getByRole('button', { name: 'Send a sign-in link' }).click();
          await expect(page.getByRole('heading', { name: 'Check your mail' })).toBeVisible();
          await page.goto(await linkFromMail(email, 'Your sign-in link for Turnkeel'));
        };

        // The Owner, in light.
        const ownerEmail = `olive-${run}@example.com`;
        const owner = await contextOf('light');
        await owner.page.goto('/sign-in');
        await owner.page.getByLabel('Email address').fill(ownerEmail);
        await shot(owner.page, project, 'light', 'sign-in');
        await owner.page.getByRole('button', { name: 'Send a sign-in link' }).click();
        await expect(owner.page.getByRole('heading', { name: 'Check your mail' })).toBeVisible();
        await shot(owner.page, project, 'light', 'sign-in-sent');
        await owner.page.goto(await linkFromMail(ownerEmail, 'Your sign-in link for Turnkeel'));
        await owner.page.getByLabel('Your name').fill('Olive Owner');
        await owner.page.getByLabel('Name', { exact: true }).fill('Harbor Works');
        await shot(owner.page, project, 'light', 'welcome');
        await owner.page.getByRole('button', { name: 'Create workspace' }).click();
        await expect(owner.page).toHaveURL(/\/turn$/);

        // A server with sign-in and no TURNKEEL_SECRETS_KEY: Connectors says that no
        // connector with secrets can be installed here.
        await owner.page.goto('/w/harbor-works/settings/connectors');
        await expect(owner.page.getByText(/This server has no TURNKEEL_SECRETS_KEY/)).toBeVisible();
        await shot(owner.page, project, 'light', 'connectors-no-key');

        const invite = async (email: string, role: string) => {
          await owner.page.goto('/w/harbor-works/settings/members');
          await owner.page.getByRole('button', { name: 'Invite' }).click();
          const dialog = owner.page.getByRole('dialog');
          await dialog.getByLabel('Email address').fill(email);
          await dialog.getByLabel('Role').selectOption(role);
          return dialog;
        };
        const adaEmail = `ada-${run}@example.com`;
        const dialog = await invite(adaEmail, 'admin');
        await shot(owner.page, project, 'light', 'invite-dialog', { open: true });
        await dialog.getByRole('button', { name: 'Send invitation' }).click();
        await expect(dialog).toBeHidden();
        const vicEmail = `vic-${run}@example.com`;
        await (
          await invite(vicEmail, 'viewer')
        )
          .getByRole('button', { name: 'Send invitation' })
          .click();
        await expect(owner.page.getByText(`Invitation sent to ${vicEmail}.`)).toBeVisible();

        // The invited person, in dark.
        const ada = await contextOf('dark');
        const link = await linkFromMail(adaEmail, 'invited you to Harbor Works');
        await ada.page.goto(link);
        await expect(ada.page.getByRole('heading', { name: 'Invitation' })).toBeVisible();
        await shot(ada.page, project, 'dark', 'invitation');
        await signIn(ada.page, adaEmail);
        await ada.page.getByLabel('Your name').fill('Ada Admin');
        await shot(ada.page, project, 'dark', 'invitation-accept');
        await ada.page.getByRole('button', { name: 'Accept the invitation' }).click();
        await expect(ada.page).toHaveURL(/\/turn$/);
        await ada.page.goto('/w/harbor-works/activity');
        await expect(ada.page.getByText('joined the workspace as Admin')).toBeVisible();
        await shot(ada.page, project, 'dark', 'activity-with-people');
        await ada.page.goto('/w/harbor-works/settings/members');
        await expect(ada.page.getByText(vicEmail)).toBeVisible();
        await shot(ada.page, project, 'dark', 'members');
        await ada.page.goto('/account');
        await expect(ada.page.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
        await shot(ada.page, project, 'dark', 'account');
        await ada.page.goto('/sign-in?error=signup_by_invitation&next=%2F');
        await ada.context.clearCookies();
        await ada.page.goto('/sign-in?error=signup_by_invitation');
        await shot(ada.page, project, 'dark', 'sign-in-error');

        await owner.page.goto('/w/harbor-works/settings/members');
        await expect(owner.page.getByText('Ada Admin')).toBeVisible();
        await shot(owner.page, project, 'light', 'members');
        await owner.page.goto('/account');
        await expect(owner.page.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
        await shot(owner.page, project, 'light', 'account');
        await owner.page.goto('/w/harbor-works/activity');
        await expect(owner.page.getByText('joined the workspace as Admin')).toBeVisible();
        await shot(owner.page, project, 'light', 'activity-with-people');
      } finally {
        for (const context of contexts) await context.close();
        await server.stop();
      }
    },
  );
});

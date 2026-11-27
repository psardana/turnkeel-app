import { expect, test, type Page } from '@playwright/test';
import { linkFromMail } from './support/mail.ts';
import { composeIsUp, startSignInServer, type TestServer } from './support/servers.ts';

/**
 * Sign-in and invitations on a server with sign-in, against the Postgres and the
 * mail catcher of docker compose. The sign-in links and the
 * invitation are read from the mail catcher's API, as a person would read their mail.
 *
 * Start the services first: `docker compose up -d --wait postgres mail`. Without
 * them these tests are skipped, and say so. In CI (`CI` is set) they fail instead.
 */
let server: TestServer;

// The second test needs the account that the first one makes.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const up = await composeIsUp();
  // A skipped test counts as passed, and sign-in by magic link through the mail
  // catcher is one of the things these tests have to show. So in CI the
  // services must be there; only a run on a developer's machine may skip.
  if (process.env.CI) {
    expect(up, 'In CI the Postgres and the mail catcher of docker compose must be running.').toBe(
      true,
    );
  }
  test.skip(!up, 'The Postgres and the mail catcher of docker compose are not running.');
  test.setTimeout(300_000);
  server = await startSignInServer();
});

test.afterAll(async () => {
  await server?.stop();
});

const run = Math.random().toString(36).slice(2, 8);
const ownerEmail = `olive-${run}@example.com`;
const guestEmail = `gil-${run}@example.com`;

/** Asks for a sign-in link on the page that is open, and opens the link from the mail. */
async function signInByMail(page: Page, email: string, known: Set<string>) {
  await page.getByRole('button', { name: 'Send a sign-in link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your mail' })).toBeVisible();
  const link = await linkFromMail(email, 'Your sign-in link for Turnkeel', known);
  await page.goto(link);
}

test('the first person signs in by magic link and names the workspace; a second person is invited and accepts in another browser', async ({
  browser,
}) => {
  const known = new Set<string>();

  // --- The first person -------------------------------------------------------------
  const ownerContext = await browser.newContext({ baseURL: server.url });
  const owner = await ownerContext.newPage();
  await owner.goto('/');
  await expect(owner).toHaveURL(/\/sign-in/);
  await expect(owner.getByRole('heading', { name: 'Sign in to Turnkeel' })).toBeVisible();

  // Only the methods the server has are offered: no GitHub and no Google here.
  await expect(owner.getByRole('button', { name: 'Send a sign-in link' })).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
  await expect(owner.getByRole('button', { name: /GitHub/ })).toHaveCount(0);
  await expect(owner.getByRole('button', { name: /Google/ })).toHaveCount(0);
  // Mail is configured, so nothing sends the person to the server log.
  await expect(owner.getByText('Mail is not configured')).toHaveCount(0);

  await owner.getByLabel('Email address').fill(ownerEmail);
  await signInByMail(owner, ownerEmail, known);

  // First run: nobody has a workspace yet, so the first person names one.
  await expect(owner).toHaveURL(/\/welcome$/);
  // The one question: what you are shipping; the rest is worked out, under More.
  await expect(owner.getByRole('heading', { name: 'What are you shipping?' })).toBeVisible();
  await owner.getByLabel('Your name').fill('Olive Owner');
  await owner.getByLabel('Name', { exact: true }).fill('Harbor Works');
  // A server with sign-in offers no demo: it loads only in local mode.
  await expect(owner.getByRole('button', { name: 'Look at the demo first' })).toHaveCount(0);
  await owner.getByRole('button', { name: /^More/ }).click();
  await expect(owner.getByLabel('Address')).toHaveValue('harbor-works');
  await expect(owner.getByLabel('Card key')).toHaveValue('HW');
  await expect(owner.getByLabel('Your handle')).toHaveValue('olive-owner');
  await owner.getByRole('button', { name: 'Create workspace' }).click();

  // A workspace opens on Your turn.
  await expect(owner).toHaveURL(/\/w\/harbor-works\/turn$/);
  await expect(owner.getByRole('button', { name: 'Workspace Harbor Works' })).toBeVisible();
  await owner.goto('/w/harbor-works/activity');
  await expect(owner.getByText('created the workspace')).toBeVisible();
  await expect(owner.getByText('joined the workspace as Owner')).toBeVisible();

  // A sign-in link works once.
  const used = await browser.newContext({ baseURL: server.url });
  const again = await used.newPage();
  const firstLink = await linkFromMail(ownerEmail, 'Your sign-in link for Turnkeel');
  await again.goto(firstLink);
  await expect(again).toHaveURL(/\/sign-in/);
  await expect(again.getByRole('alert')).toContainText('already used or has expired');
  await used.close();

  // --- The invitation ---------------------------------------------------------------
  await owner.getByRole('button', { name: 'Workspace Harbor Works' }).click();
  await owner.getByRole('menuitem', { name: 'Members' }).click();
  await expect(owner).toHaveURL(/\/settings\/members$/);
  await expect(owner.getByText(ownerEmail)).toBeVisible();

  await owner.getByRole('button', { name: 'Invite' }).click();
  const dialog = owner.getByRole('dialog');
  await dialog.getByLabel('Email address').fill(guestEmail);
  await dialog.getByLabel('Role').selectOption('reviewer');
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(owner.getByText(`Invitation sent to ${guestEmail}.`)).toBeVisible();
  await expect(dialog).toBeHidden();
  const pending = owner.getByRole('region', { name: 'Pending invitations' });
  await expect(pending.getByText(guestEmail)).toBeVisible();

  // --- The second person, in a browser of their own ---------------------------------------
  const guestContext = await browser.newContext({ baseURL: server.url });
  const guest = await guestContext.newPage();
  const invitation = await linkFromMail(guestEmail, 'invited you to Harbor Works');
  expect(invitation).toContain(`${server.url}/invitations/accept?token=`);
  await guest.goto(invitation);

  await expect(guest.getByRole('heading', { name: 'Invitation' })).toBeVisible();
  await expect(
    guest.getByText('Olive Owner invited you to the workspace Harbor Works as Reviewer.'),
  ).toBeVisible();
  // The sign-in is for the invited address, which cannot be changed here.
  await expect(guest.getByLabel('Email address')).toHaveValue(guestEmail);
  await expect(guest.getByLabel('Email address')).not.toBeEditable();
  await signInByMail(guest, guestEmail, known);

  // Back on the invitation, now signed in: pick a handle and accept.
  await expect(guest).toHaveURL(/\/invitations\/accept\?token=/);
  await guest.getByLabel('Your name').fill('Gil Guest');
  await expect(guest.getByLabel('Your handle')).toHaveValue('gil-guest');
  await guest.getByLabel('Your handle').fill('gil');
  await guest.getByRole('button', { name: 'Accept the invitation' }).click();
  await expect(guest).toHaveURL(/\/w\/harbor-works\/turn$/);
  await expect(guest.getByRole('button', { name: 'Workspace Harbor Works' })).toBeVisible();
  await guest.goto('/w/harbor-works/activity');

  // A Reviewer reads Activity and is not shown what the role does not allow.
  await expect(guest.getByText('created the workspace')).toBeVisible();
  await expect(guest.getByRole('link', { name: 'Export' })).toHaveCount(0);
  await guest.getByRole('button', { name: 'Workspace Harbor Works' }).click();
  await expect(guest.getByRole('menuitem', { name: 'Activity' })).toBeVisible();
  await expect(guest.getByRole('menuitem', { name: 'Members' })).toHaveCount(0);
  await guest.keyboard.press('Escape');
  // Events about people do not reach a Reviewer.
  await expect(guest.getByText('joined the workspace')).toHaveCount(0);

  // The Owner's member list shows the new person without a reload, and the
  // invitation is no longer pending.
  const people = owner.getByRole('main').getByRole('listitem');
  const row = people.filter({ hasText: guestEmail });
  await expect(row).toContainText('Gil Guest');
  await expect(row).toContainText('@gil');
  await expect(row.getByLabel(/^Role of/)).toHaveValue('reviewer');
  await expect(pending.getByText('No invitation is waiting to be accepted.')).toBeVisible();

  // The invitation works once.
  const late = await browser.newContext({ baseURL: server.url });
  const latePage = await late.newPage();
  await latePage.goto(invitation);
  await expect(
    latePage.getByRole('heading', { name: 'This invitation cannot be used' }),
  ).toBeVisible();
  await late.close();

  // --- What the Owner may do with the new member ------------------------------------
  // A role change shows at once and is kept.
  await row.getByLabel(/^Role of/).selectOption('member');
  await expect(owner.getByText('is now Member.')).toBeVisible();
  await owner.reload();
  await expect(
    owner
      .getByRole('listitem')
      .filter({ hasText: guestEmail })
      .getByLabel(/^Role of/),
  ).toHaveValue('member');

  // A change the server refuses shows at once, is put back, and the reason is said.
  await owner.route('**/api/v1/workspaces/harbor-works/members/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'forbidden', message: 'Only an Owner can do this.', rule: 'R31' },
      }),
    });
  });
  const guestRole = people.filter({ hasText: guestEmail }).getByLabel(/^Role of/);
  await guestRole.selectOption('viewer');
  await expect(
    owner.getByText('The change was not saved and has been undone. Only an Owner can do this.'),
  ).toBeVisible();
  await expect(guestRole).toHaveValue('member');
  await owner.unroute('**/api/v1/workspaces/harbor-works/members/*');

  // The guest, now a Member, is told plainly what the role does not open.
  await guest.goto('/w/harbor-works/settings/members');
  await expect(guest.getByRole('heading', { name: 'Your role cannot open this' })).toBeVisible();
  await guest.goto('/w/harbor-works/settings/projects');
  await expect(guest.getByRole('link', { name: 'New project' })).toHaveCount(0);
  // The first project came with the workspace; a Reviewer sees it and makes none.
  await expect(guest.getByRole('row').filter({ hasText: 'HW' })).toBeVisible();
  await guest.goto('/w/harbor-works/settings/workspace');
  await expect(guest.getByLabel('Name')).not.toBeEditable();
  await expect(guest.getByText('Only an Owner or Admin can change these.')).toBeVisible();

  // The Owner's own row offers no other role while they are the only Owner.
  const ownRow = people.filter({ hasText: ownerEmail });
  await expect(ownRow.getByLabel(/^Role of/)).toHaveCount(0);
  await expect(ownRow.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expect(ownRow.getByRole('button', { name: /^Project roles/ })).toHaveCount(0);

  // A project role for someone already in the workspace, given and taken away.
  const created = await ownerContext.request.post('/api/v1/workspaces/harbor-works/projects', {
    data: { name: 'Dock', key: 'DOCK', slug: 'dock' },
  });
  expect(created.status()).toBe(201);
  await owner.reload();
  const guestRow = owner.getByRole('main').getByRole('listitem').filter({ hasText: guestEmail });
  await guestRow.getByRole('button', { name: 'Project roles of Gil Guest' }).click();
  const roles = owner.getByRole('dialog');
  await expect(roles.getByLabel('Project', { exact: true })).toHaveValue(/.+/);
  await roles.getByLabel('Role in this project').selectOption('viewer');
  await roles.getByRole('button', { name: 'Save' }).click();
  await expect(owner.getByText('Gil Guest is now Viewer in Dock.')).toBeVisible();
  await expect(guestRow.getByText('Viewer in Dock')).toBeVisible();
  await guestRow.getByRole('button', { name: 'Project roles of Gil Guest' }).click();
  await expect(roles.getByLabel('Role in this project')).toHaveValue('viewer');
  await roles.getByLabel('Role in this project').selectOption('none');
  await roles.getByRole('button', { name: 'Save' }).click();
  await expect(
    owner.getByText('Gil Guest no longer has a role of their own in Dock.'),
  ).toBeVisible();
  await expect(guestRow.getByText('Viewer in Dock')).toHaveCount(0);

  // Account: the display name and the handle can be changed.
  await owner.getByRole('button', { name: 'Account' }).click();
  await owner.getByRole('menuitem', { name: 'Account settings' }).click();
  // /account leads an Owner on to Settings, Profile; wait for where it lands.
  await expect(owner).toHaveURL(/\/w\/harbor-works\/settings\/profile$/);
  await expect(owner.getByLabel('Display name')).toHaveValue('Olive Owner');
  await owner.getByLabel('Handle in Harbor Works').fill('olive');
  await owner.getByRole('button', { name: 'Save' }).nth(1).click();
  await expect(owner.getByText('Saved.')).toBeVisible();
  await expect(owner.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
  await expect(owner.getByText('You have no passkey yet.')).toBeVisible();

  // Signing out ends the session.
  await owner.getByRole('button', { name: 'Account' }).click();
  await owner.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(owner).toHaveURL(/\/sign-in/);
  await owner.goto('/w/harbor-works/activity');
  await expect(owner).toHaveURL(/\/sign-in\?next=/);

  await ownerContext.close();
  await guestContext.close();
});

test('an address that may not sign in gets the same answer and no mail', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: server.url });
  const page = await context.newPage();
  const stranger = `stranger-${run}@example.com`;
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(stranger);
  await page.getByRole('button', { name: 'Send a sign-in link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your mail' })).toBeVisible();
  await expect(
    linkFromMail(stranger, 'Your sign-in link for Turnkeel', new Set(), 4_000),
  ).rejects.toThrow(/No mail/);
  await context.close();
});

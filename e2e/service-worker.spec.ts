import { expect, test } from './support/fixtures.ts';

/**
 * The service worker caches the app shell and answers navigations with it, except
 * under the paths the server keeps for itself ("Routing and the
 * service worker"). Without that an installed app would answer a sign-in callback,
 * a file download or the one-time address of local mode with the shell.
 */
test('the service worker serves the shell for the app and leaves the server its own paths', async ({
  page,
  context,
  enter,
  local,
}) => {
  await enter(page);
  await expect(page.getByRole('heading', { name: 'Your turn', level: 1 })).toBeVisible();

  // Wait until the worker controls the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      );
    }
  });

  // Navigations under the server's prefixes get the server's own answer.
  const health = await page.goto('/healthz');
  expect(health?.headers()['content-type']).toContain('application/json');
  expect(await health?.json()).toEqual({ status: 'ok' });

  const info = await page.goto('/api/v1/server');
  expect(info?.status()).toBe(200);
  expect((await info?.json()) as { mode: string }).toMatchObject({ mode: 'local' });

  // GET /mcp is the MCP server's own 405: the server answers, not the shell.
  const mcp = await page.goto('/mcp');
  expect(mcp?.status()).toBe(405);
  expect((await mcp?.json()) as unknown).toMatchObject({ error: { code: 'method_not_allowed' } });
  for (const path of ['/hooks/claude-code', '/inbound/email/x', '/webhooks/x']) {
    const answer = await page.goto(path);
    expect(answer?.status(), path).toBe(404);
    expect((await answer?.json()) as unknown, path).toMatchObject({
      error: { code: 'not_found' },
    });
  }
  const changelog = await page.goto('/changelog/my-workspace/app');
  expect(changelog?.status()).toBe(404);
  expect(await changelog?.text()).not.toContain('<div id="root">');

  // A one-time address still reaches the server: a used one is refused by it, with 401.
  const used = await page.goto(`${local.url}/api/v1/local/session?code=not-a-code`);
  expect(used?.status()).toBe(401);

  // Every other path is the app, served from the worker's cache even with no network.
  await page.goto('/w/my-workspace/activity');
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
  await context.setOffline(true);
  await page.goto('/w/my-workspace/settings/projects');
  // The shell runs, cannot reach the server, says so, and offers Retry.
  await expect(page.getByRole('alert')).toContainText('This page could not be loaded.');
  await expect(page.getByRole('alert')).toContainText('The server did not answer.');

  // Back online, Retry loads the page that was asked for.
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();

  // Offline, a server path is not answered with the shell: the navigation fails.
  await context.setOffline(true);
  await expect(page.goto('/api/v1/server')).rejects.toThrow();
  await context.setOffline(false);
});

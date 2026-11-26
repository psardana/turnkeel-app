import { test as base, expect, type Page } from '@playwright/test';
import { startLocalServer, type TestServer } from './servers.ts';

interface TestFixtures {
  /** A server in local mode with an empty workspace, started for this test alone. */
  local: TestServer;
  /** Opens a one-time address in the page, which gives its browser the local session. */
  enter: (page: Page) => Promise<void>;
}

export const test = base.extend<TestFixtures>({
  local: [
    // Playwright reads the names of the fixtures a fixture needs from this pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const server = await startLocalServer();
      await use(server);
      await server.stop();
    },
    { timeout: 300_000 },
  ],
  baseURL: async ({ local }, use) => {
    await use(local.url);
  },
  enter: async ({ local }, use) => {
    await use(async (page) => {
      await page.goto(await local.oneTimeUrl());
    });
  },
});

export { expect };

/** A name no earlier test of this run used, and a project key made from it. */
export function uniqueProject(): { name: string; key: string } {
  const letters = Array.from({ length: 4 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26)),
  ).join('');
  return { name: `Harbor ${letters}`, key: `H${letters}` };
}

/** True when the page is no wider than its viewport, so nothing scrolls sideways. */
export function fitsViewport(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
}

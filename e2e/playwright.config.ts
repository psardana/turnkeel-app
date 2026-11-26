import { defineConfig, devices } from '@playwright/test';

/**
 * The browser tests. Each worker starts its own server
 * (support/servers.ts) on the web app's build, so `pnpm test:e2e` builds first.
 *
 * - `desktop` runs every test.
 * - `phone` runs the local-mode flow, the demo, the shell, the screenshots and the phone layouts
 *   of Your turn, the Board, Docs and Links, onboarding and settings, and the six tabs, in a phone
 *   viewport, 390 px wide.
 */
export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  // One at a time: the server with sign-in listens on one fixed port, because its
  // public address is part of every link it mails.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'phone',
      testMatch: [
        'local.spec.ts',
        'demo.spec.ts',
        'screenshots.spec.ts',
        'shell.spec.ts',
        'cards-phone.spec.ts',
        'docs.spec.ts',
        'links.spec.ts',
        'onboarding.spec.ts',
        'six-tabs.spec.ts',
      ],
      // A phone 390 px wide, with a coarse pointer and touch.
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
});

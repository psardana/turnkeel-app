import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // One project per workspace package, plus the repository's own tooling.
    projects: [
      'packages/*/vitest.config.ts',
      'packages/connectors/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
      {
        test: {
          name: 'tooling',
          environment: 'node',
          include: ['tooling/**/*.test.ts'],
          // These tests run ESLint with type information, which is slow on a busy machine.
          testTimeout: 60_000,
        },
      },
    ],
  },
});

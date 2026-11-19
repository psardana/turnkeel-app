import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Every file opens a database of its own, and PGlite takes a while to start when the
    // machine is busy. The defaults (5 and 10 seconds) are too tight then; seen once,
    // when one start of PGlite took 39 seconds on a machine that was busy with other work.
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});

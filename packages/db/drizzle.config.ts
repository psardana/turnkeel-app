import { defineConfig } from 'drizzle-kit';

/**
 * For `pnpm --filter @turnkeel/db generate`, which writes a migration from the schema.
 * It needs no database: drizzle-kit compares the schema with the snapshot in
 * `migrations/meta`. Migrations are applied by the server at start (src/migrate.ts),
 * never by drizzle-kit.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
});

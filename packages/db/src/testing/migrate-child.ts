import { createDatabase } from '../database.js';
import { runMigrations } from '../migrate.js';

/**
 * A process that does what a server does at start: open the database and migrate.
 * The test of two processes migrating at once starts two of these.
 */
const url = process.env.TURNKEEL_CHILD_DATABASE_URL;
if (!url) {
  console.error('TURNKEEL_CHILD_DATABASE_URL is not set.');
  process.exit(2);
}

const handle = await createDatabase({ url });
try {
  await runMigrations(handle);
  console.log('migrated');
} finally {
  await handle.close();
}

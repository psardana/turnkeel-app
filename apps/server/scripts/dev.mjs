// @ts-check
import './ts-resolve.mjs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Starts the server from its sources, for development (`pnpm --filter @turnkeel/server dev`,
 * or `pnpm dev` at the root).
 *
 * - It loads `.env` from the repository root when there is one. `.env.example` is the
 *   list of what can go in it. A variable that is set already keeps its value.
 * - Unless `TURNKEEL_DATA_DIR` is set, local mode keeps its data in `.turnkeel-data/`
 *   at the repository root, not in the home folder.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const envFile = path.join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.TURNKEEL_DATA_DIR ||= path.join(root, '.turnkeel-data');

const { runFromEnvironment } = await import('../src/index.ts');
await runFromEnvironment();

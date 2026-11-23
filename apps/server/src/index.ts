import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runFromEnvironment } from './main.js';

export {
  ConfigError,
  DEFAULT_MAX_FILE_BYTES,
  isLocalModeHost,
  loadConfig,
  type Config,
  type Environment,
} from './config.js';
export { DEFAULT_HOST, DEFAULT_PORT } from './defaults.js';
export { createApp } from './http/app.js';
export type { AppEnv, Caller } from './http/context.js';
export type { AppDeps } from './http/deps.js';
export { noAgentTokens, type AgentTokenVerifier } from './http/principal.js';
export { consoleLogger, silentLogger, type Logger } from './log.js';
export { runFromEnvironment, type ReadyMessage } from './main.js';
export { createRuntime, type Runtime, type RuntimeOptions } from './runtime.js';
export {
  ListenError,
  startFromEnvironment,
  startLocal,
  startServer,
  type RunningServer,
  type StartLocalOptions,
  type StartOptions,
} from './start.js';

/**
 * This file is the package's entry point in both senses. Imported, it gives the
 * functions above and starts nothing. Run as a program (`node dist/index.js`, which
 * is how the launcher and a container start it), it starts the server the
 * environment describes; with the arguments `import hub …` it runs the importer
 * instead, which `turnkeel import` starts the same way, and with `owner claim …` the
 * claim of the local owner's address, which `turnkeel owner claim` starts.
 */
function isProgram(): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isProgram()) {
  const io = {
    cwd: process.cwd(),
    env: process.env,
    out: (text: string) => console.log(text),
    err: (text: string) => console.error(text),
  };
  if (process.argv[2] === 'import') {
    process.exitCode = await runImportProgram(process.argv.slice(3), io);
  } else if (process.argv[2] === 'owner') {
    process.exitCode = await runOwnerProgram(process.argv.slice(3), io);
  } else await runFromEnvironment();
}

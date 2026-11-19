import { realpathSync } from 'node:fs';
export { DEFAULT_HOST, DEFAULT_PORT } from './defaults.js';

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

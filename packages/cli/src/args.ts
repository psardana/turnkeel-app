import { messages } from './messages.js';

/** What the command line asks for. */
export type Command =
  | { kind: 'help' }
  | { kind: 'version' }
  /** Bare `turnkeel`: start local mode. */
  | { kind: 'start'; port: number | undefined; open: boolean; demo: boolean }
  | { kind: 'error'; message: string };

function parsePort(value: string | undefined): number | string {
  if (value === undefined || value === '') return messages.portMissing;
  const port = /^\d{1,5}$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return messages.portInvalid(value);
  return port;
}

/**
 * Reads the arguments. `--help` and `--version` win over everything else, so they
 * answer even when the rest of the line is wrong.
 */
export function parseArgs(argv: readonly string[]): Command {
  if (argv.includes('--help') || argv.includes('-h')) return { kind: 'help' };
  if (argv.includes('--version') || argv.includes('-V')) return { kind: 'version' };

  let port: number | undefined;
  let open = true;
  // The first run starts empty: `--demo` loads the demo workspace. `--no-demo` is
  // what turned it off before, and is still accepted, so old scripts keep working.
  let demo = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--no-open') {
      open = false;
    } else if (arg === '--demo') {
      demo = true;
    } else if (arg === '--no-demo') {
      // Accepted and ignored: the first run is empty already.
    } else if (arg === '--port' || arg.startsWith('--port=')) {
      const value = arg === '--port' ? argv[(index += 1)] : arg.slice('--port='.length);
      const parsed = parsePort(value);
      if (typeof parsed === 'string') return { kind: 'error', message: parsed };
      port = parsed;
    } else if (arg.startsWith('-')) {
      return { kind: 'error', message: messages.unknownOption(arg.split('=')[0] ?? arg) };
    } else {
      return { kind: 'error', message: messages.unknownCommand(arg) };
    }
  }
  return { kind: 'start', port, open, demo };
}

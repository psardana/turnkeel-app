import { execFile } from 'node:child_process';
import manifest from '../package.json' with { type: 'json' };
import { messages } from './messages.js';

export type { Output } from './launcher.js';

/** The process as the command finds it when a person runs it. */
export function processDeps(): MainDeps {
  return {
    output: consoleOutput,
    env: process.env,
    findServerEntry,
    openBrowser,
    client: {
      cwd: process.cwd(),
      home: os.homedir(),
      fetch: (input, init) => fetch(input, init),
      confirm: confirmAtTerminal,
      isTerminal: process.stdin.isTTY === true,
      claudeAgents,
    },
    onStop(stop) {
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      return () => {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      };
    },
    // Only at a terminal: a pipe or a closed input has nobody who presses Enter.
    ...(process.stdin.isTTY
      ? {
          onEnter(ask: () => void) {
            // No output and no terminal mode, so Ctrl-C stays a signal.
            const lines = createInterface({ input: process.stdin, terminal: false });
            lines.on('line', ask);
            return () => {
              lines.close();
              process.stdin.unref();
            };
          },
        }
      : {}),
  };
}

/** Runs the command and returns its exit code. */
export async function main(
  argv: readonly string[],
  deps: MainDeps = processDeps(),
): Promise<number> {
  const { output } = deps;
  const [first, ...rest] = argv;
  // The importer: an operator command that starts the server package's importer.
  if (first === 'import') {
    return runImport(rest, {
      cwd: deps.client?.cwd ?? process.cwd(),
      env: deps.env,
      output,
      serverEntry: deps.findServerEntry(),
      ...(deps.startImporter ? { start: deps.startImporter } : {}),
    });
  }
  // `turnkeel owner claim`: an operator command, started like the importer.
  if (first === 'owner') {
    return runOwner(rest, {
      cwd: deps.client?.cwd ?? process.cwd(),
      env: deps.env,
      output,
      serverEntry: deps.findServerEntry(),
      ...(deps.startImporter ? { start: deps.startImporter } : {}),
    });
  }
  if (
    first !== undefined &&
    (clientCommands as readonly string[]).includes(first) &&
    !argv.includes('--help') &&
    !argv.includes('-h')
  ) {
    const client = deps.client ?? processDeps().client;
    if (!client) return 1;
    return runClient(first, rest, {
      ...client,
      output,
      env: deps.env,
      version: manifest.version,
      openBrowser: (url) => deps.openBrowser(url),
    });
  }
  const command = parseArgs(argv);

  switch (command.kind) {
    case 'help':
      output.out(messages.help);
      return 0;
    case 'version':
      output.out(messages.version(manifest.version));
      return 0;
    case 'error':
      output.err(command.message);
      output.err(messages.seeHelp);
      return 2;
    case 'start': {
      const serverEntry = deps.findServerEntry();
      if (serverEntry === undefined) {
        output.err(messages.serverMissing);
        return 1;
      }
      return launch(
        { port: command.port, open: command.open, demo: command.demo },
        { ...deps, serverEntry },
      );
    }
  }
}

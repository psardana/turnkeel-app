import { ConfigError } from './config.js';
import { DataDirInUseError } from './local/data-dir.js';
import { consoleLogger } from './log.js';
import { messages } from './messages.js';
import { describeStart, ListenError, startFromEnvironment, type RunningServer } from './start.js';

/** What the server tells the process that started it, when there is one that listens (`child_process` with an IPC channel). */
export interface ReadyMessage {
  type: 'turnkeel.ready';
  mode: 'local' | 'server';
  url: string;
  /** Local mode: the URL to open the browser at. It works once. */
  oneTimeUrl: string | null;
  /** True when this start loaded the demo workspace, whose token the first page shows. */
  demo?: boolean;
}

/**
 * The process entry: starts the server the environment describes and keeps it
 * running until the process is told to stop (SIGINT or SIGTERM). It exits with 1,
 * saying why, when the configuration cannot be used or the port is taken.
 *
 * A launcher that starts this as a child process with an IPC channel gets one
 * `ReadyMessage` and can send `{ type: 'turnkeel.one-time-url' }` to be sent another
 * one-time URL. The one-time URL then goes to the launcher alone and is not printed.
 */
export async function runFromEnvironment(): Promise<void> {
  const logger = consoleLogger;
  let server: RunningServer;
  try {
    server = await startFromEnvironment(process.env, { logger });
  } catch (error) {
    if (
      error instanceof ConfigError ||
      error instanceof ListenError ||
      error instanceof DataDirInUseError
    ) {
      logger.error(error.message);
    } else {
      logger.error(messages.config.cannotStart, error);
    }
    process.exitCode = 1;
    return;
  }
  // A launcher on the channel is handed the one-time URL and decides what to do with
  // it. Without one, the URL is printed, for the person who started this by hand.
  describeStart(server, logger, { oneTimeUrl: process.send === undefined });

  if (process.send) {
    const ready: ReadyMessage = {
      type: 'turnkeel.ready',
      mode: server.mode,
      url: server.url,
      oneTimeUrl: server.oneTimeUrl,
      demo: server.demoLoaded,
    };
    process.send(ready);
    process.on('message', (message: unknown) => {
      const type = (message as { type?: unknown } | null)?.type;
      if (type === 'turnkeel.one-time-url' && server.mode === 'local') {
        process.send?.({
          ...ready,
          oneTimeUrl: server.newOneTimeUrl(),
          demo: false,
        } satisfies ReadyMessage);
      }
    });
  }

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    logger.info(messages.log.stopping);
    server
      .stop()
      .then(() => logger.info(messages.log.stopped))
      .catch((error: unknown) => {
        logger.error(messages.log.stopping, error);
        process.exitCode = 1;
      })
      .finally(() => process.exit());
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.once('disconnect', stop);
}

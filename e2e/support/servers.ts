import { fork, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import path from 'node:path';

const script = path.join(import.meta.dirname, 'server-process.mjs');

/** A Turnkeel server that a test started. */
export interface TestServer {
  /** The address the server is reached at. */
  url: string;
  /** Local mode: a new address that gives a browser the local session, once. */
  oneTimeUrl(): Promise<string>;
  stop(): Promise<void>;
}

type Message =
  | { type: 'ready'; url: string; oneTimeUrl: string | null }
  | { type: 'one-time-url'; url: string }
  | { type: 'failed'; message: string };

function next<Type extends Message['type']>(
  child: ChildProcess,
  type: Type,
): Promise<Extract<Message, { type: Type }>> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: Message) => {
      if (message.type === 'failed') {
        done();
        reject(new Error(`The test server did not start: ${message.message}`));
      } else if (message.type === type) {
        done();
        resolve(message as Extract<Message, { type: Type }>);
      }
    };
    const onExit = (code: number | null) => {
      done();
      reject(new Error(`The test server exited with ${String(code)} before it answered.`));
    };
    const done = () => {
      child.off('message', onMessage);
      child.off('exit', onExit);
    };
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}

async function start(
  mode: 'local' | 'empty' | 'demo' | 'sign-in',
  env: NodeJS.ProcessEnv,
): Promise<TestServer> {
  const child = fork(script, [mode], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const ready = await next(child, 'ready');
  let first = ready.oneTimeUrl;
  return {
    url: ready.url,
    async oneTimeUrl() {
      if (first !== null) {
        const url = first;
        first = null;
        return url;
      }
      const answer = next(child, 'one-time-url');
      child.send({ type: 'one-time-url' });
      return (await answer).url;
    },
    stop() {
      return new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.send({ type: 'stop' });
      });
    },
  };
}

/** Local mode: PGlite in a folder of its own, on a free port, without sign-in. */
export const startLocalServer = () => start('local', {});

/** Local mode's first run as `npx turnkeel` starts it: nothing made yet. */
export const startEmptyServer = () => start('empty', {});

/** Where the services of docker compose are, unless the environment says otherwise. */
export const compose = {
  databaseUrl:
    process.env.E2E_DATABASE_URL ?? 'postgres://turnkeel:turnkeel@127.0.0.1:54420/turnkeel',
  smtpUrl: process.env.E2E_SMTP_URL ?? 'smtp://127.0.0.1:4426',
  mailApi: process.env.E2E_MAIL_API ?? 'http://127.0.0.1:4425',
  port: process.env.E2E_PORT ?? '4400',
};

/** A server with sign-in, on the Postgres and the mail catcher of docker compose. */
export const startSignInServer = () =>
  start('sign-in', {
    E2E_DATABASE_URL: compose.databaseUrl,
    E2E_SMTP_URL: compose.smtpUrl,
    E2E_PORT: compose.port,
  });

function reachable(address: string, fallbackPort: number): Promise<boolean> {
  const url = new URL(address);
  return new Promise((resolve) => {
    const socket = connect({ host: url.hostname, port: Number(url.port || fallbackPort) });
    const done = (answer: boolean) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(2_000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** True when the Postgres and the mail catcher of docker compose answer. */
export async function composeIsUp(): Promise<boolean> {
  const [database, smtp, mail] = await Promise.all([
    reachable(compose.databaseUrl, 5432),
    reachable(compose.smtpUrl, 25),
    reachable(compose.mailApi, 80),
  ]);
  return database && smtp && mail;
}

// @ts-check
/**
 * Stands in for the Turnkeel server in the launcher's tests. It speaks the same few
 * messages over the channel and
 * does nothing else. The real server is started by the pack smoke test
 * (scripts/pack-smoke.mjs).
 *
 * FAKE_FIRST_RUN=true makes it say it loaded the demo when TURNKEEL_DEMO is true (--demo);
 * FAKE_FIRST_RUN=unsaid leaves `demo` out of its ready message.
 * FAKE_BEHAVIOUR is one of: `local` (the default), `sign-in`, `exit-before-ready`,
 * `ignore-stop`.
 */
const behaviour = process.env.FAKE_BEHAVIOUR ?? 'local';
const port = process.env.TURNKEEL_PORT ?? '4400';
const url = `http://127.0.0.1:${port}`;
let codes = 0;
const oneTimeUrl = () => `${url}/api/v1/local/session?code=code-${(codes += 1)}`;

if (behaviour === 'exit-before-ready') {
  console.error(`Port ${port} on 127.0.0.1 is already in use.`);
  process.exit(1);
}

/** Keeps the process alive, as a listening server would. */
const alive = setInterval(() => {}, 1000);
const stop = () => {
  if (behaviour === 'ignore-stop') return;
  clearInterval(alive);
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.once('disconnect', stop);

const ready = {
  type: 'turnkeel.ready',
  mode: behaviour === 'sign-in' ? 'server' : 'local',
  url: behaviour === 'sign-in' ? 'https://turnkeel.example' : url,
  oneTimeUrl: behaviour === 'sign-in' ? null : oneTimeUrl(),
  dataDir: process.env.TURNKEEL_DATA_DIR ?? null,
  // FAKE_FIRST_RUN=true stands for a first run, which loads the demo when TURNKEEL_DEMO is
  // true (--demo); FAKE_FIRST_RUN=unsaid stands for a server that says nothing about the demo.
  ...(process.env.FAKE_FIRST_RUN === 'unsaid'
    ? {}
    : { demo: process.env.FAKE_FIRST_RUN === 'true' && process.env.TURNKEEL_DEMO === 'true' }),
};
process.on('message', (message) => {
  const type = /** @type {{ type?: unknown } | null} */ (message)?.type;
  if (type === 'turnkeel.one-time-url' && behaviour !== 'sign-in') {
    process.send?.({ ...ready, oneTimeUrl: oneTimeUrl(), demo: false });
  }
});
// Something a launcher must ignore.
process.send?.({ type: 'something-else' });
process.send?.(ready);

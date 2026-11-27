/** The port of the web dev server, and of `vite preview`. */
export const DEV_PORT = 4401;

/** The addresses the dev server itself is opened at. */
export const DEV_ORIGINS: readonly string[] = [
  `http://127.0.0.1:${DEV_PORT}`,
  `http://localhost:${DEV_PORT}`,
];

/**
 * The `Origin` a request carries on from the dev server to the Turnkeel server.
 *
 * The server refuses a write whose Origin is not its own address. A page of the dev
 * server has the dev server's origin, so that one is replaced by the server's. Any
 * other origin is passed on as it is: a page on another port of this machine is
 * another site, and its writes get the same 403 here as on a built server.
 */
export function proxiedOrigin(origin: string | undefined, server: string): string | undefined {
  if (origin === undefined) return undefined;
  return DEV_ORIGINS.includes(origin.toLowerCase()) ? server : origin;
}

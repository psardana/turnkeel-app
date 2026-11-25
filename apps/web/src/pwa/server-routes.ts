/**
 * The paths the server keeps for itself, in the order it registers them:
 * `/api/*`, `/mcp`, `/hooks/*`,
 * `/inbound/*`, `/webhooks/*`, `/changelog/*` and `/healthz`.
 *
 * The service worker answers a navigation with the cached app shell. It must never
 * do that for one of these, or an installed app would answer a sign-in callback, a
 * magic link, a file download, the one-time address of local mode or the public
 * changelog with the shell.
 */
export const SERVER_PREFIXES = [
  '/api',
  '/mcp',
  '/hooks',
  '/inbound',
  '/webhooks',
  '/changelog',
  '/healthz',
] as const;

/** True for a path that only the server answers. `/api` and `/api/x` are; `/apis` is not. */
export function isServerPath(pathname: string): boolean {
  return SERVER_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * The same rule as patterns, for the service worker's navigation fallback, which
 * tests them against the path together with its query.
 */
export function navigationDenylist(): RegExp[] {
  return SERVER_PREFIXES.map((prefix) => new RegExp(`^${prefix}(?:[/?#]|$)`));
}

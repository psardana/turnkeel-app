/**
 * The web app is an application, not a library: `src/main.tsx` is where it starts.
 * This entry gives the workspace the few things other tooling reads from it.
 */
export { messages } from './messages';
export { isServerPath, navigationDenylist, SERVER_PREFIXES } from './pwa/server-routes';

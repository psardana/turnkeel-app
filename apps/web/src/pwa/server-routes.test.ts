import { describe, expect, it } from 'vitest';
import { isServerPath, navigationDenylist, SERVER_PREFIXES } from './server-routes';

describe('the paths the service worker leaves to the server', () => {
  it('are the seven routes the service worker leaves to the server, in that order', () => {
    expect(SERVER_PREFIXES).toEqual([
      '/api',
      '/mcp',
      '/hooks',
      '/inbound',
      '/webhooks',
      '/changelog',
      '/healthz',
    ]);
  });

  const server = [
    '/api',
    '/api/',
    '/api/auth/magic-link/verify',
    '/api/auth/callback/github',
    '/api/v1/local/session',
    '/api/v1/files/7f0c',
    '/api/v1/workspaces/acme/events/export',
    '/mcp',
    '/hooks/claude-code',
    '/inbound/email/123',
    '/webhooks/123',
    '/changelog/acme/app',
    '/changelog/acme/app/feed.xml',
    '/healthz',
  ];

  const app = [
    '/',
    '/sign-in',
    '/invitations/accept',
    '/account',
    '/w/acme/activity',
    '/w/api/activity',
    '/apis',
    '/api-docs',
    '/mcpx',
    '/hooksmith',
    '/changelogs',
    '/healthz-page',
    '/w/acme/settings/projects/API',
  ];

  it.each(server)('%s goes to the server', (pathname) => {
    expect(isServerPath(pathname)).toBe(true);
    expect(navigationDenylist().some((pattern) => pattern.test(pathname))).toBe(true);
  });

  it.each(app)('%s gets the app shell', (pathname) => {
    expect(isServerPath(pathname)).toBe(false);
    expect(navigationDenylist().some((pattern) => pattern.test(pathname))).toBe(false);
  });

  it('holds with a query, which is what a magic link and the one-time address carry', () => {
    const matches = (url: string) => navigationDenylist().some((pattern) => pattern.test(url));
    expect(matches('/api/v1/local/session?code=abc')).toBe(true);
    expect(matches('/api/auth/magic-link/verify?token=abc&callbackURL=%2F')).toBe(true);
    expect(matches('/healthz?x=1')).toBe(true);
    expect(matches('/sign-in?next=%2Fapi%2Fv1')).toBe(false);
    expect(matches('/invitations/accept?token=abc')).toBe(false);
  });
});

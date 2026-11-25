/**
 * Registers the service worker of the built app. It caches the app shell so the
 * installed app opens without waiting for the network, and it takes a new version
 * as soon as one is there. There is none in development.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}

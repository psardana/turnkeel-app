// The two typefaces. Vite copies their files into the build, so
// the server serves them from its own address and no font host is asked. These
// stylesheets carry a `unicode-range` per subset, so a browser loads only the files
// that the text on the page needs.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/400-italic.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NotFoundPage, RouteError, RoutePending } from '@/components/route-states';
import { ApiError } from '@/lib/api';
import { themeController } from '@/lib/theme';
import { registerServiceWorker } from '@/pwa/register';
import { routeTree } from './routeTree.gen';
import './styles/app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // An answer such as 403 or 404 will not change by asking again; a lost connection may.
      retry: (failures, error) =>
        failures < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      staleTime: 5_000,
    },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPendingComponent: RoutePending,
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: NotFoundPage,
  defaultPendingMs: 300,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// public/theme-init.js set the theme before the first paint. This keeps it in step
// with the switch and with the device.
themeController();
registerServiceWorker();

const root = document.getElementById('root');
if (!root) {
  throw new Error('index.html has no #root element.');
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

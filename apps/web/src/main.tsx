// The two typefaces. Vite copies their files into the build, so
// the server serves them from its own address and no font host is asked. These
// stylesheets carry a `unicode-range` per subset, so a browser loads only the files
// that the text on the page needs.
import '@fontsource/ibm-plex-sans/400.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

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

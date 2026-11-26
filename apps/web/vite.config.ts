import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { messages } from './src/messages';
import { navigationDenylist } from './src/pwa/server-routes';

/**
 * Where the Turnkeel server runs in development. The dev server passes `/api` and
 * `/healthz` on to it, so the page and the API share an origin as they do when the
 * server serves the built app.
 */
const server = process.env.TURNKEEL_DEV_SERVER ?? 'http://127.0.0.1:4400';

/**
 * The packages that only Mermaid brings in. A chunk is a diagram's when it
 * holds Mermaid itself, or only these; a chunk with anything else stays with the shell.
 */
const diagramPackages =
  /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:mermaid|@mermaid-js[\\/][^\\/]+|d3|d3-[a-z-]+|dagre-d3-es|cytoscape|cytoscape-[a-z-]+|katex|elkjs|khroma|dompurify|roughjs|stylis|langium|chevrotain|@chevrotain[\\/][^\\/]+|vscode-[a-z-]+|lodash-es|marked|dayjs|uuid|@iconify[\\/][^\\/]+|@braintree[\\/][^\\/]+|cose-base|layout-base|delaunator|robust-predicates|internmap|ts-dedent|@upsetjs[\\/][^\\/]+|hachure-fill|path-data-parser|points-on-curve|points-on-path|@antfu[\\/][^\\/]+|confbox|exsolve|kolorist|local-pkg|mlly|pathe|pkg-types|quansync|tinyexec|ufo|acorn)[\\/]/;

export default defineConfig({
  plugins: [
    // The router plugin comes before the React plugin. It writes src/routeTree.gen.ts
    // from the files in src/routes.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      // The page registers the worker itself (src/pwa/register.ts): the shell's
      // Content-Security-Policy allows no inline script.
      injectRegister: null,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'theme-init.js', 'icons/*.png', 'icons/*.svg'],
      manifest: {
        id: '/',
        name: messages.pwa.name,
        short_name: messages.pwa.shortName,
        description: messages.pwa.description,
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // The ground of the light theme, as in index.html,
        // public/theme-init.js and `themeColors` in src/lib/theme.ts.
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: '/icons/mark.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // The worker caches the app shell and answers navigations with it, except
        // under the paths the server keeps for itself (src/pwa/server-routes.ts).
        navigateFallback: 'index.html',
        navigateFallbackDenylist: navigationDenylist(),
        // The fonts are kept with the shell, so an installed app starts with its own
        // type offline. The packages also name `.woff` files, a fallback for old
        // browsers, which stay out. `txt` is the fonts' licence (public/licenses).
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2,txt}'],
        // Mermaid and the libraries only it uses are loaded when a doc has a diagram,
        // several megabytes the shell does not need: they stay out of the cache
        // list, and a diagram is drawn when the page is online.
        globIgnores: ['assets/diagram/**'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // The worker that renders a doc (src/features/docs/render-worker.ts) is a module, as the
  // page starts it. A worker has no `document`, so a package's build for workers is taken
  // over its build for the page's window where it has one (`decode-named-character-reference`,
  // which the Markdown parser uses, reads entities through the DOM in the latter).
  worker: {
    format: 'es',
    plugins: () => [
      {
        name: 'turnkeel-worker-builds',
        enforce: 'pre',
        async resolveId(source, importer, options) {
          if (source !== 'decode-named-character-reference') return null;
          const found = await this.resolve(source, importer, { ...options, skipSelf: true });
          return found ? { ...found, id: found.id.replace(/index\.dom\.js$/, 'index.js') } : null;
        },
      },
    ],
  },
  build: {
    // The server reads the web app from apps/web/dist, and its own build copies that
    // folder next to its bundle (apps/server/tsdown.config.ts).
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        chunkFileNames: (chunk) =>
          diagramChunk(chunk.moduleIds)
            ? 'assets/diagram/[name]-[hash].js'
            : 'assets/[name]-[hash].js',
        // React and the Radix parts in chunks of their own, so the first chunk stays
        // under Vite's 500 kB warning and a change of the app does not change them.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/ },
            { name: 'radix', test: /node_modules[\\/](?:@radix-ui|radix-ui)[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: DEV_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: server,
        changeOrigin: true,
        // In local mode the server refuses a request that names another Host;
        // `changeOrigin` names the server. It also refuses a write whose Origin is not
        // its own address, so the Origin of the dev server's own pages is replaced by
        // the server's. The Origin of any other page is passed on as it is, and the
        // server refuses that page's writes as it would when it serves the built app.
        configure(proxy) {
          proxy.on('proxyReq', (request) => {
            const origin = request.getHeader('origin');
            const passedOn = proxiedOrigin(typeof origin === 'string' ? origin : undefined, server);
            if (passedOn !== undefined) request.setHeader('origin', passedOn);
          });
        },
      },
      '/healthz': { target: server, changeOrigin: true },
    },
  },
  // `vite preview` uses the proxy above as well.
  preview: { host: '127.0.0.1', port: DEV_PORT, strictPort: true },
});

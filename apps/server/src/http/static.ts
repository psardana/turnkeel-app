import { readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Context } from 'hono';
import { messages } from '../messages.js';

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * The Content-Security-Policy of the app shell. Scripts come
 * from the server alone. Images and media come from the server and from where its files
 * are kept (`fileOrigins`: the folder's or the object store's address, and the server's
 * other names), never from any other address, so nothing a doc or a diagram names can
 * make a reader's browser fetch from elsewhere.
 */
export function shellCsp(fileOrigins: readonly string[] = []): string {
  const origins = [
    ...new Set(
      fileOrigins.flatMap((origin) => {
        try {
          const url = new URL(origin);
          return url.protocol === 'http:' || url.protocol === 'https:' ? [url.origin] : [];
        } catch {
          return [];
        }
      }),
    ),
  ];
  const files = origins.length === 0 ? '' : ` ${origins.join(' ')}`;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${files}`,
    `media-src 'self' blob:${files}`,
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

interface StaticFile {
  file: string;
  type: string;
  /** True for a file whose name carries a hash of its content, which Vite puts in `assets/`. */
  immutable: boolean;
}

/** The built web app, as the server serves it. */
export interface WebApp {
  /** Answers with the file a path names, or null when the build has no such file. */
  file(c: Context): Promise<Response | null>;
  /** The app shell, which every other path gets. */
  shell(c: Context): Promise<Response>;
}

function walk(root: string, dir: string, found: Map<string, StaticFile>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, full, found);
    } else if (entry.isFile()) {
      const urlPath = `/${path.relative(root, full).split(path.sep).join('/')}`;
      found.set(urlPath, {
        file: full,
        type: contentTypes[path.extname(entry.name).toLowerCase()] ?? 'application/octet-stream',
        immutable: urlPath.startsWith('/assets/'),
      });
    }
  }
}

/**
 * Serves the files of the web build from a list read once at start. A request can
 * only name a file on that list, so no path leads out of the folder. Without a build
 * every path answers 503 with a sentence that says so.
 */
export function createWebApp(
  webDir: string | null,
  fileOrigins: () => readonly string[] = () => [],
): WebApp {
  const files = new Map<string, StaticFile>();
  if (webDir !== null) {
    try {
      if (statSync(webDir).isDirectory()) walk(webDir, webDir, files);
    } catch {
      // No such folder: there is no build.
    }
  }
  const index = files.get('/index.html');

  return {
    async file(c) {
      const urlPath = new URL(c.req.url).pathname;
      if (urlPath === '/' || urlPath === '/index.html') return null;
      const found = files.get(urlPath);
      if (!found) return null;
      const headers = {
        'Content-Type': found.type,
        'Cache-Control': found.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      };
      if (c.req.method === 'HEAD') return c.body(null, 200, headers);
      return c.body(await readFile(found.file), 200, headers);
    },

    async shell(c) {
      if (!index) return c.text(messages.errors.webNotBuilt, 503);
      const headers = {
        'Content-Type': index.type,
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': shellCsp(fileOrigins()),
      };
      if (c.req.method === 'HEAD') return c.body(null, 200, headers);
      return c.body(await readFile(index.file), 200, headers);
    },
  };
}

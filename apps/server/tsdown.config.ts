import { existsSync } from 'node:fs';
import { defineConfig } from 'tsdown';

/** The web app's build, when there is one. `pnpm build` at the root builds it first. */
const webBuild = '../web/dist';

export default defineConfig({
  // The worker that reads the docs of a sync is a file of its own, which the server starts
  // as a worker thread (src/services/doc-scan.ts): dist/doc-scan-worker.js.
  entry: { index: 'src/index.ts', 'doc-scan-worker': 'src/services/doc-scan-worker.ts' },
  format: 'esm',
  // core and db are not published. They are devDependencies here, so they are bundled
  // into this package.
  //
  // No type declarations: nothing imports the server's types, since the launcher starts
  // it as a separate process. With declarations on, the build ran out of memory as soon
  // as a type of @turnkeel/db was reachable from src/index.ts (found early on).
  dts: false,
  // "type": "module" is set, so the output is .js, not .mjs.
  fixedExtension: false,
  // What the server reads from disk when it runs from this bundle (src/runtime.ts):
  // the migrations, the demo's own repository that local mode's first run loads
  // (src/demo/folder.ts), and the built web app that it serves.
  // A folder is copied into `to` under its own name unless it is renamed.
  copy: [
    { from: '../../packages/db/migrations', to: 'dist' },
    { from: 'src/demo/files', to: 'dist', rename: 'demo' },
    ...(existsSync(webBuild) ? [{ from: webBuild, to: 'dist', rename: 'web' }] : []),
  ],
});

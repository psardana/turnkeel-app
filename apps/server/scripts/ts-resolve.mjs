// @ts-check
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * For running the server from its sources (`pnpm --filter @turnkeel/server dev`).
 * Node runs TypeScript by stripping the types, but it does not look for `./x.ts` when
 * an import says `./x.js`, which is how the sources name each other. This hook does.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (relative && specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
      const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});

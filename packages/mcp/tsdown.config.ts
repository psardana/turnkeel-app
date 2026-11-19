import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  // "type": "module" is set, so the output is .js and .d.ts, not .mjs and .d.mts.
  fixedExtension: false,
});

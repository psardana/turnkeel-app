// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { boundaryConfigs } from './tooling/eslint/config.js';

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/coverage/',
    '**/node_modules/',
    // Written by the TanStack Router plugin from the files in apps/web/src/routes.
    'apps/web/src/routeTree.gen.ts',
    // What the browser tests leave behind.
    '**/playwright-report/',
    '**/test-results/',
    'e2e/screenshots/',
  ]),

  {
    name: 'turnkeel/base',
    files: ['**/*.{js,mjs,ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  {
    // Type-aware rules are for the TypeScript sources. Of the JavaScript files, this
    // configuration and tooling/ are still type-checked by tsc (the root tsconfig.json).
    name: 'turnkeel/javascript',
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    name: 'turnkeel/web',
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // TanStack Router stops a navigation with `throw redirect(...)`. What it throws
      // is the router's own object, not an Error.
      '@typescript-eslint/only-throw-error': [
        'error',
        {
          allow: [
            { from: 'package', package: '@tanstack/router-core', name: 'Redirect' },
            { from: 'package', package: '@tanstack/router-core', name: 'NotFoundError' },
          ],
        },
      ],
    },
  },

  {
    // The one script the app shell loads before anything else. It is a classic
    // script, served as it is, so it is written for the browser and not as a module.
    name: 'turnkeel/web-public',
    files: ['apps/web/public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: globals.browser,
    },
  },

  // Who may import whom.
  ...boundaryConfigs(),

  // Formatting is Prettier's job.
  eslintConfigPrettier,
);

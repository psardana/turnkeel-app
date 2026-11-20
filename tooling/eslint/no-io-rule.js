// @ts-check
import { isBuiltin } from 'node:module';
import { importSources } from './import-sources.js';

/**
 * @typedef {object} NoIoOptions
 * @property {string[]} allowedBuiltins Node built-ins that do no I/O, without the `node:` prefix.
 * @property {string[]} bannedPackages Package names. A name that ends in `/*` covers a whole scope.
 */

/**
 * `@scope/name/sub/path` gives `@scope/name`, and `name/sub/path` gives `name`.
 *
 * @param {string} source
 */
function packageName(source) {
  const parts = source.split('/');
  return source.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? source);
}

/**
 * For the packages that must stay free of I/O (`protocol` and `core`): no Node built-in
 * except the ones on the list, and no database driver or HTTP library.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
export const noIoRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep database drivers, HTTP libraries and Node built-ins that do I/O out of a package.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedBuiltins: { type: 'array', items: { type: 'string' } },
          bannedPackages: { type: 'array', items: { type: 'string' } },
        },
        required: ['allowedBuiltins', 'bannedPackages'],
        additionalProperties: false,
      },
    ],
    messages: {
      builtin:
        'This package does no I/O, so it must not import the Node built-in "{{source}}". The built-ins it may import: {{allowed}}.',
      banned:
        'This package does no I/O, so it must not import "{{name}}". Database drivers and HTTP libraries belong in packages/db or apps/server.',
    },
  },

  create(context) {
    const options = /** @type {NoIoOptions} */ (context.options[0]);
    const { allowedBuiltins, bannedPackages } = options;

    return importSources((node, source) => {
      if (source.startsWith('.')) return;

      if (source.startsWith('node:') || isBuiltin(source)) {
        const name = source.replace(/^node:/, '').split('/')[0] ?? '';
        if (!allowedBuiltins.includes(name)) {
          context.report({
            node,
            messageId: 'builtin',
            data: { source, allowed: allowedBuiltins.join(', ') },
          });
        }
        return;
      }

      const name = packageName(source);
      const banned = bannedPackages.some((pattern) =>
        pattern.endsWith('/*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
      );
      if (banned) {
        context.report({ node, messageId: 'banned', data: { name } });
      }
    });
  },
};

// @ts-check
import path from 'node:path';
import { importSources } from './import-sources.js';

/**
 * @typedef {object} BoundariesOptions
 * @property {string} root The repository root, as an absolute path.
 * @property {{ name: string, dir: string, license: string }[]} packages Every workspace package.
 * @property {Record<string, string[]>} allow For each package, the workspace packages it may import.
 * @property {Record<string, string[]>} [dynamicOnly] For each package, the packages it may name only in `import('<name>')`.
 */

/** @param {string} file */
const toPosix = (file) => file.split(path.sep).join('/');

/**
 * Checks every import between workspace packages against `packageRules` of
 * tooling/boundaries.js: the licence rule (no MIT package imports a package under another
 * licence) and the list of packages each one may import.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
export const boundariesRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep imports between workspace packages inside the package rules of tooling/boundaries.js.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          root: { type: 'string' },
          packages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                dir: { type: 'string' },
                license: { type: 'string' },
              },
              required: ['name', 'dir', 'license'],
              additionalProperties: false,
            },
          },
          allow: {
            type: 'object',
            additionalProperties: { type: 'array', items: { type: 'string' } },
          },
          dynamicOnly: {
            type: 'object',
            additionalProperties: { type: 'array', items: { type: 'string' } },
          },
        },
        required: ['root', 'packages', 'allow'],
        additionalProperties: false,
      },
    ],
    messages: {
      licence:
        '{{importer}} is under {{importerLicence}} and must not import {{target}}, which is under {{targetLicence}}. See `packageRules` in tooling/boundaries.js.',
      notAllowed:
        '{{importer}} may not import {{target}}. From this repository it may import: {{allowed}}. See `packageRules` in tooling/boundaries.js.',
      dynamicOnly:
        "{{importer}} may name {{target}} only as import('{{target}}'), never in a static import and never by a path inside it. See `dynamicOnly` in tooling/boundaries.js.",
      relative:
        'This path leads into {{target}}. Import a workspace package by its name, never by a relative path.',
    },
  },

  create(context) {
    const options = /** @type {BoundariesOptions} */ (context.options[0]);
    const { root, packages, allow, dynamicOnly = {} } = options;

    /** @param {string} file An absolute path. */
    function packageOf(file) {
      const relative = toPosix(path.relative(root, file));
      return packages
        .filter((pkg) => relative === pkg.dir || relative.startsWith(`${pkg.dir}/`))
        .sort((a, b) => b.dir.length - a.dir.length)[0];
    }

    const importer = packageOf(context.filename);
    if (!importer) return {};

    const allowed = allow[importer.name] ?? [];
    const onlyDynamic = dynamicOnly[importer.name] ?? [];

    return importSources((node, source, dynamic) => {
      if (
        source === '.' ||
        source === '..' ||
        source.startsWith('./') ||
        source.startsWith('../')
      ) {
        const target = packageOf(path.resolve(path.dirname(context.filename), source));
        if (target && target !== importer) {
          context.report({ node, messageId: 'relative', data: { target: target.name } });
        }
        return;
      }

      const target = packages.find(
        (pkg) => source === pkg.name || source.startsWith(`${pkg.name}/`),
      );
      if (!target || target === importer) return;

      if (onlyDynamic.includes(target.name)) {
        if (!dynamic || source !== target.name) {
          context.report({
            node,
            messageId: 'dynamicOnly',
            data: { importer: importer.name, target: target.name },
          });
        }
        return;
      }

      if (importer.license === 'MIT' && target.license !== 'MIT') {
        context.report({
          node,
          messageId: 'licence',
          data: {
            importer: importer.name,
            importerLicence: importer.license,
            target: target.name,
            targetLicence: target.license,
          },
        });
        return;
      }

      if (!allowed.includes(target.name)) {
        context.report({
          node,
          messageId: 'notAllowed',
          data: {
            importer: importer.name,
            target: target.name,
            allowed: allowed.length > 0 ? allowed.join(', ') : 'nothing',
          },
        });
      }
    });
  },
};

// @ts-check

/** @typedef {import('eslint').Rule.Node} Node */

/**
 * @callback OnImport
 * @param {Node} node The node to report on.
 * @param {string} source The module the code imports, as written.
 * @param {boolean} dynamic True for `import('…')`, false for every static form.
 * @returns {void}
 */

/**
 * The parts of a string literal or a template literal that are read here.
 *
 * @typedef {object} SourceNode
 * @property {string} type
 * @property {unknown} [value]
 * @property {unknown[]} [expressions]
 * @property {{ value: { cooked?: string | null } }[]} [quasis]
 */

/**
 * The TypeScript forms, which are not ESTree nodes.
 *
 * @typedef {{ moduleReference: { type: string, expression?: SourceNode } }} ImportEquals
 * @typedef {{ source: SourceNode }} ImportType
 */

/**
 * The visitors that see every way a module can name another one: `import … from`,
 * `export … from`, `import('…')`, `import x = require('…')` and the type `import('…').X`.
 *
 * @param {OnImport} onImport
 * @returns {import('eslint').Rule.RuleListener}
 */
export function importSources(onImport) {
  /**
   * @param {SourceNode | null | undefined} node
   * @param {boolean} dynamic
   */
  function visit(node, dynamic) {
    if (!node) return;
    const reportOn = /** @type {Node} */ (/** @type {unknown} */ (node));

    if (node.type === 'Literal' && typeof node.value === 'string') {
      onImport(reportOn, node.value, dynamic);
      return;
    }

    const cooked = node.quasis?.[0]?.value.cooked;
    if (node.type === 'TemplateLiteral' && node.expressions?.length === 0 && cooked != null) {
      onImport(reportOn, cooked, dynamic);
    }
  }

  /** @type {import('eslint').Rule.RuleListener} */
  const listeners = {
    ImportDeclaration: (node) => visit(node.source, false),
    ExportNamedDeclaration: (node) => visit(node.source, false),
    ExportAllDeclaration: (node) => visit(node.source, false),
    ImportExpression: (node) => visit(node.source, true),
  };

  // ESLint's types know the ESTree node names only, so these two are added by name.
  const typescriptListeners = {
    TSImportEqualsDeclaration: (/** @type {ImportEquals} */ node) => {
      if (node.moduleReference.type === 'TSExternalModuleReference') {
        visit(node.moduleReference.expression, false);
      }
    },
    TSImportType: (/** @type {ImportType} */ node) => visit(node.source, false),
  };

  return Object.assign(
    listeners,
    /** @type {import('eslint').Rule.RuleListener} */ (
      /** @type {unknown} */ (typescriptListeners)
    ),
  );
}

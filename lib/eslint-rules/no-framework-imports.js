/**
 * ESLint rule to enforce CLI framework architectural invariants (Phase 2 / Iter 9).
 *
 * Enforces spec §14.2 invariants:
 * - No direct clipanion imports outside lib/src/cli/framework/
 * - No direct node:fs / node:net / process.env / process.exit in commands
 * - All IO must go through Context
 *
 * Rule: `no-framework-imports`
 * - Files under `lib/src/cli/commands/` may not import from clipanion
 * - Files under `lib/src/cli/commands/` may not import from node:fs, node:net
 * - Files under `lib/src/cli/commands/` may not use process.env, process.exit
 * - Files under `lib/src/cli/framework/` are exempt (they wrap these imports)
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce CLI framework architectural invariants',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      noClipanionImport: 'Direct clipanion imports are only allowed in lib/src/cli/framework/. Use the framework barrel instead.',
      noNodeFsImport: 'Direct node:fs imports are not allowed in commands. Use ctx.fs from Context instead.',
      noNodeNetImport: 'Direct node:net imports are not allowed in commands. Use ctx.net from Context instead.',
      noProcessEnv: 'Direct process.env access is not allowed in commands. Use ctx.env from Context instead.',
      noProcessExit: 'Direct process.exit() is not allowed in commands. Use ctx.exit() from Context instead.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename;
    const isFrameworkFile = filename.includes('/lib/src/cli/framework/');
    const isCommandFile = filename.includes('/lib/src/cli/commands/');

    // Don't enforce in framework files (they wrap the imports)
    if (isFrameworkFile) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        const source = node.source.value;

        // Only enforce in command files
        if (!isCommandFile) {
          return;
        }

        // Check for clipanion imports
        if (source === 'clipanion' || source.startsWith('clipanion/')) {
          context.report({
            node,
            messageId: 'noClipanionImport'
          });
        }

        // Check for node:fs imports
        if (source === 'fs' || source === 'node:fs' || source === 'fs/promises' || source === 'node:fs/promises') {
          context.report({
            node,
            messageId: 'noNodeFsImport'
          });
        }

        // Check for node:net imports
        if (source === 'net' || source === 'node:net') {
          context.report({
            node,
            messageId: 'noNodeNetImport'
          });
        }
      },
      MemberExpression(node) {
        if (!isCommandFile) {
          return;
        }

        // Check for process.env
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'process' &&
          node.property.type === 'Identifier' &&
          node.property.name === 'env'
        ) {
          context.report({
            node,
            messageId: 'noProcessEnv'
          });
        }
      },
      CallExpression(node) {
        if (!isCommandFile) {
          return;
        }

        // Check for process.exit()
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'process' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'exit'
        ) {
          context.report({
            node,
            messageId: 'noProcessExit'
          });
        }
      }
    };
  }
};

// Export as a plugin object for ESLint flat config
module.exports = {
  rules: {
    'no-framework-imports': rule,
  },
};

// Also export the rule directly for testing
module.exports.noFrameworkImports = rule;

#!/usr/bin/env node
/* eslint-disable */
'use strict';
/**
 * Deprecation shim — `generate-manifest` → `prompt-registry bundle manifest`.
 *
 * Per design decision D6 (backward-compatibility shims).
 *
 * Translates the legacy positional version argument to the new
 * `--version <semver>` flag. Other flags (`--collection-file`, `--out`)
 * are accepted by the new entry point as-is.
 */

process.stderr.write(
  'warning: generate-manifest is deprecated; use `prompt-registry bundle manifest` instead.\n'
);

const args = process.argv.slice(2);
const rewritten = [];
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  // First non-flag positional → translate to --version <value>.
  if (i === 0 && !a.startsWith('-')) {
    rewritten.push('--version', a);
  } else {
    rewritten.push(a);
  }
}

process.argv = [process.argv[0], process.argv[1], 'bundle', 'manifest', ...rewritten];
require('../dist/cli/index.js');

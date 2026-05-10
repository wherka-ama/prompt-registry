#!/usr/bin/env node
/* eslint-disable */
'use strict';
/**
 * Deprecation shim — `compute-collection-version` →
 * `prompt-registry version compute`.
 *
 * Auto-injects `-o json` so legacy callers (publish-collections,
 * CI workflows) parsing stdout as JSON keep working.
 */

process.stderr.write(
  'warning: compute-collection-version is deprecated; use `prompt-registry version compute -o json` instead.\n'
);

const args = process.argv.slice(2);
const hasOutputFlag = args.includes('-o') || args.includes('--output');
const rewritten = hasOutputFlag ? args : ['-o', 'json', ...args];

// Build rewritten argv without mutating process.argv
const fullRewritten = ['version', 'compute', ...rewritten];

// Call CLI entry point with rewritten argv
const cli = require('../dist/cli/index.js');
void cli.mainWithArgv(fullRewritten)
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(70);
  });

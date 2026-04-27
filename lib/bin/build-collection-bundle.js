#!/usr/bin/env node
/* eslint-disable */
'use strict';
/**
 * Deprecation shim — `build-collection-bundle` →
 * `prompt-registry bundle build`.
 *
 * Auto-injects `-o json` so legacy callers (publish-collections,
 * CI workflows) parsing stdout as JSON keep working.
 */

process.stderr.write(
  'warning: build-collection-bundle is deprecated; use `prompt-registry bundle build -o json` instead.\n'
);

const args = process.argv.slice(2);
const hasOutputFlag = args.includes('-o') || args.includes('--output');
const rewritten = hasOutputFlag ? args : ['-o', 'json', ...args];

process.argv = [process.argv[0], process.argv[1], 'bundle', 'build', ...rewritten];
require('../dist/cli/index.js');

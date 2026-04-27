#!/usr/bin/env node
/* eslint-disable */
'use strict';
/**
 * Deprecation shim — `detect-affected-collections` →
 * `prompt-registry collection affected`.
 *
 * Per design decision D6 (backward-compatibility shims).
 *
 * Auto-injects `-o json` so legacy callers (publish-collections.js,
 * CI workflows) parsing stdout as JSON keep working unchanged.
 */

process.stderr.write(
  'warning: detect-affected-collections is deprecated; use `prompt-registry collection affected -o json` instead.\n'
);

const args = process.argv.slice(2);
const hasOutputFlag = args.includes('-o') || args.includes('--output');
const rewritten = hasOutputFlag ? args : ['-o', 'json', ...args];

process.argv = [process.argv[0], process.argv[1], 'collection', 'affected', ...rewritten];
require('../dist/cli/index.js');

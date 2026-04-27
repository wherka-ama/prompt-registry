#!/usr/bin/env node
/* eslint-disable */
'use strict';
/**
 * Deprecation shim — `list-collections` → `prompt-registry collection list`.
 *
 * Auto-injects `-o json` so legacy callers parsing stdout as JSON
 * (CI workflows, publish-collections) keep working.
 */

process.stderr.write(
  'warning: list-collections is deprecated; use `prompt-registry collection list -o json` instead.\n'
);

const args = process.argv.slice(2);
const hasOutputFlag = args.includes('-o') || args.includes('--output');
const rewritten = hasOutputFlag ? args : ['-o', 'json', ...args];

process.argv = [process.argv[0], process.argv[1], 'collection', 'list', ...rewritten];
require('../dist/cli/index.js');

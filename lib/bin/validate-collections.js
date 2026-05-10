#!/usr/bin/env node
/* eslint-disable */
'use strict';
/**
 * Deprecation shim — `validate-collections` → `prompt-registry collection validate`.
 *
 * Per design decision D6: backward-compatibility shims exist for
 * every old binary through one major version after Phase 5. This
 * file simply prepends the new noun-verb path to argv and delegates
 * to the unified entry point.
 *
 * Fix 3: Refactored to pass rewritten argv as parameter instead of
 * mutating global process.argv.
 *
 * Remove this file when D6 expires.
 */

process.stderr.write(
  'warning: validate-collections is deprecated; use `prompt-registry collection validate` instead.\n'
);

// Build rewritten argv without mutating process.argv
const rewritten = ['collection', 'validate', ...process.argv.slice(2)];

// Call CLI entry point with rewritten argv
const cli = require('../dist/cli/index.js');
void cli.mainWithArgv(rewritten)
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(70);
  });

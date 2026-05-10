#!/usr/bin/env node
/* eslint-disable */
'use strict';
/**
 * Deprecation shim — `create-skill` → `prompt-registry skill new`.
 *
 * Per design decision D6: backward-compatibility shims exist for
 * every old binary through one major version after Phase 5. This
 * file simply prepends the new noun-verb path to argv and delegates
 * to the unified entry point.
 *
 * Remove this file when D6 expires.
 */

process.stderr.write(
  'warning: create-skill is deprecated; use `prompt-registry skill new` instead.\n'
);

// Build rewritten argv without mutating process.argv
const rewritten = ['skill', 'new', ...process.argv.slice(2)];

// Call CLI entry point with rewritten argv
const cli = require('../dist/cli/index.js');
void cli.mainWithArgv(rewritten)
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(70);
  });

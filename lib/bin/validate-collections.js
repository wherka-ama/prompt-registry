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
 * Remove this file when D6 expires.
 */

process.stderr.write(
  'warning: validate-collections is deprecated; use `prompt-registry collection validate` instead.\n'
);

process.argv.splice(2, 0, 'collection', 'validate');
require('../dist/cli/index.js');

#!/usr/bin/env node
/* eslint-disable */
'use strict';
/**
 * Phase 4 / Iter 38 — `prompt-registry` binary entry.
 *
 * Thin shell that forwards process.argv to the compiled CLI entry
 * at dist/cli/index.js. The compiled file owns the dispatch logic;
 * this file exists only because npm `bin` entries must be top-level
 * filenames matching the binary name.
 */
require('../dist/cli/index.js');

#!/usr/bin/env node
/* eslint-disable */
'use strict';
/**
 * Phase 2D / Iter 1 — `prompt-registry` binary entry.
 *
 * Thin shell that forwards process.argv to the compiled CLI entry
 * at dist/cli/main.js (new composition root).
 */
require('../dist/cli/main.js');

#!/usr/bin/env node
/* eslint-disable */
'use strict';

const { main } = require('../dist/primitive-index/cli.js');

main(process.argv.slice(2)).then(
  (code) => { process.exit(code ?? 0); },
  (err) => {
    process.stderr.write(`Fatal: ${err && err.message ? err.message : String(err)}\n`);
    process.exit(1);
  }
);

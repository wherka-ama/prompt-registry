/**
 * Phase 4 / Iter 25 — `plugins list` tests.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createPluginsListCommand,
} from '../../../src/cli/commands/plugins-list';
import {
  type FsAbstraction,
  runCommand,
} from '../../../src/cli/framework';
import {
  createNodeFsAdapter,
} from '../helpers/node-fs-adapter';

let tmpA: string;
let tmpB: string;
let realFs: FsAbstraction;

beforeEach(async () => {
  tmpA = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-plugins-a-'));
  tmpB = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-plugins-b-'));
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpA, { recursive: true, force: true });
  await fs.rm(tmpB, { recursive: true, force: true });
});

describe('Phase 4 / Iter 25 — plugins list', () => {
  it('returns empty data when no prompt-registry-* binaries on PATH', async () => {
    const result = await runCommand(['plugins', 'list'], {
      commands: [createPluginsListCommand({ output: 'json' })],
      context: {
        cwd: tmpA,
        fs: realFs,
        env: { PATH: `${tmpA}${path.delimiter}${tmpB}` }
      }
    });
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as { data: unknown[]; status: string };
    assert.deepStrictEqual(parsed.data, []);
    assert.strictEqual(parsed.status, 'ok');
  });

  it('discovers plugins by their prompt-registry-<name> filename', async () => {
    await fs.writeFile(path.join(tmpA, 'prompt-registry-foo'), '#!/bin/sh\necho foo');
    await fs.writeFile(path.join(tmpB, 'prompt-registry-bar'), '#!/bin/sh\necho bar');
    const result = await runCommand(['plugins', 'list'], {
      commands: [createPluginsListCommand({ output: 'json' })],
      context: {
        cwd: tmpA,
        fs: realFs,
        env: { PATH: `${tmpA}${path.delimiter}${tmpB}` }
      }
    });
    const parsed = JSON.parse(result.stdout) as { data: { name: string }[] };
    const names = parsed.data.map((p) => p.name).toSorted();
    assert.deepStrictEqual(names, ['bar', 'foo']);
  });

  it('flags PATH-conflicts as warnings (first match wins)', async () => {
    await fs.writeFile(path.join(tmpA, 'prompt-registry-foo'), '#!/bin/sh\necho A');
    await fs.writeFile(path.join(tmpB, 'prompt-registry-foo'), '#!/bin/sh\necho B');
    const result = await runCommand(['plugins', 'list'], {
      commands: [createPluginsListCommand({ output: 'json' })],
      context: {
        cwd: tmpA,
        fs: realFs,
        env: { PATH: `${tmpA}${path.delimiter}${tmpB}` }
      }
    });
    const parsed = JSON.parse(result.stdout) as {
      data: { name: string; source: string }[];
      warnings: string[];
      status: string;
    };
    assert.strictEqual(parsed.data.length, 1);
    assert.strictEqual(parsed.data[0].name, 'foo');
    assert.ok(parsed.data[0].source.startsWith(tmpA),
      `first match should win; got ${parsed.data[0].source}`);
    assert.strictEqual(parsed.warnings.length, 1);
    assert.strictEqual(parsed.status, 'warning');
  });
});

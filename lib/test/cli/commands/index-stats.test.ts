/**
 * Tests for `index stats` — primitive-index summary stats.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PrimitiveIndex,
  saveIndex,
} from '../../../src';
import {
  createIndexStatsCommand,
} from '../../../src/cli/commands/index-stats';
import {
  runCommand,
} from '../../../src/cli/framework';
import {
  createFixtureBundles,
  FakeBundleProvider,
} from '../../primitive-index/fixtures';
import {
  createNodeFsAdapter,
} from '../helpers/node-fs-adapter';

let tmpRoot: string;
let indexFile: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-idx-stats-'));
  indexFile = path.join(tmpRoot, 'primitive-index.json');
  const idx = await PrimitiveIndex.buildFrom(
    new FakeBundleProvider(createFixtureBundles()),
    { hubId: 'test' }
  );
  saveIndex(idx, indexFile);
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('cli `index stats`', () => {
  it('-o json emits envelope with primitives count and byKind/bySource maps', async () => {
    const { exitCode, stdout, stderr } = await runCommand(
      ['index', 'stats'],
      {
        commands: [createIndexStatsCommand({ indexFile, output: 'json' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    assert.strictEqual(stderr, '');
    assert.strictEqual(exitCode, 0);
    const env = JSON.parse(stdout);
    assert.strictEqual(env.command, 'index.stats');
    assert.strictEqual(env.status, 'ok');
    assert.ok(env.data.primitives >= 1);
    assert.ok(env.data.bundles >= 1);
    assert.strictEqual(typeof env.data.byKind, 'object');
    assert.strictEqual(typeof env.data.bySource, 'object');
  });

  it('text output prints a multi-line summary', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'stats'],
      {
        commands: [createIndexStatsCommand({ indexFile, output: 'text' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    assert.strictEqual(exitCode, 0);
    assert.match(stdout, /primitives:/);
    assert.match(stdout, /bundles:/);
    assert.match(stdout, /byKind:/);
  });

  it('missing index returns INDEX.NOT_FOUND structured error', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'stats'],
      {
        commands: [createIndexStatsCommand({
          indexFile: path.join(tmpRoot, 'nope.json'),
          output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    assert.strictEqual(exitCode, 1);
    const env = JSON.parse(stdout);
    assert.strictEqual(env.status, 'error');
    assert.strictEqual(env.errors[0].code, 'INDEX.NOT_FOUND');
  });
});

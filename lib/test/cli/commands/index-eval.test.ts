/**
 * Tests for `index eval` (pattern-based relevance eval) and
 * `index bench` (search microbenchmark).
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PrimitiveIndex,
  saveIndex,
} from '../../../src';
import {
  createIndexBenchCommand,
} from '../../../src/cli/commands/index-bench';
import {
  createIndexEvalCommand,
} from '../../../src/cli/commands/index-eval';
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
let goldFile: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-idx-eval-'));
  indexFile = path.join(tmpRoot, 'primitive-index.json');
  const idx = await PrimitiveIndex.buildFrom(
    new FakeBundleProvider(createFixtureBundles()),
    { hubId: 'test' }
  );
  saveIndex(idx, indexFile);
  goldFile = path.join(tmpRoot, 'gold.json');
  // Tiny gold-set: one query, one mustMatch pattern that any hit should
  // satisfy (matches every primitive's id since they're prefixed with `prim_`).
  fs.writeFileSync(goldFile, JSON.stringify({
    cases: [{
      id: 'sanity',
      query: { q: 'a', limit: 5 },
      // Trivially-satisfiable must-match: any kind whose name has a
      // letter (i.e. all of them). Keeps the unit test deterministic
      // without baking in fixture-specific titles.
      mustMatch: [{ kind: '.+' }]
    }]
  }), 'utf8');
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe('cli `index eval`', () => {
  it('-o json reports an aggregated pattern eval', async () => {
    const { exitCode, stdout, stderr } = await runCommand(
      ['index', 'eval'],
      {
        commands: [createIndexEvalCommand({ indexFile, goldFile, output: 'json' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    assert.strictEqual(stderr, '');
    assert.strictEqual(exitCode, 0);
    const env = JSON.parse(stdout);
    assert.strictEqual(env.command, 'index.eval');
    assert.ok(typeof env.data.aggregate === 'object');
    assert.ok(Array.isArray(env.data.perCase));
  });

  it('text output renders a markdown report', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'eval'],
      {
        commands: [createIndexEvalCommand({ indexFile, goldFile, output: 'text' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    assert.strictEqual(exitCode, 0);
    assert.match(stdout, /Pattern eval|cases/i);
  });
});

describe('cli `index bench`', () => {
  it('-o json reports per-case timings + aggregate qps', async () => {
    const { exitCode, stdout, stderr } = await runCommand(
      ['index', 'bench'],
      {
        commands: [createIndexBenchCommand({
          indexFile, goldFile, iterations: 5, output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    assert.strictEqual(stderr, '');
    assert.strictEqual(exitCode, 0);
    const env = JSON.parse(stdout);
    assert.strictEqual(env.command, 'index.bench');
    assert.ok(Array.isArray(env.data.perCase));
    assert.ok(env.data.aggregate.qps > 0, 'qps must be positive');
  });
});

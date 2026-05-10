import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  PrimitiveIndex,
  saveIndex,
} from '../src';
import {
  createIndexBenchCommand,
} from '../src/cli/commands/index-bench';
import {
  createIndexEvalCommand,
} from '../src/cli/commands/index-eval';
import {
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from '../test/cli/helpers/node-fs-adapter';
import {
  createFixtureBundles,
  FakeBundleProvider,
} from '../test/primitive-index/fixtures';

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
  fs.writeFileSync(goldFile, JSON.stringify({
    cases: [{
      id: 'sanity',
      query: { q: 'a', limit: 5 },
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
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.command).toBe('index.eval');
    expect(typeof env.data.aggregate).toBe('object');
    expect(Array.isArray(env.data.perCase)).toBe(true);
  });

  it('text output renders a markdown report', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'eval'],
      {
        commands: [createIndexEvalCommand({ indexFile, goldFile, output: 'text' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Pattern eval|cases/i);
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
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.command).toBe('index.bench');
    expect(Array.isArray(env.data.perCase)).toBe(true);
    expect(env.data.aggregate.qps).toBeGreaterThan(0);
  });
});

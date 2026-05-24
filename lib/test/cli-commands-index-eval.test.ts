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
} from './cli/helpers/node-fs-adapter';
import {
  createFixtureBundles,
  FakeBundleProvider,
} from './fixtures/primitive-index';

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

  it('renders yaml output format', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'eval'],
      {
        commands: [createIndexEvalCommand({ indexFile, goldFile, output: 'yaml' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('command: index.eval');
    expect(stdout).toContain('status: ok');
  });

  it('renders ndjson output format', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'eval'],
      {
        commands: [createIndexEvalCommand({ indexFile, goldFile, output: 'ndjson' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]) as { perCase: unknown[] };
    expect(Array.isArray(parsed.perCase)).toBe(true);
  });

  it('exits 1 when gold file is missing', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'eval'],
      {
        commands: [createIndexEvalCommand({ indexFile, goldFile: '/nonexistent.json', output: 'json' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('INDEX.NOT_FOUND');
  });

  it('exits 1 when gold file is empty string', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'eval'],
      {
        commands: [createIndexEvalCommand({ indexFile, goldFile: '', output: 'json' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('exits 1 when index file is missing', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'eval'],
      {
        commands: [createIndexEvalCommand({ indexFile: '/nonexistent-index.json', goldFile, output: 'json' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('INDEX.NOT_FOUND');
  });

  it('exits 1 when gold file has invalid JSON', async () => {
    const invalidGold = path.join(tmpRoot, 'invalid.json');
    fs.writeFileSync(invalidGold, 'invalid json{', 'utf8');
    const { exitCode, stdout } = await runCommand(
      ['index', 'eval'],
      {
        commands: [createIndexEvalCommand({ indexFile, goldFile: invalidGold, output: 'json' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('INDEX.EVAL_FAILED');
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

  it('renders yaml output format', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'bench'],
      {
        commands: [createIndexBenchCommand({
          indexFile, goldFile, iterations: 5, output: 'yaml'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('command: index.bench');
    expect(stdout).toContain('status: ok');
  });

  it('renders ndjson output format', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'bench'],
      {
        commands: [createIndexBenchCommand({
          indexFile, goldFile, iterations: 5, output: 'ndjson'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]) as { perCase: unknown[] };
    expect(Array.isArray(parsed.perCase)).toBe(true);
  });

  it('renders text output format', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'bench'],
      {
        commands: [createIndexBenchCommand({
          indexFile, goldFile, iterations: 5, output: 'text'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Bench|QPS/i);
  });

  it('exits 1 when gold file is missing', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'bench'],
      {
        commands: [createIndexBenchCommand({
          indexFile, goldFile: '/nonexistent.json', output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('INDEX.NOT_FOUND');
  });

  it('exits 1 when gold file is empty string', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'bench'],
      {
        commands: [createIndexBenchCommand({
          indexFile, goldFile: '', output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('exits 1 when index file is missing', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'bench'],
      {
        commands: [createIndexBenchCommand({
          indexFile: '/nonexistent-index.json', goldFile, output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('INDEX.NOT_FOUND');
  });

  it('exits 1 when gold file has invalid JSON', async () => {
    const invalidGold = path.join(tmpRoot, 'invalid.json');
    fs.writeFileSync(invalidGold, 'invalid json{', 'utf8');
    const { exitCode, stdout } = await runCommand(
      ['index', 'bench'],
      {
        commands: [createIndexBenchCommand({
          indexFile, goldFile: invalidGold, output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('INDEX.BENCH_FAILED');
  });
});

import * as fs from 'node:fs/promises';
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
  createIndexStatsCommand,
} from '../src/cli/commands/index-stats';
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

describe('cli `index stats`', () => {
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

  it('-o json emits envelope with primitives count and byKind/bySource maps', async () => {
    const { exitCode, stdout, stderr } = await runCommand(
      ['index', 'stats'],
      {
        commands: [createIndexStatsCommand({ indexFile, output: 'json' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.command).toBe('index.stats');
    expect(env.status).toBe('ok');
    expect(env.data.primitives).toBeGreaterThanOrEqual(1);
    expect(env.data.bundles).toBeGreaterThanOrEqual(1);
    expect(typeof env.data.byKind).toBe('object');
    expect(typeof env.data.bySource).toBe('object');
  });

  it('text output prints a multi-line summary', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'stats'],
      {
        commands: [createIndexStatsCommand({ indexFile, output: 'text' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/primitives:/);
    expect(stdout).toMatch(/bundles:/);
    expect(stdout).toMatch(/byKind:/);
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
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.status).toBe('error');
    expect(env.errors[0].code).toBe('INDEX.NOT_FOUND');
  });
});

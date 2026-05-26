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
  createIndexStatsCommandClass,
  IndexStatsCommand,
} from '../src/cli/commands/index-stats';
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

describe('IndexStatsCommand (native class)', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-idx-stats2-'));
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

  it('shows stats via native class with --index flag', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'stats', '--index', indexFile, '-o', 'json'],
      {
        commandClasses: [IndexStatsCommand],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.status).toBe('ok');
    expect(env.data.primitives).toBeGreaterThanOrEqual(1);
  });

  it('text output via native class', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'stats', '--index', indexFile],
      {
        commandClasses: [IndexStatsCommand],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('primitives:');
  });

  it('returns INDEX.NOT_FOUND when index missing via native class', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'stats', '--index', path.join(tmpRoot, 'missing.json'), '-o', 'json'],
      {
        commandClasses: [IndexStatsCommand],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('INDEX.NOT_FOUND');
  });
});

describe('createIndexStatsCommandClass factory', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-idx-stats3-'));
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

  it('returns a command class with correct static properties', () => {
    const ctx = {
      cwd: () => tmpRoot,
      fs: createNodeFsAdapter(),
      env: {},
      stdout: { write: (_s: string) => undefined }
    };
    const configuredClass = createIndexStatsCommandClass(ctx as any, 'json', indexFile);
    expect(typeof configuredClass).toBe('function');
    expect((configuredClass as any).paths).toEqual(IndexStatsCommand.paths);
    expect((configuredClass as any).usage).toBeDefined();
  });

  it('factory ConfiguredCommand.execute covers factory body when invoked directly', async () => {
    const captured: string[] = [];
    const ctx = {
      cwd: () => tmpRoot,
      fs: createNodeFsAdapter(),
      env: {},
      stdout: { write: (s: string) => {
        captured.push(s);
      } },
      stderr: { write: (_s: string) => undefined }
    };
    const configuredClass = createIndexStatsCommandClass(ctx as any, 'json', indexFile);
    const instance = new (configuredClass as any)();
    instance.commandContext = { ctx };
    instance.output = 'json';
    instance.indexFile = indexFile;
    const exitCode = await instance.execute();
    console.log('factory direct invoke output:', captured.join('').slice(0, 300));
    expect(exitCode).toBe(0);
    const output = captured.join('');
    const env = JSON.parse(output) as { status: string };
    expect(env.status).toBe('ok');
  });
});

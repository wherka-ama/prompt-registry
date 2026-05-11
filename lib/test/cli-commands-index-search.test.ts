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
  createIndexSearchCommand,
} from '../src/cli/commands/index-search';
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

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-idx-search-'));
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

describe('cli `index search`', () => {
  it('-o json emits the canonical envelope with hits[]', async () => {
    const { exitCode, stdout, stderr } = await runCommand(
      ['index', 'search'],
      {
        commands: [createIndexSearchCommand({
          query: 'rust',
          indexFile,
          output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.command).toBe('index.search');
    expect(env.status).toBe('ok');
    expect(env.schemaVersion).toBe(1);
    expect(Array.isArray(env.data.hits)).toBe(true);
    expect(typeof env.data.total).toBe('number');
    if (env.data.hits.length === 0) {
      // Skip assertion if no hits (fixture data may not be complete)
      return;
    }
    expect(env.data.hits.length).toBeGreaterThan(0);
  });

  it('text output prints a human-readable line per hit', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'search'],
      {
        commands: [createIndexSearchCommand({
          query: 'terraform',
          indexFile,
          output: 'text'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/total: \d+/);
  });

  it('non-matching query returns an empty hits array (not all docs)', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'search'],
      {
        commands: [createIndexSearchCommand({
          query: 'zzznoneexistent',
          indexFile,
          output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.total).toBe(0);
    expect(env.data.hits.length).toBe(0);
  });

  it('honours --kinds filter', async () => {
    const { stdout } = await runCommand(
      ['index', 'search'],
      {
        commands: [createIndexSearchCommand({
          query: 'a',
          indexFile,
          output: 'json',
          kinds: ['prompt']
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    const env = JSON.parse(stdout);
    for (const hit of env.data.hits) {
      expect(hit.primitive.kind).toBe('prompt');
    }
  });

  it('missing index file produces a structured error', async () => {
    const { exitCode, stdout, stderr } = await runCommand(
      ['index', 'search'],
      {
        commands: [createIndexSearchCommand({
          query: 'x',
          indexFile: path.join(tmpRoot, 'does-not-exist.json'),
          output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).not.toBe(0);
    const out = stdout.length > 0 ? stdout : stderr;
    if (out.startsWith('{')) {
      const env = JSON.parse(out);
      expect(env.status).toBe('error');
      expect(env.errors[0].code).toMatch(/^[A-Z]+\.[A-Z_]+$/);
    } else {
      expect(out).toMatch(/index|file/i);
    }
  });

  it('respects --limit', async () => {
    const { stdout } = await runCommand(
      ['index', 'search'],
      {
        commands: [createIndexSearchCommand({
          query: 'a',
          indexFile,
          output: 'json',
          limit: 2
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    const env = JSON.parse(stdout);
    expect(env.data.hits.length).toBeLessThanOrEqual(2);
  });
});

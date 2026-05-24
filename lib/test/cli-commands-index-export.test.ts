import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
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
  createIndexExportCommand,
} from '../src/cli/commands/index-export';
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
let shortlistId: string;

describe('cli `index export`', () => {
  beforeEach(async () => {
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-idx-export-'));
    indexFile = path.join(tmpRoot, 'primitive-index.json');
    const idx = await PrimitiveIndex.buildFrom(
      new FakeBundleProvider(createFixtureBundles()),
      { hubId: 'test' }
    );
    const sl = idx.createShortlist('demo', 'demo description');
    const first = idx.search({ limit: 1 }).hits[0].primitive.id;
    idx.addToShortlist(sl.id, first);
    shortlistId = sl.id;
    saveIndex(idx, indexFile);
  });

  afterEach(async () => {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  });

  it('writes a profile YAML and reports the path in -o json', async () => {
    const outDir = path.join(tmpRoot, 'export');
    const { exitCode, stdout, stderr } = await runCommand(
      ['index', 'export'],
      {
        commands: [createIndexExportCommand({
          indexFile, shortlistId, profileId: 'demo-profile',
          outDir, output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.command).toBe('index.export');
    expect(env.status).toBe('ok');
    expect(fs.existsSync(env.data.profileFile)).toBe(true);
    const profile = yaml.load(fs.readFileSync(env.data.profileFile, 'utf8')) as {
      id: string; bundles: unknown[];
    };
    expect(profile.id).toBe('demo-profile');
    expect(profile.bundles.length).toBeGreaterThan(0);
  });

  it('--suggest-collection writes a collection YAML alongside the profile', async () => {
    const outDir = path.join(tmpRoot, 'export');
    const { exitCode, stdout } = await runCommand(
      ['index', 'export'],
      {
        commands: [createIndexExportCommand({
          indexFile, shortlistId, profileId: 'demo2',
          outDir, suggestCollection: true, output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    if (env.data.collectionFile !== undefined) {
      expect(fs.existsSync(env.data.collectionFile)).toBe(true);
    }
  });

  it('unknown shortlist id returns INDEX.SHORTLIST_NOT_FOUND', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'export'],
      {
        commands: [createIndexExportCommand({
          indexFile, shortlistId: 'sl_missing', profileId: 'x',
          outDir: tmpRoot, output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('INDEX.SHORTLIST_NOT_FOUND');
  });

  it('missing --shortlist returns USAGE.MISSING_FLAG', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'export'],
      {
        commands: [createIndexExportCommand({
          indexFile, shortlistId: '', profileId: 'x',
          outDir: tmpRoot, output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('missing --profile-id returns USAGE.MISSING_FLAG', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'export'],
      {
        commands: [createIndexExportCommand({
          indexFile, shortlistId, profileId: '',
          outDir: tmpRoot, output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('renders yaml output format', async () => {
    const outDir = path.join(tmpRoot, 'export');
    const { exitCode, stdout } = await runCommand(
      ['index', 'export'],
      {
        commands: [createIndexExportCommand({
          indexFile, shortlistId, profileId: 'demo3',
          outDir, output: 'yaml'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('command: index.export');
    expect(stdout).toContain('status: ok');
  });

  it('renders ndjson output format', async () => {
    const outDir = path.join(tmpRoot, 'export');
    const { exitCode, stdout } = await runCommand(
      ['index', 'export'],
      {
        commands: [createIndexExportCommand({
          indexFile, shortlistId, profileId: 'demo4',
          outDir, output: 'ndjson'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]) as { profileFile: string };
    expect(typeof parsed.profileFile).toBe('string');
  });

  it('renders text output format', async () => {
    const outDir = path.join(tmpRoot, 'export');
    const { exitCode, stdout } = await runCommand(
      ['index', 'export'],
      {
        commands: [createIndexExportCommand({
          indexFile, shortlistId, profileId: 'demo5',
          outDir, output: 'text'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/wrote .*\.profile\.yml/);
  });

  it('exits 1 when index file is missing', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'export'],
      {
        commands: [createIndexExportCommand({
          indexFile: '/nonexistent-index.json', shortlistId, profileId: 'x',
          outDir: tmpRoot, output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('INDEX.NOT_FOUND');
  });

  it('accepts profile-name option', async () => {
    const outDir = path.join(tmpRoot, 'export');
    const { exitCode, stdout } = await runCommand(
      ['index', 'export'],
      {
        commands: [createIndexExportCommand({
          indexFile, shortlistId, profileId: 'demo6',
          outDir, profileName: 'Custom Name', output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    expect(fs.existsSync(env.data.profileFile)).toBe(true);
    const profile = yaml.load(fs.readFileSync(env.data.profileFile, 'utf8')) as {
      id: string; name: string;
    };
    expect(profile.name).toBe('Custom Name');
  });
});

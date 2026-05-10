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
  createIndexShortlistCommand,
} from '../src/cli/commands/index-shortlist';
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
let primitiveId: string;

const ctxOpts = (): { cwd: string; fs: ReturnType<typeof createNodeFsAdapter> } => ({
  cwd: tmpRoot, fs: createNodeFsAdapter()
});

describe('cli `index shortlist`', () => {
  beforeEach(async () => {
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-idx-sl-'));
    indexFile = path.join(tmpRoot, 'primitive-index.json');
    const idx = await PrimitiveIndex.buildFrom(
      new FakeBundleProvider(createFixtureBundles()),
      { hubId: 'test' }
    );
    saveIndex(idx, indexFile);
    const search = idx.search({ q: '*', limit: 1 });
    primitiveId = search.hits[0]?.primitive.id ?? '';
    if (primitiveId.length === 0) {
      const all = idx.search({ limit: 1 });
      primitiveId = all.hits[0].primitive.id;
    }
  });

  afterEach(async () => {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  });

  it('new -> add -> list -> remove round-trip', async () => {
    const r1 = await runCommand(['index', 'shortlist', 'new'], {
      commands: [createIndexShortlistCommand({
        subcommand: 'new', indexFile, name: 'demo', output: 'json'
      })],
      context: ctxOpts()
    });
    expect(r1.exitCode).toBe(0);
    const e1 = JSON.parse(r1.stdout);
    expect(e1.command).toBe('index.shortlist');
    expect(e1.status).toBe('ok');
    const slId = e1.data.shortlist.id as string;

    const r2 = await runCommand(['index', 'shortlist', 'add'], {
      commands: [createIndexShortlistCommand({
        subcommand: 'add', indexFile, shortlistId: slId, primitiveId, output: 'json'
      })],
      context: ctxOpts()
    });
    expect(r2.exitCode).toBe(0);
    const e2 = JSON.parse(r2.stdout);
    expect(e2.data.shortlist.primitiveIds.includes(primitiveId)).toBe(true);

    const r3 = await runCommand(['index', 'shortlist', 'list'], {
      commands: [createIndexShortlistCommand({
        subcommand: 'list', indexFile, output: 'json'
      })],
      context: ctxOpts()
    });
    expect(r3.exitCode).toBe(0);
    const e3 = JSON.parse(r3.stdout);
    expect(Array.isArray(e3.data.shortlists)).toBe(true);
    expect(e3.data.shortlists.find((s: { id: string }) => s.id === slId)).toBeTruthy();

    const r4 = await runCommand(['index', 'shortlist', 'remove'], {
      commands: [createIndexShortlistCommand({
        subcommand: 'remove', indexFile, shortlistId: slId, primitiveId, output: 'json'
      })],
      context: ctxOpts()
    });
    expect(r4.exitCode).toBe(0);
    const e4 = JSON.parse(r4.stdout);
    expect(e4.data.shortlist.primitiveIds.length).toBe(0);
  });

  it('new requires --name', async () => {
    const { exitCode, stdout } = await runCommand(['index', 'shortlist', 'new'], {
      commands: [createIndexShortlistCommand({
        subcommand: 'new', indexFile, name: '', output: 'json'
      })],
      context: ctxOpts()
    });
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('list text output prints id\\tname\\tcount', async () => {
    await runCommand(['index', 'shortlist', 'new'], {
      commands: [createIndexShortlistCommand({
        subcommand: 'new', indexFile, name: 'foo', output: 'json'
      })],
      context: ctxOpts()
    });
    const { exitCode, stdout } = await runCommand(['index', 'shortlist', 'list'], {
      commands: [createIndexShortlistCommand({
        subcommand: 'list', indexFile, output: 'text'
      })],
      context: ctxOpts()
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/foo/);
  });

  it('add to a non-existent shortlist returns SHORTLIST.NOT_FOUND', async () => {
    const { exitCode, stdout } = await runCommand(['index', 'shortlist', 'add'], {
      commands: [createIndexShortlistCommand({
        subcommand: 'add', indexFile, shortlistId: 'sl_missing',
        primitiveId, output: 'json'
      })],
      context: ctxOpts()
    });
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout);
    expect(env.errors[0].code).toMatch(/^INDEX\.SHORTLIST_NOT_FOUND$/);
  });
});

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
  IndexShortlistAddCommand,
  IndexShortlistListCommand,
  IndexShortlistNewCommand,
  IndexShortlistRemoveCommand,
} from '../src/cli/commands/index-shortlist';
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

describe('IndexShortlist native classes', () => {
  beforeEach(async () => {
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-sl-native-'));
    indexFile = path.join(tmpRoot, 'primitive-index.json');
    const idx = await PrimitiveIndex.buildFrom(
      new FakeBundleProvider(createFixtureBundles()),
      { hubId: 'test' }
    );
    saveIndex(idx, indexFile);
    primitiveId = idx.search({ limit: 1 }).hits[0].primitive.id;
  });

  afterEach(async () => {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  });

  it('IndexShortlistNewCommand creates a shortlist', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'shortlist', 'new', '--name', 'my-list', '--index', indexFile, '-o', 'json'],
      { commandClasses: [IndexShortlistNewCommand], context: ctxOpts() }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { data: { shortlist: { id: string; name: string } } };
    expect(env.data.shortlist.name).toBe('my-list');
  });

  it('IndexShortlistNewCommand exits 1 when --name missing', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'shortlist', 'new', '--index', indexFile, '-o', 'json'],
      { commandClasses: [IndexShortlistNewCommand], context: ctxOpts() }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout) as { errors: { code: string }[] };
    expect(env.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('IndexShortlistAddCommand adds a primitive', async () => {
    const r1 = await runCommand(
      ['index', 'shortlist', 'new', '--name', 'sl1', '--index', indexFile, '-o', 'json'],
      { commandClasses: [IndexShortlistNewCommand], context: ctxOpts() }
    );
    const slId = (JSON.parse(r1.stdout) as { data: { shortlist: { id: string } } }).data.shortlist.id;

    const { exitCode, stdout } = await runCommand(
      ['index', 'shortlist', 'add', '--id', slId, '--primitive', primitiveId,
        '--index', indexFile, '-o', 'json'],
      { commandClasses: [IndexShortlistAddCommand], context: ctxOpts() }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { data: { shortlist: { primitiveIds: string[] } } };
    expect(env.data.shortlist.primitiveIds).toContain(primitiveId);
  });

  it('IndexShortlistAddCommand exits 1 when --id missing', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'shortlist', 'add', '--primitive', primitiveId, '--index', indexFile, '-o', 'json'],
      { commandClasses: [IndexShortlistAddCommand], context: ctxOpts() }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout) as { errors: { code: string }[] };
    expect(env.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('IndexShortlistRemoveCommand removes a primitive', async () => {
    const r1 = await runCommand(
      ['index', 'shortlist', 'new', '--name', 'sl2', '--index', indexFile, '-o', 'json'],
      { commandClasses: [IndexShortlistNewCommand], context: ctxOpts() }
    );
    const slId = (JSON.parse(r1.stdout) as { data: { shortlist: { id: string } } }).data.shortlist.id;
    await runCommand(
      ['index', 'shortlist', 'add', '--id', slId, '--primitive', primitiveId,
        '--index', indexFile],
      { commandClasses: [IndexShortlistAddCommand], context: ctxOpts() }
    );

    const { exitCode, stdout } = await runCommand(
      ['index', 'shortlist', 'remove', '--id', slId, '--primitive', primitiveId,
        '--index', indexFile, '-o', 'json'],
      { commandClasses: [IndexShortlistRemoveCommand], context: ctxOpts() }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { data: { shortlist: { primitiveIds: string[] } } };
    expect(env.data.shortlist.primitiveIds).not.toContain(primitiveId);
  });

  it('IndexShortlistRemoveCommand exits 1 when --id missing', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'shortlist', 'remove', '--primitive', primitiveId, '--index', indexFile, '-o', 'json'],
      { commandClasses: [IndexShortlistRemoveCommand], context: ctxOpts() }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout) as { errors: { code: string }[] };
    expect(env.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('IndexShortlistListCommand lists shortlists', async () => {
    await runCommand(
      ['index', 'shortlist', 'new', '--name', 'listed', '--index', indexFile],
      { commandClasses: [IndexShortlistNewCommand], context: ctxOpts() }
    );
    const { exitCode, stdout } = await runCommand(
      ['index', 'shortlist', 'list', '--index', indexFile, '-o', 'json'],
      { commandClasses: [IndexShortlistListCommand], context: ctxOpts() }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { data: { shortlists: { name: string }[] } };
    expect(env.data.shortlists.some((s) => s.name === 'listed')).toBe(true);
  });

  it('IndexShortlistListCommand text output shows empty message', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'shortlist', 'list', '--index', indexFile],
      { commandClasses: [IndexShortlistListCommand], context: ctxOpts() }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No shortlists');
  });

  it('IndexShortlistNewCommand exits 1 when index file missing', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'shortlist', 'new', '--name', 'test',
        '--index', path.join(tmpRoot, 'missing.json'), '-o', 'json'],
      { commandClasses: [IndexShortlistNewCommand], context: ctxOpts() }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout) as { errors: { code: string }[] };
    expect(env.errors[0].code).toBe('INDEX.NOT_FOUND');
  });
});

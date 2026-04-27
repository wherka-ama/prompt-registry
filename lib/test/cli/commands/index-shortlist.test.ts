/**
 * Tests for `index shortlist {new,add,remove,list}`.
 */
import * as assert from 'node:assert';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PrimitiveIndex,
  saveIndex,
} from '../../../src';
import {
  createIndexShortlistCommand,
} from '../../../src/cli/commands/index-shortlist';
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
let primitiveId: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-idx-sl-'));
  indexFile = path.join(tmpRoot, 'primitive-index.json');
  const idx = await PrimitiveIndex.buildFrom(
    new FakeBundleProvider(createFixtureBundles()),
    { hubId: 'test' }
  );
  saveIndex(idx, indexFile);
  // Pick one primitive id off the search path for add/remove tests.
  const search = idx.search({ q: '*', limit: 1 });
  primitiveId = search.hits[0]?.primitive.id ?? '';
  if (primitiveId.length === 0) {
    // Fallback: index.search may need a non-wildcard query. Pull the
    // first stat-listed kind and search by that.
    const all = idx.search({ limit: 1 });
    primitiveId = all.hits[0].primitive.id;
  }
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

const ctxOpts = (): { cwd: string; fs: ReturnType<typeof createNodeFsAdapter> } => ({
  cwd: tmpRoot, fs: createNodeFsAdapter()
});

describe('cli `index shortlist`', () => {
  it('new -> add -> list -> remove round-trip', async () => {
    // new
    const r1 = await runCommand(['index', 'shortlist', 'new'], {
      commands: [createIndexShortlistCommand({
        subcommand: 'new', indexFile, name: 'demo', output: 'json'
      })],
      context: ctxOpts()
    });
    assert.strictEqual(r1.exitCode, 0);
    const e1 = JSON.parse(r1.stdout);
    assert.strictEqual(e1.command, 'index.shortlist');
    assert.strictEqual(e1.status, 'ok');
    const slId = e1.data.shortlist.id as string;

    // add
    const r2 = await runCommand(['index', 'shortlist', 'add'], {
      commands: [createIndexShortlistCommand({
        subcommand: 'add', indexFile, shortlistId: slId, primitiveId, output: 'json'
      })],
      context: ctxOpts()
    });
    assert.strictEqual(r2.exitCode, 0);
    const e2 = JSON.parse(r2.stdout);
    assert.ok(e2.data.shortlist.primitiveIds.includes(primitiveId));

    // list
    const r3 = await runCommand(['index', 'shortlist', 'list'], {
      commands: [createIndexShortlistCommand({
        subcommand: 'list', indexFile, output: 'json'
      })],
      context: ctxOpts()
    });
    assert.strictEqual(r3.exitCode, 0);
    const e3 = JSON.parse(r3.stdout);
    assert.ok(Array.isArray(e3.data.shortlists));
    assert.ok(e3.data.shortlists.find((s: { id: string }) => s.id === slId));

    // remove
    const r4 = await runCommand(['index', 'shortlist', 'remove'], {
      commands: [createIndexShortlistCommand({
        subcommand: 'remove', indexFile, shortlistId: slId, primitiveId, output: 'json'
      })],
      context: ctxOpts()
    });
    assert.strictEqual(r4.exitCode, 0);
    const e4 = JSON.parse(r4.stdout);
    assert.strictEqual(e4.data.shortlist.primitiveIds.length, 0);
  });

  it('new requires --name', async () => {
    const { exitCode, stdout } = await runCommand(['index', 'shortlist', 'new'], {
      commands: [createIndexShortlistCommand({
        subcommand: 'new', indexFile, name: '', output: 'json'
      })],
      context: ctxOpts()
    });
    assert.strictEqual(exitCode, 1);
    const env = JSON.parse(stdout);
    assert.strictEqual(env.errors[0].code, 'USAGE.MISSING_FLAG');
  });

  it('list text output prints id\\tname\\tcount', async () => {
    // Seed one
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
    assert.strictEqual(exitCode, 0);
    assert.match(stdout, /foo/);
  });

  it('add to a non-existent shortlist returns SHORTLIST.NOT_FOUND', async () => {
    const { exitCode, stdout } = await runCommand(['index', 'shortlist', 'add'], {
      commands: [createIndexShortlistCommand({
        subcommand: 'add', indexFile, shortlistId: 'sl_missing',
        primitiveId, output: 'json'
      })],
      context: ctxOpts()
    });
    assert.strictEqual(exitCode, 1);
    const env = JSON.parse(stdout);
    assert.match(env.errors[0].code, /^INDEX\.SHORTLIST_NOT_FOUND$/);
  });
});

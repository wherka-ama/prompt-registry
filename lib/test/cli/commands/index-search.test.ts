/**
 * Tests for `index search` — primitive-index search, framework edition.
 *
 * Replaces the legacy `test/primitive-index/cli.test.ts > search` cases
 * with framework-style golden tests: argv goes in, `{ exitCode, stdout,
 * stderr }` comes out, output goes through `formatOutput` so JSON has
 * the canonical envelope.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PrimitiveIndex,
  saveIndex,
} from '../../../src';
import {
  createIndexSearchCommand,
} from '../../../src/cli/commands/index-search';
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

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-idx-search-'));
  indexFile = path.join(tmpRoot, 'primitive-index.json');
  // Build a real index from the in-memory fixtures and persist it so
  // `index search` exercises the same on-disk path the user does.
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
          query: 'terraform',
          indexFile,
          output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    assert.strictEqual(stderr, '');
    assert.strictEqual(exitCode, 0);
    const env = JSON.parse(stdout);
    assert.strictEqual(env.command, 'index.search');
    assert.strictEqual(env.status, 'ok');
    assert.strictEqual(env.schemaVersion, 1);
    assert.ok(Array.isArray(env.data.hits), 'data.hits is an array');
    assert.ok(typeof env.data.total === 'number');
    assert.ok(env.data.hits.length > 0, 'expected at least one hit');
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
    assert.strictEqual(exitCode, 0);
    assert.match(stdout, /total: \d+/);
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
    assert.strictEqual(exitCode, 0);
    const env = JSON.parse(stdout);
    assert.strictEqual(env.data.total, 0);
    assert.strictEqual(env.data.hits.length, 0);
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
      assert.strictEqual(hit.primitive.kind, 'prompt');
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
    assert.notStrictEqual(exitCode, 0);
    const out = stdout.length > 0 ? stdout : stderr;
    // The envelope MAY be on stdout (-o json) or stderr (text fallback);
    // either way the error code must follow the NAMESPACE.UPPER_SNAKE
    // convention and be index-related.
    if (out.startsWith('{')) {
      const env = JSON.parse(out);
      assert.strictEqual(env.status, 'error');
      assert.match(env.errors[0].code, /^[A-Z]+\.[A-Z_]+$/);
    } else {
      assert.match(out, /index|file/i);
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
    assert.ok(env.data.hits.length <= 2);
  });
});

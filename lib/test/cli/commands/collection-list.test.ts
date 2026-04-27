/**
 * Phase 4 / Iter 1 — `collection list` subcommand.
 *
 * Replaces `lib/bin/list-collections.js`. Walks `<cwd>/collections/`,
 * reads each `*.collection.yml`, and emits an array of
 * `{ id, name, file }` records.
 *
 * The original binary always emits JSON (with a trailing newline).
 * The new subcommand defaults to text mode (a deterministic
 * one-collection-per-line summary) and switches to JSON via the
 * shared output formatter when constructed with `output: 'json'`.
 * NDJSON mode emits one JSON object per line — natural fit for piped
 * `jq` consumers and a strict superset of the legacy script's
 * line-per-record streaming case.
 *
 * Tests use the iter-7 golden runner with a Context override that
 * exposes a fake `cwd` pointing at a temp directory containing
 * fixture collection files.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createCollectionListCommand,
} from '../../../src/cli/commands/collection-list';
import {
  type FsAbstraction,
  runCommand,
} from '../../../src/cli/framework';
import {
  createNodeFsAdapter,
} from '../helpers/node-fs-adapter';

let tmpRoot: string;
let realFs: FsAbstraction;

const fixtureCollections: Record<string, string> = {
  'alpha.collection.yml': 'id: alpha\nname: Alpha\nitems: []\n',
  'beta.collection.yml': 'id: beta\nname: Beta\nitems: []\n',
  // Non-yml file: must be ignored by listCollectionFiles.
  'README.md': '# noise'
};

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-coll-list-'));
  await fs.mkdir(path.join(tmpRoot, 'collections'), { recursive: true });
  for (const [name, body] of Object.entries(fixtureCollections)) {
    await fs.writeFile(path.join(tmpRoot, 'collections', name), body, 'utf8');
  }
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('Phase 4 / Iter 1 — collection list', () => {
  it('emits a JSON envelope with the discovered collections', async () => {
    const result = await runCommand(['collection', 'list'], {
      commands: [createCollectionListCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      command: string;
      status: string;
      data: { id: string; name: string; file: string }[];
    };
    assert.strictEqual(parsed.schemaVersion, 1);
    assert.strictEqual(parsed.command, 'collection.list');
    assert.strictEqual(parsed.status, 'ok');
    const ids = parsed.data.map((c) => c.id).toSorted();
    assert.deepStrictEqual(ids, ['alpha', 'beta']);
    for (const entry of parsed.data) {
      assert.ok(entry.file.endsWith('.collection.yml'),
        `file path should end with .collection.yml; got ${entry.file}`);
    }
  });

  it('emits one record per line in ndjson mode', async () => {
    const result = await runCommand(['collection', 'list'], {
      commands: [createCollectionListCommand({ output: 'ndjson' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0);
    const lines = result.stdout.trim().split('\n');
    assert.strictEqual(lines.length, 2);
    const ids = lines.map((l) => (JSON.parse(l) as { id: string }).id).toSorted();
    assert.deepStrictEqual(ids, ['alpha', 'beta']);
  });

  it('text mode prints a stable one-collection-per-line summary', async () => {
    const result = await runCommand(['collection', 'list'], {
      commands: [createCollectionListCommand()],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes('alpha'));
    assert.ok(result.stdout.includes('beta'));
    // Text mode includes the file path so users can copy-paste.
    assert.ok(result.stdout.includes('alpha.collection.yml'));
  });

  it('exits with code 1 and renders an error when collections/ is missing', async () => {
    // Use a fresh tmp dir that has no `collections/` subfolder.
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-coll-list-empty-'));
    try {
      const result = await runCommand(['collection', 'list'], {
        commands: [createCollectionListCommand()],
        context: { cwd: empty, fs: realFs }
      });
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('FS.NOT_FOUND')
        || result.stderr.includes('collections')
        || result.stderr.includes('not found'),
      `stderr should hint at the missing directory; got: ${result.stderr}`);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });
});

/**
 * Phase 4 / Iter 3 — `collection affected` subcommand.
 *
 * Replaces `lib/bin/detect-affected-collections.js`. Given a list of
 * changed paths (typically the output of `git diff --name-only` in a
 * CI step), emits the collections whose `.collection.yml` itself or
 * any of their item paths is in that set.
 *
 * The factory exposes `changedPaths: string[]`. iter 8 wires this to a
 * repeatable `--changed-path` clipanion option.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createCollectionAffectedCommand,
} from '../../../src/cli/commands/collection-affected';
import {
  type FsAbstraction,
  runCommand,
} from '../../../src/cli/framework';
import {
  createNodeFsAdapter,
} from '../helpers/node-fs-adapter';

let tmpRoot: string;
let realFs: FsAbstraction;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-coll-aff-'));
  await fs.mkdir(path.join(tmpRoot, 'collections'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'prompts'), { recursive: true });
  await fs.writeFile(path.join(tmpRoot, 'prompts', 'foo.md'), '# foo\n');
  await fs.writeFile(path.join(tmpRoot, 'prompts', 'bar.md'), '# bar\n');
  await fs.writeFile(
    path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
    'id: alpha\nname: Alpha\nversion: 1.0.0\nitems:\n  - path: prompts/foo.md\n    kind: prompt\n'
  );
  await fs.writeFile(
    path.join(tmpRoot, 'collections', 'beta.collection.yml'),
    'id: beta\nname: Beta\nversion: 1.0.0\nitems:\n  - path: prompts/bar.md\n    kind: prompt\n'
  );
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('Phase 4 / Iter 3 — collection affected', () => {
  it('emits empty list when no paths match', async () => {
    const result = await runCommand(['collection', 'affected'], {
      commands: [createCollectionAffectedCommand({
        output: 'json',
        changedPaths: ['unrelated/file.txt']
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as {
      data: { affected: { id: string; file: string }[] };
    };
    assert.deepStrictEqual(parsed.data.affected, []);
  });

  it('flags a collection when its item path changes', async () => {
    const result = await runCommand(['collection', 'affected'], {
      commands: [createCollectionAffectedCommand({
        output: 'json',
        changedPaths: ['prompts/foo.md']
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as {
      data: { affected: { id: string; file: string }[] };
    };
    assert.strictEqual(parsed.data.affected.length, 1);
    assert.strictEqual(parsed.data.affected[0].id, 'alpha');
  });

  it('flags a collection when the collection file itself changes', async () => {
    const result = await runCommand(['collection', 'affected'], {
      commands: [createCollectionAffectedCommand({
        output: 'json',
        changedPaths: ['collections/beta.collection.yml']
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as {
      data: { affected: { id: string }[] };
    };
    assert.strictEqual(parsed.data.affected.length, 1);
    assert.strictEqual(parsed.data.affected[0].id, 'beta');
  });

  it('handles backslash-style and leading-slash paths consistently', async () => {
    const result = await runCommand(['collection', 'affected'], {
      commands: [createCollectionAffectedCommand({
        output: 'json',
        changedPaths: ['\\prompts\\foo.md', '/prompts/bar.md']
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    const parsed = JSON.parse(result.stdout) as {
      data: { affected: { id: string }[] };
    };
    const ids = parsed.data.affected.map((a) => a.id).toSorted();
    assert.deepStrictEqual(ids, ['alpha', 'beta']);
  });
});

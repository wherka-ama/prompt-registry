/**
 * Phase 4 / Iter 4 — `version compute` subcommand.
 *
 * Replaces `lib/bin/compute-collection-version.js`. Computes the next
 * semver version + git tag for a collection, given:
 *   - The collection file's `version` field (manual override).
 *   - The set of existing git tags matching `<collection-id>-v*`.
 *
 * The git interaction is injected via a `gitTagsProvider` option so
 * the command stays Context-pure for tests. Production wiring uses
 * `child_process.spawnSync('git', ['tag', '--list'])` — same as the
 * legacy script — and is exercised in the production-context tests
 * (a follow-up iter wires that path).
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createVersionComputeCommand,
} from '../../../src/cli/commands/version-compute';
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
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-ver-'));
  await fs.mkdir(path.join(tmpRoot, 'collections'), { recursive: true });
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('Phase 4 / Iter 4 — version compute', () => {
  it('returns 1.0.0 when no tags exist and version field absent', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      'id: alpha\nname: Alpha\nitems: []\n'
    );
    const result = await runCommand(['version', 'compute'], {
      commands: [createVersionComputeCommand({
        output: 'json',
        collectionFile: 'collections/alpha.collection.yml',
        gitTagsProvider: () => []
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as { data: { nextVersion: string; tag: string } };
    assert.strictEqual(parsed.data.nextVersion, '1.0.0');
    assert.strictEqual(parsed.data.tag, 'alpha-v1.0.0');
  });

  it('honours a manual version higher than every existing tag', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      'id: alpha\nname: Alpha\nversion: 2.0.0\nitems: []\n'
    );
    const result = await runCommand(['version', 'compute'], {
      commands: [createVersionComputeCommand({
        output: 'json',
        collectionFile: 'collections/alpha.collection.yml',
        gitTagsProvider: () => ['alpha-v1.0.0', 'alpha-v1.0.1']
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    const parsed = JSON.parse(result.stdout) as { data: { nextVersion: string } };
    assert.strictEqual(parsed.data.nextVersion, '2.0.0');
  });

  it('bumps patch when manual version is not greater than latest tag', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      'id: alpha\nname: Alpha\nversion: 1.0.0\nitems: []\n'
    );
    const result = await runCommand(['version', 'compute'], {
      commands: [createVersionComputeCommand({
        output: 'json',
        collectionFile: 'collections/alpha.collection.yml',
        gitTagsProvider: () => ['alpha-v1.0.0', 'alpha-v1.0.1']
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    const parsed = JSON.parse(result.stdout) as { data: { nextVersion: string } };
    assert.strictEqual(parsed.data.nextVersion, '1.0.2');
  });

  it('rejects an invalid manual version string', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      'id: alpha\nname: Alpha\nversion: not-semver\nitems: []\n'
    );
    const result = await runCommand(['version', 'compute'], {
      commands: [createVersionComputeCommand({
        output: 'json',
        collectionFile: 'collections/alpha.collection.yml',
        gitTagsProvider: () => []
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'BUNDLE.INVALID_VERSION');
  });
});

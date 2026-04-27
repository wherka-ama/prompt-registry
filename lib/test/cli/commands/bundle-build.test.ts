/**
 * Phase 4 / Iter 10 — `bundle build` smoke test.
 *
 * Single happy-path test: a 1-prompt collection produces a zip and a
 * manifest under the expected output directory. Deterministic zip
 * verification (byte equality across runs) is parked for a follow-up
 * iter; this test only asserts file existence and reports the data
 * envelope shape.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createBundleBuildCommand,
} from '../../../src/cli/commands/bundle-build';
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
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-bundle-build-'));
  await fs.mkdir(path.join(tmpRoot, 'collections'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'prompts'), { recursive: true });
  await fs.writeFile(
    path.join(tmpRoot, 'prompts', 'foo.prompt.md'),
    '# Foo\n\n> Description.\n\nBody.\n'
  );
  await fs.writeFile(
    path.join(tmpRoot, 'collections', 'demo.collection.yml'),
    `id: demo
name: Demo
items:
  - path: prompts/foo.prompt.md
    kind: prompt
`
  );
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('Phase 4 / Iter 10 — bundle build', () => {
  it('produces a manifest + zip under <outDir>/<collectionId>/', async () => {
    const result = await runCommand(['bundle', 'build'], {
      commands: [createBundleBuildCommand({
        output: 'json',
        collectionFile: 'collections/demo.collection.yml',
        version: '1.0.0',
        outDir: 'dist',
        repoSlug: 'wherka-ama-demo'
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0,
      `expected exit 0; got ${result.exitCode}; stdout=${result.stdout}; stderr=${result.stderr}`);
    const parsed = JSON.parse(result.stdout) as {
      data: { collectionId: string; bundleId: string; zipAsset: string };
    };
    assert.strictEqual(parsed.data.collectionId, 'demo');
    assert.ok(parsed.data.bundleId.startsWith('wherka-ama-demo-demo-'),
      `bundleId should be a slugged combination; got ${parsed.data.bundleId}`);
    const manifestExists = await fs.stat(path.join(tmpRoot, 'dist', 'demo', 'deployment-manifest.yml'));
    assert.ok(manifestExists.isFile());
    const zipExists = await fs.stat(path.join(tmpRoot, 'dist', 'demo', 'demo.bundle.zip'));
    assert.ok(zipExists.isFile());
    assert.ok(zipExists.size > 0);
  });

  it('exits 1 with USAGE.MISSING_FLAG when no repo slug is available', async () => {
    const result = await runCommand(['bundle', 'build'], {
      commands: [createBundleBuildCommand({
        output: 'json',
        collectionFile: 'collections/demo.collection.yml',
        version: '1.0.0'
      })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
  });
});

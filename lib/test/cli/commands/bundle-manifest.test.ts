/**
 * Phase 4 / Iter 7 — `bundle manifest` subcommand tests.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import {
  createBundleManifestCommand,
} from '../../../src/cli/commands/bundle-manifest';
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
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-bundle-manifest-'));
  await fs.mkdir(path.join(tmpRoot, 'collections'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'prompts'), { recursive: true });
  await fs.writeFile(
    path.join(tmpRoot, 'prompts', 'foo.prompt.md'),
    '# Foo Prompt\n\n> Brief description here.\n\nBody of the prompt.\n'
  );
  await fs.writeFile(
    path.join(tmpRoot, 'collections', 'demo.collection.yml'),
    `id: demo
name: Demo
description: A demo collection.
tags: [demo]
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

describe('Phase 4 / Iter 7 — bundle manifest', () => {
  it('writes a manifest file and reports the totals', async () => {
    const outFile = path.join(tmpRoot, 'deployment-manifest.yml');
    const result = await runCommand(['bundle', 'manifest'], {
      commands: [createBundleManifestCommand({
        output: 'json',
        version: '1.0.0',
        collectionFile: 'collections/demo.collection.yml',
        outFile
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as {
      data: { id: string; version: string; totalItems: number };
    };
    assert.strictEqual(parsed.data.id, 'demo');
    assert.strictEqual(parsed.data.version, '1.0.0');
    assert.strictEqual(parsed.data.totalItems, 1);
    const manifestText = await fs.readFile(outFile, 'utf8');
    const manifest = yaml.load(manifestText) as { id: string; prompts: { id: string }[] };
    assert.strictEqual(manifest.id, 'demo');
    assert.strictEqual(manifest.prompts[0].id, 'foo.prompt');
  });

  it('exits 1 when an item file is missing', async () => {
    await fs.rm(path.join(tmpRoot, 'prompts', 'foo.prompt.md'));
    const result = await runCommand(['bundle', 'manifest'], {
      commands: [createBundleManifestCommand({
        output: 'json',
        version: '1.0.0',
        collectionFile: 'collections/demo.collection.yml',
        outFile: path.join(tmpRoot, 'm.yml')
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'BUNDLE.ITEM_NOT_FOUND');
  });
});

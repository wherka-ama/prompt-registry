import * as fs from 'node:fs/promises';
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
  createBundleBuildCommand,
} from '../src/cli/commands/bundle-build';
import {
  type FsAbstraction,
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

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

describe('bundle build', () => {
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
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { collectionId: string; bundleId: string; zipAsset: string };
    };
    expect(parsed.data.collectionId).toBe('demo');
    expect(parsed.data.bundleId).toMatch(/^wherka-ama-demo-demo-/);
    const manifestExists = await fs.stat(path.join(tmpRoot, 'dist', 'demo', 'deployment-manifest.yml'));
    expect(manifestExists.isFile()).toBe(true);
    const zipExists = await fs.stat(path.join(tmpRoot, 'dist', 'demo', 'demo.bundle.zip'));
    expect(zipExists.isFile()).toBe(true);
    expect(zipExists.size).toBeGreaterThan(0);
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
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });
});

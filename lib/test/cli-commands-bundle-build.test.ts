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
  BundleBuildCommand,
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

  it('exits 1 with BUNDLE.INVALID_MANIFEST when collection.id is missing', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'no-id.collection.yml'),
      `name: No ID
items: []
`
    );
    const result = await runCommand(['bundle', 'build'], {
      commands: [createBundleBuildCommand({
        output: 'json',
        collectionFile: 'collections/no-id.collection.yml',
        version: '1.0.0',
        repoSlug: 'test-repo'
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('BUNDLE.INVALID_MANIFEST');
  });

  it('uses GITHUB_REPOSITORY env var as fallback for repo slug', async () => {
    const result = await runCommand(['bundle', 'build'], {
      commands: [createBundleBuildCommand({
        output: 'json',
        collectionFile: 'collections/demo.collection.yml',
        version: '1.0.0'
      })],
      context: { cwd: tmpRoot, fs: realFs, env: { GITHUB_REPOSITORY: 'owner/repo' } }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { bundleId: string };
    };
    expect(parsed.data.bundleId).toMatch(/^owner-repo-demo-/);
  });

  it('respects custom outDir option', async () => {
    const result = await runCommand(['bundle', 'build'], {
      commands: [createBundleBuildCommand({
        output: 'json',
        collectionFile: 'collections/demo.collection.yml',
        version: '1.0.0',
        repoSlug: 'test-repo',
        outDir: 'custom-output'
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { outDir: string };
    };
    expect(parsed.data.outDir).toContain('custom-output');
    const manifestExists = await fs.stat(path.join(tmpRoot, 'custom-output', 'demo', 'deployment-manifest.yml'));
    expect(manifestExists.isFile()).toBe(true);
  });
});

describe('BundleBuildCommand (native class)', () => {
  it('builds bundle via --collection-file, --version, --repo-slug flags', async () => {
    const { exitCode, stdout } = await runCommand(
      ['bundle', 'build', '--collection-file', 'collections/demo.collection.yml', '--version', '1.0.0', '--repo-slug', 'test-owner-repo', '-o', 'json'],
      {
        commandClasses: [BundleBuildCommand],
        context: { cwd: tmpRoot, fs: realFs }
      }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { status: string; data: { bundleId: string } };
    expect(env.status).toBe('ok');
    expect(env.data.bundleId).toContain('demo');
  });

  it('exits 1 when --repo-slug is missing and GITHUB_REPOSITORY is not set', async () => {
    const { exitCode } = await runCommand(
      ['bundle', 'build', '--collection-file', 'collections/demo.collection.yml', '--version', '1.0.0', '-o', 'json'],
      {
        commandClasses: [BundleBuildCommand],
        context: { cwd: tmpRoot, fs: realFs, env: {} }
      }
    );
    expect(exitCode).toBe(1);
  });

  it('uses GITHUB_REPOSITORY env var as repo slug', async () => {
    const { exitCode, stdout } = await runCommand(
      ['bundle', 'build', '--collection-file', 'collections/demo.collection.yml', '--version', '1.0.0', '-o', 'json'],
      {
        commandClasses: [BundleBuildCommand],
        context: { cwd: tmpRoot, fs: realFs, env: { GITHUB_REPOSITORY: 'owner/demo-repo' } }
      }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { status: string };
    expect(env.status).toBe('ok');
  });

  it('respects --out-dir flag', async () => {
    const outDir = path.join(tmpRoot, 'my-dist');
    const { exitCode, stdout } = await runCommand(
      ['bundle', 'build', '--collection-file', 'collections/demo.collection.yml', '--version', '1.0.0', '--repo-slug', 'owner-repo', `--out-dir=${outDir}`, '-o', 'json'],
      {
        commandClasses: [BundleBuildCommand],
        context: { cwd: tmpRoot, fs: realFs }
      }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { data: { outDir: string } };
    expect(env.data.outDir).toContain('my-dist');
  });
});

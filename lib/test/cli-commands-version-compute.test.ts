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
  createVersionComputeCommand,
  VersionComputeCommand,
} from '../src/cli/commands/version-compute';
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
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-ver-'));
  await fs.mkdir(path.join(tmpRoot, 'collections'), { recursive: true });
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('version compute', () => {
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
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: { nextVersion: string; tag: string } };
    expect(parsed.data.nextVersion).toBe('1.0.0');
    expect(parsed.data.tag).toBe('alpha-v1.0.0');
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
    expect(parsed.data.nextVersion).toBe('2.0.0');
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
    expect(parsed.data.nextVersion).toBe('1.0.2');
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
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('BUNDLE.INVALID_VERSION');
  });
});

describe('VersionComputeCommand (native class)', () => {
  it('computes version via --collection-file flag', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'beta.collection.yml'),
      'id: beta\nname: Beta\nversion: 1.0.0\nitems: []\n',
      'utf8'
    );
    const { exitCode, stdout } = await runCommand(
      ['version', 'compute', '--collection-file', 'collections/beta.collection.yml', '-o', 'json'],
      {
        commandClasses: [VersionComputeCommand],
        context: { cwd: tmpRoot, fs: realFs }
      }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { status: string; data: { version: string } };
    expect(env.status).toBe('ok');
    expect(env.data.nextVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exits 1 when collection file does not exist', async () => {
    const { exitCode } = await runCommand(
      ['version', 'compute', '--collection-file', 'collections/nonexistent.yml', '-o', 'json'],
      {
        commandClasses: [VersionComputeCommand],
        context: { cwd: tmpRoot, fs: realFs }
      }
    );
    expect(exitCode).toBe(1);
  });

  it('text output renders version string', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'gamma.collection.yml'),
      'id: gamma\nname: Gamma\nversion: 2.0.0\nitems: []\n',
      'utf8'
    );
    const { exitCode, stdout } = await runCommand(
      ['version', 'compute', '--collection-file', 'collections/gamma.collection.yml'],
      {
        commandClasses: [VersionComputeCommand],
        context: { cwd: tmpRoot, fs: realFs }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });
});

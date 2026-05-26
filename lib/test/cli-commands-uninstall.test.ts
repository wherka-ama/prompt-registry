import * as fsp from 'node:fs/promises';
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
  createUninstallCommand,
  UninstallCommand,
} from '../src/cli/commands/uninstall';
import {
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

describe('uninstall command', () => {
  it('exits 1 with USAGE.MISSING_FLAG when neither bundle, lockfile, nor --all is supplied', async () => {
    const result = await runCommand(['uninstall'], {
      commands: [createUninstallCommand({ output: 'json' })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      errors: { code: string; message: string }[];
    };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
    expect(parsed.errors[0].message).toMatch(/bundle-id|lockfile/);
  });

  it('exits 1 with USAGE.MISSING_FLAG when bundle is supplied without --target', async () => {
    const result = await runCommand(['uninstall'], {
      commands: [createUninstallCommand({ output: 'json', bundle: 'foo' })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string; message: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
    expect(parsed.errors[0].message).toMatch(/--target/);
  });

  it('exits 1 with USAGE.MISSING_FLAG when lockfile is supplied without --target', async () => {
    const result = await runCommand(['uninstall'], {
      commands: [createUninstallCommand({ output: 'json', lockfile: 'a.lock.json' })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('exits 1 with USAGE.MISSING_FLAG when --all is supplied without --target', async () => {
    const result = await runCommand(['uninstall'], {
      commands: [createUninstallCommand({ output: 'json', all: true })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });
});

describe('UninstallCommand (native class)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-uninst-'));
    await fsp.writeFile(
      path.join(tmp, 'prompt-registry.yml'),
      'targets:\n  - name: t1\n    type: vscode\n    scope: user\n'
    );
  });

  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('exits 0 with warning when bundle not in lockfile', async () => {
    const { exitCode, stdout } = await runCommand(
      ['uninstall', '--bundle', 'my-bundle', '--target', 't1', '-o', 'json'],
      { commandClasses: [UninstallCommand], context: { cwd: tmp, fs: createNodeFsAdapter(), env: { HOME: tmp } } }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { status: string; data: { reason: string } };
    expect(parsed.status).toBe('warning');
    expect(parsed.data.reason).toContain('not found');
  });

  it('exits 0 when --all but no bundles installed', async () => {
    const { exitCode, stdout } = await runCommand(
      ['uninstall', '--all', '--target', 't1', '-o', 'json'],
      { commandClasses: [UninstallCommand], context: { cwd: tmp, fs: createNodeFsAdapter(), env: { HOME: tmp } } }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { data: { uninstalled: number } };
    expect(parsed.data.uninstalled).toBe(0);
  });

  it('--bundle --dry-run shows files to remove without deleting', async () => {
    const lockfile = {
      schemaVersion: 1,
      entries: [{ bundleId: 'my-bundle', target: 't1', files: ['a.md'], installedAt: '', fileChecksums: {}, bundleVersion: '1.0.0', sourceId: 's1' }],
      sources: {}
    };
    await fsp.writeFile(path.join(tmp, 'prompt-registry.lock.json'), JSON.stringify(lockfile));
    const { exitCode, stdout } = await runCommand(
      ['uninstall', '--bundle', 'my-bundle', '--target', 't1', '--dry-run', '-o', 'json'],
      { commandClasses: [UninstallCommand], context: { cwd: tmp, fs: createNodeFsAdapter(), env: { HOME: tmp } } }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { data: { dryRun: boolean; files: string[] } };
    expect(parsed.data.dryRun).toBe(true);
    expect(parsed.data.files).toContain('a.md');
  });

  it('--lockfile --dry-run shows bundles to remove', async () => {
    const lockfile = {
      schemaVersion: 1,
      entries: [{ bundleId: 'b1', target: 't1', files: ['x.md'], installedAt: '', fileChecksums: {}, bundleVersion: '1.0.0', sourceId: 's1' }],
      sources: {}
    };
    const lockPath = path.join(tmp, 'prompt-registry.lock.json');
    await fsp.writeFile(lockPath, JSON.stringify(lockfile));
    const { exitCode, stdout } = await runCommand(
      ['uninstall', '--lockfile', lockPath, '--target', 't1', '--dry-run', '-o', 'json'],
      { commandClasses: [UninstallCommand], context: { cwd: tmp, fs: createNodeFsAdapter(), env: { HOME: tmp } } }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { data: { dryRun: boolean; bundles: string[] } };
    expect(parsed.data.dryRun).toBe(true);
    expect(parsed.data.bundles).toContain('b1');
  });

  it('no flags exits 1 with USAGE.MISSING_FLAG via native class', async () => {
    const { exitCode, stdout } = await runCommand(
      ['uninstall', '-o', 'json'],
      { commandClasses: [UninstallCommand], context: { cwd: tmp, fs: createNodeFsAdapter(), env: { HOME: tmp } } }
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('--bundle runs actual uninstall and updates lockfile', async () => {
    const lockfile = {
      schemaVersion: 1,
      entries: [{ bundleId: 'my-bundle', target: 't1', files: ['prompts/x.md'], installedAt: '', fileChecksums: {}, bundleVersion: '1.0.0', sourceId: 's1' }],
      sources: {}
    };
    await fsp.writeFile(path.join(tmp, 'prompt-registry.lock.json'), JSON.stringify(lockfile));
    const { exitCode, stdout } = await runCommand(
      ['uninstall', '--bundle', 'my-bundle', '--target', 't1', '-o', 'json'],
      { commandClasses: [UninstallCommand], context: { cwd: tmp, fs: createNodeFsAdapter(), env: { HOME: tmp } } }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { status: string; data: { bundle: string } };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.bundle).toBe('my-bundle');
    const lock = JSON.parse(await fsp.readFile(path.join(tmp, 'prompt-registry.lock.json'), 'utf8')) as { entries: unknown[] };
    expect(lock.entries).toHaveLength(0);
  });

  it('--lockfile runs actual uninstall from lockfile path', async () => {
    const lockPath = path.join(tmp, 'prompt-registry.lock.json');
    const lockfile = {
      schemaVersion: 1,
      entries: [{ bundleId: 'b1', target: 't1', files: ['prompts/x.md'], installedAt: '', fileChecksums: {}, bundleVersion: '1.0.0', sourceId: 's1' }],
      sources: {}
    };
    await fsp.writeFile(lockPath, JSON.stringify(lockfile));
    const { exitCode, stdout } = await runCommand(
      ['uninstall', '--lockfile', lockPath, '--target', 't1', '-o', 'json'],
      { commandClasses: [UninstallCommand], context: { cwd: tmp, fs: createNodeFsAdapter(), env: { HOME: tmp } } }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { status: string; data: { uninstalled: number } };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.uninstalled).toBe(1);
  });

  it('--all runs actual uninstall for all bundles in target', async () => {
    const lockfile = {
      schemaVersion: 1,
      entries: [
        { bundleId: 'b1', target: 't1', files: ['prompts/a.md'], installedAt: '', fileChecksums: {}, bundleVersion: '1.0.0', sourceId: 's1' },
        { bundleId: 'b2', target: 't1', files: ['prompts/b.md'], installedAt: '', fileChecksums: {}, bundleVersion: '1.0.0', sourceId: 's1' }
      ],
      sources: {}
    };
    await fsp.writeFile(path.join(tmp, 'prompt-registry.lock.json'), JSON.stringify(lockfile));
    const { exitCode, stdout } = await runCommand(
      ['uninstall', '--all', '--target', 't1', '-o', 'json'],
      { commandClasses: [UninstallCommand], context: { cwd: tmp, fs: createNodeFsAdapter(), env: { HOME: tmp } } }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { status: string; data: { uninstalled: number } };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.uninstalled).toBe(2);
  });

  it('exits 1 when target not configured (RegistryError catch path)', async () => {
    const { exitCode, stdout } = await runCommand(
      ['uninstall', '--bundle', 'foo', '--target', 'nonexistent', '-o', 'json'],
      { commandClasses: [UninstallCommand], context: { cwd: tmp, fs: createNodeFsAdapter(), env: { HOME: tmp } } }
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });
});

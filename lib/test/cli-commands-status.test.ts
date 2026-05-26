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
  PrimitiveIndex,
  saveIndex,
} from '../src';
import {
  createStatusCommand,
  StatusCommand,
} from '../src/cli/commands/status';
import {
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';
import {
  createFixtureBundles,
  FakeBundleProvider,
} from './fixtures/primitive-index';

let tmpRoot: string;
let xdgConfig: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-status-'));
  xdgConfig = path.join(tmpRoot, 'xdg-config');
  await fs.mkdir(xdgConfig, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('cli `status`', () => {
  it('exits 0 on a blank project with no targets or hubs', async () => {
    const { exitCode, stdout, stderr } = await runCommand(
      ['status'],
      {
        commands: [createStatusCommand({ output: 'json' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, XDG_CACHE_HOME: tmpRoot, HOME: tmpRoot }
        }
      }
    );
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      status: string;
      data: {
        targets: unknown[];
        activeHubId: unknown;
        hubs: unknown[];
        index: unknown;
        lockfile: unknown;
      };
    };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.targets).toEqual([]);
    expect(parsed.data.activeHubId).toBeNull();
    expect(parsed.data.hubs).toEqual([]);
    expect(parsed.data.index).toBeNull();
    expect(parsed.data.lockfile).toBeNull();
  });

  it('reports configured targets when prompt-registry.yml exists', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'targets:\n  - name: my-copilot\n    type: copilot-cli\n    scope: user\n'
    );
    const { exitCode, stdout } = await runCommand(
      ['status'],
      {
        commands: [createStatusCommand({ output: 'json' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      data: { targets: { name: string; type: string }[] };
    };
    expect(parsed.data.targets).toHaveLength(1);
    expect(parsed.data.targets[0].name).toBe('my-copilot');
    expect(parsed.data.targets[0].type).toBe('copilot-cli');
  });

  it('reports lockfile entry count when lockfile exists', async () => {
    const lock = {
      schemaVersion: 1,
      entries: [
        { bundleId: 'b1', target: 'my-copilot', installedFiles: [], checksum: '', installedAt: '' },
        { bundleId: 'b2', target: 'my-copilot', installedFiles: [], checksum: '', installedAt: '' }
      ]
    };
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.lock.json'),
      JSON.stringify(lock)
    );
    const { exitCode, stdout } = await runCommand(
      ['status'],
      {
        commands: [createStatusCommand({ output: 'json' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      data: { lockfile: { entries: number } | null };
    };
    expect(parsed.data.lockfile).not.toBeNull();
    expect(parsed.data.lockfile!.entries).toBe(2);
  });

  it('text output mentions target add when no targets', async () => {
    const { exitCode, stdout } = await runCommand(
      ['status'],
      {
        commands: [createStatusCommand({ output: 'text' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, XDG_CACHE_HOME: tmpRoot, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('target add');
  });

  it('text output shows active hub when set', async () => {
    const hubsDir = path.join(xdgConfig, 'prompt-registry', 'hubs');
    const activeHubFile = path.join(xdgConfig, 'prompt-registry', 'active-hub.json');
    await fs.mkdir(hubsDir, { recursive: true });
    await fs.writeFile(
      path.join(hubsDir, 'my-hub.yml'),
      'version: "1.0.0"\nmetadata:\n  name: my-hub\n'
    );
    await fs.writeFile(activeHubFile, JSON.stringify({ hubId: 'my-hub', setAt: new Date().toISOString() }));
    const { exitCode, stdout } = await runCommand(
      ['status'],
      {
        commands: [createStatusCommand({ output: 'text' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, XDG_CACHE_HOME: tmpRoot, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('my-hub');
  });

  it('text output shows hub list when hubs exist but none active', async () => {
    const hubsDir = path.join(xdgConfig, 'prompt-registry', 'hubs');
    await fs.mkdir(hubsDir, { recursive: true });
    await fs.writeFile(
      path.join(hubsDir, 'hub-alpha.yml'),
      'version: "1.0.0"\nmetadata:\n  name: hub-alpha\n'
    );
    const { exitCode, stdout } = await runCommand(
      ['status'],
      {
        commands: [createStatusCommand({ output: 'text' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, XDG_CACHE_HOME: tmpRoot, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('hub-alpha');
    expect(stdout).toContain('hub use');
  });

  it('text output shows targets when configured', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'targets:\n  - name: my-copilot\n    type: copilot-cli\n    scope: user\n'
    );
    const { exitCode, stdout } = await runCommand(
      ['status'],
      {
        commands: [createStatusCommand({ output: 'text' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, XDG_CACHE_HOME: tmpRoot, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('my-copilot [copilot-cli]');
  });

  it('text output shows primitive count when index exists', async () => {
    const cacheDir = path.join(tmpRoot, 'prompt-registry');
    await fs.mkdir(cacheDir, { recursive: true });
    const indexFile = path.join(cacheDir, 'primitive-index.json');
    const idx = await PrimitiveIndex.buildFrom(
      new FakeBundleProvider(createFixtureBundles()),
      { hubId: 'test' }
    );
    saveIndex(idx, indexFile);
    const { exitCode, stdout } = await runCommand(
      ['status'],
      {
        commands: [createStatusCommand({ output: 'text' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, XDG_CACHE_HOME: tmpRoot, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('primitives');
  });

  it('text output shows lockfile bundle count', async () => {
    const lock = {
      schemaVersion: 1,
      entries: [
        { bundleId: 'b1', target: 'my-copilot', installedFiles: [], checksum: '', installedAt: '' }
      ]
    };
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.lock.json'),
      JSON.stringify(lock)
    );
    const { exitCode, stdout } = await runCommand(
      ['status'],
      {
        commands: [createStatusCommand({ output: 'text' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, XDG_CACHE_HOME: tmpRoot, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('1 bundle installed');
  });

  it('--verbose shows per-bundle details in JSON output', async () => {
    const lock = {
      schemaVersion: 1,
      entries: [
        {
          bundleId: 'my-bundle',
          bundleVersion: '1.2.3',
          target: 'copilot',
          sourceId: 'local',
          installedAt: '2024-06-01T10:00:00Z',
          files: []
        }
      ]
    };
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.lock.json'),
      JSON.stringify(lock)
    );
    const { exitCode, stdout } = await runCommand(
      ['status'],
      {
        commands: [createStatusCommand({ output: 'json', verbose: true })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, XDG_CACHE_HOME: tmpRoot, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      data: {
        lockfile: {
          entries: number;
          bundles?: { bundleId: string; bundleVersion: string; target: string }[];
        } | null;
      };
    };
    expect(parsed.data.lockfile?.bundles).toHaveLength(1);
    expect(parsed.data.lockfile?.bundles?.[0].bundleId).toBe('my-bundle');
    expect(parsed.data.lockfile?.bundles?.[0].bundleVersion).toBe('1.2.3');
  });

  it('--verbose shows per-bundle details in text output', async () => {
    const lock = {
      schemaVersion: 1,
      entries: [
        {
          bundleId: 'verbose-bundle',
          bundleVersion: '2.0.0',
          target: 'copilot',
          sourceId: 'local',
          installedAt: '2024-06-01T10:00:00Z',
          files: []
        }
      ]
    };
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.lock.json'),
      JSON.stringify(lock)
    );
    const { exitCode, stdout } = await runCommand(
      ['status'],
      {
        commands: [createStatusCommand({ output: 'text', verbose: true })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, XDG_CACHE_HOME: tmpRoot, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('verbose-bundle@2.0.0');
    expect(stdout).toContain('target=copilot');
  });

  it('uses user-level lockfile when no project lockfile exists', async () => {
    const userLockDir = path.join(xdgConfig, 'prompt-registry');
    await fs.mkdir(userLockDir, { recursive: true });
    const userLockFile = path.join(userLockDir, 'prompt-registry.lock.json');
    const lock = {
      schemaVersion: 1,
      entries: [
        {
          bundleId: 'user-bundle',
          bundleVersion: '0.1.0',
          target: 'user-target',
          sourceId: 'local',
          installedAt: '2024-06-01T10:00:00Z',
          files: []
        }
      ]
    };
    await fs.writeFile(userLockFile, JSON.stringify(lock));
    const { exitCode, stdout } = await runCommand(
      ['status'],
      {
        commands: [createStatusCommand({ output: 'json' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      data: { lockfile: { entries: number; path: string } | null };
    };
    expect(parsed.data.lockfile).not.toBeNull();
    expect(parsed.data.lockfile!.entries).toBe(1);
    expect(parsed.data.lockfile!.path).toBe(userLockFile);
  });

  it('reads user-level targets when no project config exists', async () => {
    const userCfgDir = path.join(xdgConfig, 'prompt-registry');
    await fs.mkdir(userCfgDir, { recursive: true });
    await fs.writeFile(
      path.join(userCfgDir, 'targets.yml'),
      'targets:\n  - name: user-copilot\n    type: copilot-cli\n    scope: user\n'
    );
    const { exitCode, stdout } = await runCommand(
      ['status'],
      {
        commands: [createStatusCommand({ output: 'json' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      data: { targets: { name: string }[] };
    };
    expect(parsed.data.targets).toHaveLength(1);
    expect(parsed.data.targets[0].name).toBe('user-copilot');
  });

  it('StatusCommand native class runs successfully', async () => {
    const { exitCode, stdout } = await runCommand(
      ['status', '-o', 'json'],
      {
        commandClasses: [StatusCommand],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { status: string };
    expect(parsed.status).toBe('ok');
  });

  it('StatusCommand native class supports --verbose flag', async () => {
    const lockfile = {
      schemaVersion: 1,
      entries: [{ bundleId: 'b1', target: 't1', files: [], installedAt: new Date().toISOString(), fileChecksums: {}, bundleVersion: '1.0.0', sourceId: 's1' }],
      sources: {}
    };
    await fs.writeFile(path.join(tmpRoot, 'prompt-registry.lock.json'), JSON.stringify(lockfile));
    const { exitCode, stdout } = await runCommand(
      ['status', '-o', 'json', '--verbose'],
      {
        commandClasses: [StatusCommand],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { data: { lockfile: { bundles: unknown[] } } };
    expect(parsed.data.lockfile.bundles).toHaveLength(1);
  });

  it('status exits 1 and renders error on unexpected failure', async () => {
    const badFs = {
      ...createNodeFsAdapter(),
      exists: (_p: string): Promise<boolean> => Promise.reject(new Error('unexpected fs error'))
    };
    const { exitCode, stderr } = await runCommand(
      ['status'],
      {
        commands: [createStatusCommand({ output: 'text' })],
        context: {
          cwd: tmpRoot,
          fs: badFs,
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/unexpected fs error/i);
  });
});

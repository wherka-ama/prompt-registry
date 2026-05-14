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
});

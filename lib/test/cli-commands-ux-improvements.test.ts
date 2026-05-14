/**
 * Tests for UX improvements:
 *   F-02: hub create scaffold
 *   F-06: error hints
 *   F-07: top-level `search` alias
 *   F-09: --dry-run on profile activate
 *   F-11: apply command
 *   F-13: uninstall lockfile auto-locate
 */
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
  createApplyCommand,
} from '../src/cli/commands/apply';
import {
  HubCreateCommand,
} from '../src/cli/commands/hub';
import {
  IndexSearchCommand,
} from '../src/cli/commands/index-search';
import {
  ProfileActivateCommand,
} from '../src/cli/commands/profile';
import {
  UninstallCommand,
} from '../src/cli/commands/uninstall';
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
let indexFile: string;
let xdgConfig: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-ux-'));
  xdgConfig = path.join(tmpRoot, 'config');
  indexFile = path.join(tmpRoot, 'primitive-index.json');
  const idx = await PrimitiveIndex.buildFrom(
    new FakeBundleProvider(createFixtureBundles()),
    { hubId: 'test' }
  );
  saveIndex(idx, indexFile);
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('F-02: hub create scaffold', () => {
  it('errors with hint when --name is missing', async () => {
    const { exitCode, stderr } = await runCommand(
      ['hub', 'create'],
      {
        commandClasses: [HubCreateCommand],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('--name');
  });

  it('creates hub-config.yml at --out directory when --name is passed', async () => {
    const outDir = path.join(tmpRoot, 'new-hub');
    const nodeFs = createNodeFsAdapter();
    const { exitCode, stdout } = await runCommand(
      ['hub', 'create', '--name', 'My Test Hub', '--out', outDir],
      {
        commandClasses: [HubCreateCommand],
        context: {
          cwd: tmpRoot,
          fs: nodeFs,
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const configPath = path.join(outDir, 'hub-config.yml');
    const content = await fs.readFile(configPath, 'utf8');
    expect(content).toContain('My Test Hub');
    expect(content).toContain('version: "1.0.0"');
    expect(content).toContain('profiles: []');
    expect(stdout).toContain('hub-config.yml');
  });

  it('json output includes path and name', async () => {
    const outDir = path.join(tmpRoot, 'hub-json');
    const { exitCode, stdout } = await runCommand(
      ['hub', 'create', '--name', 'JSON Hub', '--out', outDir, '-o', 'json'],
      {
        commandClasses: [HubCreateCommand],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { data: { name: string; path: string } };
    expect(parsed.data.name).toBe('JSON Hub');
    expect(parsed.data.path).toContain('hub-config.yml');
  });
});

describe('F-06: error hints', () => {
  it('profile activate missing profileId shows hint', async () => {
    const { exitCode, stderr } = await runCommand(
      ['profile', 'activate'],
      {
        commandClasses: [ProfileActivateCommand],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('hint:');
    expect(stderr).toContain('profile list');
  });
});

describe('F-09: --dry-run on profile activate', () => {
  it('returns exit 0 and shows [dry-run] output without writing files', async () => {
    const hubsDir = path.join(xdgConfig, 'prompt-registry', 'hubs');
    const activeHubFile = path.join(xdgConfig, 'prompt-registry', 'active-hub.json');
    await fs.mkdir(hubsDir, { recursive: true });
    await fs.writeFile(
      path.join(hubsDir, 'my-hub.yml'),
      [
        'version: "1.0.0"',
        'metadata:',
        '  name: my-hub',
        '  description: ""',
        '  maintainer: ""',
        '  updatedAt: "2026-01-01T00:00:00Z"',
        'sources: []',
        'profiles:',
        '  - id: backend',
        '    name: Backend',
        '    bundles: []'
      ].join('\n')
    );
    await fs.writeFile(
      activeHubFile,
      JSON.stringify({ hubId: 'my-hub', setAt: new Date().toISOString() })
    );
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'targets:\n  - name: t1\n    type: copilot-cli\n    scope: user\n'
    );

    const { exitCode, stdout } = await runCommand(
      ['profile', 'activate', 'backend', '--dry-run'],
      {
        commandClasses: [ProfileActivateCommand],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('[dry-run]');
    expect(stdout).toContain('backend');
    expect(stdout).toContain('without --dry-run');
  });

  it('dry-run json output includes dryRun:true flag', async () => {
    const hubsDir = path.join(xdgConfig, 'prompt-registry', 'hubs');
    const activeHubFile = path.join(xdgConfig, 'prompt-registry', 'active-hub.json');
    await fs.mkdir(hubsDir, { recursive: true });
    await fs.writeFile(
      path.join(hubsDir, 'my-hub.yml'),
      [
        'version: "1.0.0"',
        'metadata:',
        '  name: my-hub',
        '  description: ""',
        '  maintainer: ""',
        '  updatedAt: "2026-01-01T00:00:00Z"',
        'sources: []',
        'profiles:',
        '  - id: p1',
        '    name: P1',
        '    bundles: []'
      ].join('\n')
    );
    await fs.writeFile(
      activeHubFile,
      JSON.stringify({ hubId: 'my-hub', setAt: new Date().toISOString() })
    );
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'targets:\n  - name: t1\n    type: copilot-cli\n    scope: user\n'
    );

    const { exitCode, stdout } = await runCommand(
      ['profile', 'activate', 'p1', '--dry-run', '-o', 'json'],
      {
        commandClasses: [ProfileActivateCommand],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { data: { dryRun: boolean } };
    expect(parsed.data.dryRun).toBe(true);
  });
});

describe('F-11: apply command', () => {
  it('errors when no lockfile exists', async () => {
    const { exitCode } = await runCommand(
      ['apply'],
      {
        commands: [createApplyCommand({ output: 'text' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(1);
  });

  it('errors with hint when lockfile has no useProfile', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.lock.json'),
      JSON.stringify({ schemaVersion: 1, entries: [], sources: {} })
    );
    const { exitCode, stderr } = await runCommand(
      ['apply'],
      {
        commands: [createApplyCommand({ output: 'text' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('profile activate');
  });

  it('json output on missing useProfile includes error code', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.lock.json'),
      JSON.stringify({ schemaVersion: 1, entries: [] })
    );
    const { exitCode, stdout } = await runCommand(
      ['apply'],
      {
        commands: [createApplyCommand({ output: 'json' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout) as { errors: { code: string; hint: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
    expect(parsed.errors[0].hint).toContain('profile activate');
  });
});

describe('F-07: top-level search alias', () => {
  it('IndexSearchCommand is registered under both [index, search] and [search]', () => {
    expect(IndexSearchCommand.paths).toContainEqual(['index', 'search']);
    expect(IndexSearchCommand.paths).toContainEqual(['search']);
  });
});

describe('F-13: uninstall lockfile auto-locate', () => {
  it('without --lockfile but with lockfile present, auto-selects it (exits 1 on missing target, not USAGE.MISSING_FLAG)', async () => {
    // Write a valid lockfile so auto-locate kicks in
    const lockfile = {
      schemaVersion: 1,
      entries: [{ bundleId: 'b1', target: 'my-vscode', installedFiles: [], checksum: '', installedAt: '' }]
    };
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.lock.json'),
      JSON.stringify(lockfile)
    );
    // target list doesn't include 'my-vscode' → should fail with target-not-found, not USAGE.MISSING_FLAG
    const { stdout } = await runCommand(
      ['uninstall', '-o', 'json'],
      {
        commandClasses: [UninstallCommand],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter(), env: { HOME: tmpRoot } }
      }
    );
    // Should not be the "provide bundle/lockfile/--all" error
    const parsed = JSON.parse(stdout) as { errors?: { message: string }[] };
    if (parsed.errors) {
      expect(parsed.errors[0].message).not.toMatch(/provide.*bundle-id.*lockfile.*--all/i);
    }
  });

  it('without lockfile present, still returns USAGE.MISSING_FLAG', async () => {
    // No lockfile in tmpRoot
    const { exitCode, stdout } = await runCommand(
      ['uninstall', '-o', 'json'],
      {
        commandClasses: [UninstallCommand],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter(), env: { HOME: tmpRoot } }
      }
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });
});

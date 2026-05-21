/**
 * Tests for the `update` command.
 *
 * Covers:
 *  - isNewerVersion pure function
 *  - no lockfile → exits with USAGE.MISSING_FLAG
 *  - lockfile with only local entries → exits 0, "0 updates" in JSON
 *  - --dry-run with local-only entries → no writes, correct status
 *  - --target filter: output scoped correctly
 */
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
  isNewerVersion,
  UpdateCommand,
} from '../src/cli/commands/update';
import {
  runCommand,
} from '../src/cli/framework';
import {
  NodeFileSystem,
} from '../src/infra/fs/node-filesystem';

let tmp: string;
let xdgConfig: string;
const fs = new NodeFileSystem();

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-update-'));
  xdgConfig = path.join(tmp, 'xdg');
  await fsp.mkdir(xdgConfig, { recursive: true });
});

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

const env = () => ({ XDG_CONFIG_HOME: xdgConfig, HOME: tmp });

function localOnlyLockfile(targetName: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    entries: [
      {
        target: targetName,
        sourceId: 'local-my-bundle',
        bundleId: 'my-bundle',
        bundleVersion: '1.0.0',
        installedAt: new Date().toISOString(),
        files: []
      }
    ],
    sources: { 'local-my-bundle': { type: 'local', url: '/tmp/my-bundle' } }
  }, null, 2);
}

function multiTargetLockfile(): string {
  return JSON.stringify({
    schemaVersion: 1,
    entries: [
      {
        target: 'target-a',
        sourceId: 'local-bundle-a',
        bundleId: 'bundle-a',
        bundleVersion: '1.0.0',
        installedAt: new Date().toISOString(),
        files: []
      },
      {
        target: 'target-b',
        sourceId: 'local-bundle-b',
        bundleId: 'bundle-b',
        bundleVersion: '2.0.0',
        installedAt: new Date().toISOString(),
        files: []
      }
    ],
    sources: {
      'local-bundle-a': { type: 'local', url: '/tmp/bundle-a' },
      'local-bundle-b': { type: 'local', url: '/tmp/bundle-b' }
    }
  }, null, 2);
}

// ---------------------------------------------------------------------------
// isNewerVersion — pure function tests
// ---------------------------------------------------------------------------

describe('isNewerVersion', () => {
  it('returns true when candidate is a higher patch', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
  });

  it('returns true when candidate is a higher minor', () => {
    expect(isNewerVersion('1.1.0', '1.0.9')).toBe(true);
  });

  it('returns true when candidate is a higher major', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  it('returns false for equal versions', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
  });

  it('returns false when candidate is older', () => {
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false);
  });

  it('strips leading v-prefix before comparing', () => {
    expect(isNewerVersion('1.1.0', 'v1.0.0')).toBe(true);
    expect(isNewerVersion('v1.0.0', 'v1.0.0')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UpdateCommand integration tests (no network — lockfile-only scenarios)
// ---------------------------------------------------------------------------

describe('UpdateCommand', () => {
  it('errors when no lockfile can be found', async () => {
    const result = await runCommand(['update', '-o', 'json'], {
      commandClasses: [UpdateCommand],
      context: { cwd: tmp, fs, env: env() }
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('exits 0 with 0 updates when all lockfile entries are local (not upgradeable)', async () => {
    await fsp.writeFile(
      path.join(tmp, 'prompt-registry.yml'),
      'targets:\n  - name: my-target\n    type: vscode\n    scope: user\n    path: /tmp/t\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(tmp, 'prompt-registry.lock.json'),
      localOnlyLockfile('my-target'),
      'utf8'
    );

    const result = await runCommand(['update', '-o', 'json', '--dry-run'], {
      commandClasses: [UpdateCommand],
      context: { cwd: tmp, fs, env: env() }
    });

    expect(result.exitCode, `stderr=${result.stderr}`).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      status: string;
      data: { checked: number; updated: number; updates: unknown[] };
    };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.checked).toBeGreaterThanOrEqual(0);
    expect(parsed.data.updates).toHaveLength(0);
  });

  it('--dry-run does not modify the lockfile', async () => {
    await fsp.writeFile(
      path.join(tmp, 'prompt-registry.yml'),
      'targets:\n  - name: my-target\n    type: vscode\n    scope: user\n    path: /tmp/t\n',
      'utf8'
    );
    const original = localOnlyLockfile('my-target');
    await fsp.writeFile(path.join(tmp, 'prompt-registry.lock.json'), original, 'utf8');

    await runCommand(['update', '-o', 'json', '--dry-run'], {
      commandClasses: [UpdateCommand],
      context: { cwd: tmp, fs, env: env() }
    });

    const after = await fsp.readFile(path.join(tmp, 'prompt-registry.lock.json'), 'utf8');
    expect(after).toBe(original);
  });

  it('--target restricts output to entries for that target', async () => {
    await fsp.writeFile(
      path.join(tmp, 'prompt-registry.yml'),
      [
        'targets:',
        '  - name: target-a',
        '    type: vscode',
        '    scope: user',
        '    path: /tmp/ta',
        '  - name: target-b',
        '    type: vscode',
        '    scope: user',
        '    path: /tmp/tb'
      ].join('\n') + '\n',
      'utf8'
    );
    await fsp.writeFile(
      path.join(tmp, 'prompt-registry.lock.json'),
      multiTargetLockfile(),
      'utf8'
    );

    const result = await runCommand(['update', '-o', 'json', '--dry-run', '--target', 'target-a'], {
      commandClasses: [UpdateCommand],
      context: { cwd: tmp, fs, env: env() }
    });

    expect(result.exitCode, `stderr=${result.stderr}`).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      status: string;
      data: { checked: number };
    };
    expect(parsed.status).toBe('ok');
    // Only target-a's 1 entry should have been checked
    expect(parsed.data.checked).toBe(1);
  });
});

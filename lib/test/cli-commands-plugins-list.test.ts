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
  createPluginsListCommand,
  createPluginsListCommandClass,
  PluginsListCommand,
} from '../src/cli/commands/plugins-list';
import {
  type FsAbstraction,
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

let tmpA: string;
let tmpB: string;
let realFs: FsAbstraction;

beforeEach(async () => {
  tmpA = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-plugins-a-'));
  tmpB = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-plugins-b-'));
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpA, { recursive: true, force: true });
  await fs.rm(tmpB, { recursive: true, force: true });
});

describe('plugins list', () => {
  it('returns empty data when no prompt-registry-* binaries on PATH', async () => {
    const result = await runCommand(['plugins', 'list'], {
      commands: [createPluginsListCommand({ output: 'json' })],
      context: {
        cwd: tmpA,
        fs: realFs,
        env: { PATH: `${tmpA}${path.delimiter}${tmpB}` }
      }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: unknown[]; status: string };
    expect(parsed.data).toStrictEqual([]);
    expect(parsed.status).toBe('ok');
  });

  it('discovers plugins by their prompt-registry-<name> filename', async () => {
    await fs.writeFile(path.join(tmpA, 'prompt-registry-foo'), '#!/bin/sh\necho foo');
    await fs.writeFile(path.join(tmpB, 'prompt-registry-bar'), '#!/bin/sh\necho bar');
    const result = await runCommand(['plugins', 'list'], {
      commands: [createPluginsListCommand({ output: 'json' })],
      context: {
        cwd: tmpA,
        fs: realFs,
        env: { PATH: `${tmpA}${path.delimiter}${tmpB}` }
      }
    });
    const parsed = JSON.parse(result.stdout) as { data: { name: string }[] };
    const names = parsed.data.map((p) => p.name).toSorted();
    expect(names).toStrictEqual(['bar', 'foo']);
  });

  it('flags PATH-conflicts as warnings (first match wins)', async () => {
    await fs.writeFile(path.join(tmpA, 'prompt-registry-foo'), '#!/bin/sh\necho A');
    await fs.writeFile(path.join(tmpB, 'prompt-registry-foo'), '#!/bin/sh\necho B');
    const result = await runCommand(['plugins', 'list'], {
      commands: [createPluginsListCommand({ output: 'json' })],
      context: {
        cwd: tmpA,
        fs: realFs,
        env: { PATH: `${tmpA}${path.delimiter}${tmpB}` }
      }
    });
    const parsed = JSON.parse(result.stdout) as {
      data: { name: string; source: string }[];
      warnings: string[];
      status: string;
    };
    expect(parsed.data.length).toBe(1);
    expect(parsed.data[0].name).toBe('foo');
    expect(parsed.data[0].source).toMatch(new RegExp(`^${tmpA}`));
    expect(parsed.warnings.length).toBe(1);
    expect(parsed.status).toBe('warning');
  });

  it('outputs text format with plugin names and sources', async () => {
    await fs.writeFile(path.join(tmpA, 'prompt-registry-test'), '#!/bin/sh\necho test');
    const result = await runCommand(['plugins', 'list'], {
      commands: [createPluginsListCommand({ output: 'text' })],
      context: {
        cwd: tmpA,
        fs: realFs,
        env: { PATH: tmpA }
      }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('test');
  });

  it('handles empty PATH gracefully', async () => {
    const result = await runCommand(['plugins', 'list'], {
      commands: [createPluginsListCommand({ output: 'json' })],
      context: {
        cwd: tmpA,
        fs: realFs,
        env: { PATH: '' }
      }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: unknown[] };
    expect(parsed.data).toStrictEqual([]);
  });

  it('PluginsListCommand native class lists plugins', async () => {
    await fs.writeFile(path.join(tmpA, 'prompt-registry-myplugin'), '');
    const result = await runCommand(['plugins', 'list'], {
      commandClasses: [PluginsListCommand],
      context: {
        cwd: tmpA,
        fs: realFs,
        env: { PATH: tmpA }
      }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('myplugin');
  });

  it('createPluginsListCommandClass factory lists plugins in json mode', async () => {
    await fs.writeFile(path.join(tmpB, 'prompt-registry-alpha'), '');
    const context = { cwd: tmpB, fs: realFs, env: { PATH: tmpB } };
    const result = await runCommand(['plugins', 'list', '-o', 'json'], {
      commandClasses: [createPluginsListCommandClass({ cwd: tmpB, fs: realFs, env: { PATH: tmpB } })],
      context
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: { name: string }[] };
    expect(parsed.data.some((p) => p.name === 'alpha')).toBe(true);
  });

  it('shows warning status when PATH dir is not readable (readDir throws)', async () => {
    const badFs: FsAbstraction = {
      ...realFs,
      exists: () => Promise.resolve(true),
      readDir: () => Promise.reject(new Error('permission denied'))
    };
    const result = await runCommand(['plugins', 'list'], {
      commands: [createPluginsListCommand({ output: 'json' })],
      context: { cwd: tmpA, fs: badFs, env: { PATH: tmpA } }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: unknown[] };
    expect(parsed.data).toStrictEqual([]);
  });
});

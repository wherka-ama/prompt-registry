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
  ConfigGetCommand,
  createConfigGetCommand,
  createConfigGetCommandClass,
} from '../src/cli/commands/config-get';
import {
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

let tmpRoot: string;
const fsAdapter = createNodeFsAdapter();

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-cfg-get-'));
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe('config get command (createConfigGetCommand)', () => {
  it('exits 1 with USAGE.MISSING_FLAG when key is empty', async () => {
    const { exitCode, stdout } = await runCommand(
      ['config', 'get'],
      { commands: [createConfigGetCommand({ key: '', output: 'json' })], context: { cwd: tmpRoot, fs: fsAdapter } }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout) as { errors: { code: string }[] };
    expect(env.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('returns unset for an unknown key', async () => {
    const { exitCode, stdout } = await runCommand(
      ['config', 'get'],
      { commands: [createConfigGetCommand({ key: 'totally.unknown.key', output: 'json' })], context: { cwd: tmpRoot, fs: fsAdapter } }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { data: { key: string; value: unknown } };
    expect(env.data.key).toBe('totally.unknown.key');
    expect(env.data.value).toBeUndefined();
  });

  it('text output renders key: value', async () => {
    const { exitCode, stdout } = await runCommand(
      ['config', 'get'],
      { commands: [createConfigGetCommand({ key: 'totally.unknown.key', output: 'text' })], context: { cwd: tmpRoot, fs: fsAdapter } }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('totally.unknown.key:');
    expect(stdout).toContain('(unset)');
  });
});

describe('ConfigGetCommand (native class)', () => {
  it('returns value for known config key via positional arg', async () => {
    const { exitCode, stdout } = await runCommand(
      ['config', 'get', 'totally.unknown', '-o', 'json'],
      { commandClasses: [ConfigGetCommand], context: { cwd: tmpRoot, fs: fsAdapter } }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { status: string; data: { key: string } };
    expect(env.status).toBe('ok');
    expect(env.data.key).toBe('totally.unknown');
  });

  it('exits non-zero when no key positional arg is given', async () => {
    const { exitCode } = await runCommand(
      ['config', 'get'],
      { commandClasses: [ConfigGetCommand], context: { cwd: tmpRoot, fs: fsAdapter } }
    );
    expect(exitCode).toBeGreaterThan(0);
  });

  it('yaml output format works', async () => {
    const { exitCode, stdout } = await runCommand(
      ['config', 'get', 'some.key', '-o', 'yaml'],
      { commandClasses: [ConfigGetCommand], context: { cwd: tmpRoot, fs: fsAdapter } }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('status: ok');
  });

  it('reads from config file when present', async () => {
    await fsp.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'targets:\n  - name: default\n    type: vscode\n    scope: user\n',
      'utf8'
    );
    const { exitCode, stdout } = await runCommand(
      ['config', 'get', 'targets', '-o', 'json'],
      { commandClasses: [ConfigGetCommand], context: { cwd: tmpRoot, fs: fsAdapter } }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { data: { key: string; value: unknown } };
    expect(env.data.key).toBe('targets');
    expect(Array.isArray(env.data.value)).toBe(true);
  });

  it('exits 1 with CONFIG.LOAD_FAILED when fs.readFile throws (native class)', async () => {
    const badFs = {
      ...fsAdapter,
      exists: (): Promise<boolean> => Promise.resolve(true),
      readFile: (): Promise<string> => Promise.reject(new Error('read error'))
    };
    const { exitCode, stdout } = await runCommand(
      ['config', 'get', 'some.key', '-o', 'json'],
      { commandClasses: [ConfigGetCommand], context: { cwd: tmpRoot, fs: badFs } }
    );
    expect(exitCode).toBeGreaterThan(0);
    expect(stdout).toMatch(/read error|CONFIG/);
  });

  it('createConfigGetCommandClass factory returns ok for known key', async () => {
    await fsp.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'targets:\n  - name: t1\n    type: vscode\n    scope: user\n',
      'utf8'
    );
    const sharedCtx = { cwd: tmpRoot, fs: fsAdapter, env: {} };
    const { exitCode, stdout } = await runCommand(
      ['config', 'get', 'targets', '-o', 'json'],
      {
        commandClasses: [createConfigGetCommandClass(sharedCtx as unknown as Parameters<typeof createConfigGetCommandClass>[0])],
        context: sharedCtx
      }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { data: { key: string } };
    expect(parsed.data.key).toBe('targets');
  });
});

describe('createConfigGetCommand factory', () => {
  it('exits 1 when config load fails (factory error path)', async () => {
    const badFs = {
      ...fsAdapter,
      exists: (): Promise<boolean> => Promise.resolve(true),
      readFile: (): Promise<string> => Promise.reject(new Error('disk error'))
    };
    const { exitCode } = await runCommand(
      ['config', 'get'],
      {
        commands: [createConfigGetCommand({ key: 'some.key', output: 'json' })],
        context: { cwd: tmpRoot, fs: badFs }
      }
    );
    expect(exitCode).toBeGreaterThan(0);
  });

  it('returns non-null value for object config key (factory textRenderer)', async () => {
    await fsp.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'targets:\n  - name: t1\n    type: vscode\n    scope: user\n',
      'utf8'
    );
    const { exitCode, stdout } = await runCommand(
      ['config', 'get'],
      {
        commands: [createConfigGetCommand({ key: 'targets', output: 'text' })],
        context: { cwd: tmpRoot, fs: fsAdapter }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('targets:');
  });
});

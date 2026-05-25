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
});

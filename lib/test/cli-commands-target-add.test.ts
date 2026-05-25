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
  createTargetAddCommand,
  TargetAddCommand,
} from '../src/cli/commands/target-add';
import {
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

let tmpRoot: string;
const fsAdapter = createNodeFsAdapter();

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-tgt-add-'));
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe('target add command (createTargetAddCommand)', () => {
  it('exits 1 with USAGE error when name is missing', async () => {
    const { exitCode, stdout } = await runCommand(
      ['target', 'add'],
      {
        commands: [createTargetAddCommand({ name: '', type: 'vscode', output: 'json' })],
        context: { cwd: tmpRoot, fs: fsAdapter }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout) as { errors: { code: string }[] };
    expect(env.errors[0].code).toMatch(/USAGE/);
  });

  it('exits 1 with USAGE error when type is invalid', async () => {
    const { exitCode, stdout } = await runCommand(
      ['target', 'add'],
      {
        commands: [createTargetAddCommand({ name: 'my-target', type: 'invalid-type', output: 'json' })],
        context: { cwd: tmpRoot, fs: fsAdapter }
      }
    );
    expect(exitCode).toBe(1);
    const env = JSON.parse(stdout) as { errors: { code: string }[] };
    expect(env.errors[0].code).toMatch(/USAGE|TARGET/);
  });

  it('creates config file and returns ok on success', async () => {
    const { exitCode, stdout } = await runCommand(
      ['target', 'add'],
      {
        commands: [createTargetAddCommand({ name: 'my-target', type: 'vscode', scope: 'repository', output: 'json' })],
        context: { cwd: tmpRoot, fs: fsAdapter }
      }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { status: string; data: { target: { name: string } } };
    expect(env.status).toBe('ok');
    expect(env.data.target.name).toBe('my-target');
  });

  it('text output renders target name', async () => {
    const { exitCode, stdout } = await runCommand(
      ['target', 'add'],
      {
        commands: [createTargetAddCommand({ name: 'my-copilot', type: 'copilot-cli', scope: 'user', output: 'text' })],
        context: { cwd: tmpRoot, fs: fsAdapter }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('my-copilot');
  });
});

describe('TargetAddCommand (native class)', () => {
  it('adds a target via positional + --type flags', async () => {
    const { exitCode, stdout } = await runCommand(
      ['target', 'add', 'my-vscode', '--type', 'vscode', '--scope', 'repository', '-o', 'json'],
      { commandClasses: [TargetAddCommand], context: { cwd: tmpRoot, fs: fsAdapter } }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { data: { target: { name: string; type: string } } };
    expect(env.data.target.name).toBe('my-vscode');
    expect(env.data.target.type).toBe('vscode');
  });

  it('exits 1 when --type is missing', async () => {
    const { exitCode } = await runCommand(
      ['target', 'add', 'my-target'],
      { commandClasses: [TargetAddCommand], context: { cwd: tmpRoot, fs: fsAdapter } }
    );
    expect(exitCode).toBe(1);
  });

  it('adds to existing config file', async () => {
    await fsp.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'targets:\n  - name: existing\n    type: vscode\n    scope: user\n',
      'utf8'
    );
    const { exitCode, stdout } = await runCommand(
      ['target', 'add', 'new-target', '--type', 'copilot-cli', '--scope', 'repository', '-o', 'json'],
      { commandClasses: [TargetAddCommand], context: { cwd: tmpRoot, fs: fsAdapter } }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { data: { created: boolean } };
    expect(env.data.created).toBe(false);
  });

  it('supports --path flag', async () => {
    const { exitCode, stdout } = await runCommand(
      ['target', 'add', 'custom', '--type', 'vscode', '--scope', 'repository', '--path', '.vscode/prompts', '-o', 'json'],
      { commandClasses: [TargetAddCommand], context: { cwd: tmpRoot, fs: fsAdapter } }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout) as { status: string };
    expect(env.status).toBe('ok');
  });
});

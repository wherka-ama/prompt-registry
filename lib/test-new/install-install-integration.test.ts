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
  createInstallCommand,
} from '../src/cli/commands/install';
import {
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from '../test/cli/helpers/node-fs-adapter';

const realFs = createNodeFsAdapter();

let work: string;

beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-install-int-'));
  await fs.writeFile(
    path.join(work, 'prompt-registry.yml'),
    `targets:\n  - name: my-vscode\n    type: vscode\n    scope: user\n    path: ${path.join(work, 'vscode')}\n`
  );
  const bdir = path.join(work, 'bundle');
  await fs.mkdir(path.join(bdir, 'prompts'), { recursive: true });
  await fs.mkdir(path.join(bdir, 'chatmodes'), { recursive: true });
  await fs.writeFile(
    path.join(bdir, 'deployment-manifest.yml'),
    'id: foo\nversion: 1.0.0\nname: Foo\n'
  );
  await fs.writeFile(path.join(bdir, 'prompts', 'a.md'), 'A prompt');
  await fs.writeFile(path.join(bdir, 'chatmodes', 'm.md'), 'A chatmode');
  await fs.writeFile(path.join(bdir, 'README.md'), '# Foo');
});

afterEach(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

describe('install integration', () => {
  it('installs a local bundle into a configured vscode target', async () => {
    const result = await runCommand(['install'], {
      commands: [createInstallCommand({
        output: 'json',
        bundle: 'foo',
        target: 'my-vscode',
        from: path.join(work, 'bundle')
      })],
      context: { cwd: work, fs: realFs, env: { HOME: work } }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { written: string[]; skipped: string[]; bundle: { id: string; version: string } };
    };
    expect(parsed.data.bundle.id).toBe('foo');
    expect(parsed.data.written.length).toBe(2);
    const promptFile = path.join(work, 'vscode', 'prompts', 'a.md');
    const chatmodeFile = path.join(work, 'vscode', 'chatmodes', 'm.md');
    expect(await fs.readFile(promptFile, 'utf8')).toBe('A prompt');
    expect(await fs.readFile(chatmodeFile, 'utf8')).toBe('A chatmode');
    await expect(fs.access(path.join(work, 'vscode', 'README.md'))).rejects.toThrow();
  });

  it('--dry-run does not touch disk', async () => {
    const result = await runCommand(['install'], {
      commands: [createInstallCommand({
        output: 'json',
        bundle: 'foo',
        target: 'my-vscode',
        from: path.join(work, 'bundle'),
        dryRun: true
      })],
      context: { cwd: work, fs: realFs, env: { HOME: work } }
    });
    expect(result.exitCode).toBe(0);
    await expect(fs.access(path.join(work, 'vscode', 'prompts'))).rejects.toThrow();
  });

  it('--allow-target rejects targets outside the set', async () => {
    const result = await runCommand(['install'], {
      commands: [createInstallCommand({
        output: 'json',
        bundle: 'foo',
        target: 'my-vscode',
        from: path.join(work, 'bundle'),
        allowTarget: 'production-only'
      })],
      context: { cwd: work, fs: realFs, env: { HOME: work } }
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string; message: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
    expect(parsed.errors[0].message).toContain('--allow-target');
  });

  it('--allow-target permits targets in the set', async () => {
    const result = await runCommand(['install'], {
      commands: [createInstallCommand({
        output: 'json',
        bundle: 'foo',
        target: 'my-vscode',
        from: path.join(work, 'bundle'),
        allowTarget: 'my-vscode,prod-vscode'
      })],
      context: { cwd: work, fs: realFs, env: { HOME: work } }
    });
    expect(result.exitCode).toBe(0);
  });

  it('honors allowedKinds (chatmodes excluded)', async () => {
    await fs.writeFile(
      path.join(work, 'prompt-registry.yml'),
      `targets:\n  - name: my-vscode\n    type: vscode\n    scope: user\n    path: ${path.join(work, 'vscode')}\n    allowedKinds: [prompts]\n`
    );
    const result = await runCommand(['install'], {
      commands: [createInstallCommand({
        output: 'json',
        bundle: 'foo',
        target: 'my-vscode',
        from: path.join(work, 'bundle')
      })],
      context: { cwd: work, fs: realFs, env: { HOME: work } }
    });
    expect(result.exitCode).toBe(0);
    await fs.access(path.join(work, 'vscode', 'prompts', 'a.md'));
    await expect(fs.access(path.join(work, 'vscode', 'chatmodes', 'm.md'))).rejects.toThrow();
  });
});

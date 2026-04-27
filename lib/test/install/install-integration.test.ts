/**
 * Phase 5 / Iter 24 — install integration test.
 *
 * Drives the install command through the runCommand framework
 * helper: build a project with a target, drop a local bundle on
 * disk, install it, verify file placement.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createInstallCommand,
} from '../../src/cli/commands/install';
import {
  runCommand,
} from '../../src/cli/framework';
import {
  createNodeFsAdapter,
} from '../cli/helpers/node-fs-adapter';

const realFs = createNodeFsAdapter();

let work: string;

beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-install-int-'));
  // Project root with a vscode target pointing at <work>/vscode.
  await fs.writeFile(
    path.join(work, 'prompt-registry.yml'),
    `targets:\n  - name: my-vscode\n    type: vscode\n    scope: user\n    path: ${path.join(work, 'vscode')}\n`
  );
  // Local bundle on disk.
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

describe('Phase 5 / Iter 24 — install integration', () => {
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
    assert.strictEqual(result.exitCode, 0, `expected exit 0; stdout=${result.stdout}; stderr=${result.stderr}`);
    const parsed = JSON.parse(result.stdout) as {
      data: { written: string[]; skipped: string[]; bundle: { id: string; version: string } };
    };
    assert.strictEqual(parsed.data.bundle.id, 'foo');
    assert.strictEqual(parsed.data.written.length, 2);
    // Verify on disk.
    const promptFile = path.join(work, 'vscode', 'prompts', 'a.md');
    const chatmodeFile = path.join(work, 'vscode', 'chatmodes', 'm.md');
    assert.strictEqual(await fs.readFile(promptFile, 'utf8'), 'A prompt');
    assert.strictEqual(await fs.readFile(chatmodeFile, 'utf8'), 'A chatmode');
    // README is in skipPaths, manifest is too -> should NOT be written.
    await assert.rejects(() => fs.access(path.join(work, 'vscode', 'README.md')));
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
    assert.strictEqual(result.exitCode, 0);
    // The vscode directory should not have been touched.
    await assert.rejects(() => fs.access(path.join(work, 'vscode', 'prompts')));
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
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string; message: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
    assert.ok(parsed.errors[0].message.includes('--allow-target'));
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
    assert.strictEqual(result.exitCode, 0);
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
    assert.strictEqual(result.exitCode, 0);
    await fs.access(path.join(work, 'vscode', 'prompts', 'a.md'));
    await assert.rejects(() => fs.access(path.join(work, 'vscode', 'chatmodes', 'm.md')));
  });
});

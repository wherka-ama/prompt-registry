/**
 * Phase 4 / Iter 32 — `target` subcommand stubs.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createTargetAddCommand,
} from '../../../src/cli/commands/target-add';
import {
  createTargetListCommand,
} from '../../../src/cli/commands/target-list';
import {
  createTargetRemoveCommand,
} from '../../../src/cli/commands/target-remove';
import {
  type FsAbstraction,
  runCommand,
} from '../../../src/cli/framework';
import {
  createNodeFsAdapter,
} from '../helpers/node-fs-adapter';

let tmpRoot: string;
let realFs: FsAbstraction;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-target-'));
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('Phase 4 / Iter 32 — target stubs', () => {
  it('target list returns empty array by default', async () => {
    const result = await runCommand(['target', 'list'], {
      commands: [createTargetListCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as { data: unknown[] };
    assert.deepStrictEqual(parsed.data, []);
  });

  it('target list reads targets[] from prompt-registry.yml', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'targets:\n  - name: my-vscode\n    type: vscode\n'
    );
    const result = await runCommand(['target', 'list'], {
      commands: [createTargetListCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    const parsed = JSON.parse(result.stdout) as {
      data: { name: string; type: string }[];
    };
    assert.strictEqual(parsed.data.length, 1);
    assert.strictEqual(parsed.data[0].name, 'my-vscode');
  });

  it('target add rejects empty name', async () => {
    const result = await runCommand(['target', 'add'], {
      commands: [createTargetAddCommand({ output: 'json', name: '', type: 'vscode' })]
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
  });

  it('target add rejects unknown type', async () => {
    const result = await runCommand(['target', 'add'], {
      commands: [createTargetAddCommand({ output: 'json', name: 'foo', type: 'xyzzy' })]
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string; message: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
    assert.ok(parsed.errors[0].message.includes('xyzzy'));
  });

  it('target add persists into prompt-registry.yml (Phase 5 iter 3)', async () => {
    const result = await runCommand(['target', 'add'], {
      commands: [createTargetAddCommand({ output: 'json', name: 'foo', type: 'vscode' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    assert.strictEqual(result.exitCode, 0, `expected exit 0; stdout=${result.stdout}`);
    const parsed = JSON.parse(result.stdout) as {
      data: { target: { name: string; type: string }; created: boolean };
    };
    assert.strictEqual(parsed.data.target.name, 'foo');
    assert.strictEqual(parsed.data.target.type, 'vscode');
    assert.strictEqual(parsed.data.created, true);
    // Verify it actually landed on disk.
    const written = await fs.readFile(path.join(tmpRoot, 'prompt-registry.yml'), 'utf8');
    assert.ok(written.includes('foo'));
    assert.ok(written.includes('vscode'));
  });

  it('target add rejects duplicate names', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'targets:\n  - name: foo\n    type: vscode\n    scope: user\n'
    );
    const result = await runCommand(['target', 'add'], {
      commands: [createTargetAddCommand({ output: 'json', name: 'foo', type: 'vscode' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string; message: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
    assert.ok(parsed.errors[0].message.includes('already exists'));
  });

  it('target remove deletes from prompt-registry.yml (Phase 5 iter 4)', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'targets:\n  - name: foo\n    type: vscode\n    scope: user\n  - name: bar\n    type: kiro\n    scope: user\n'
    );
    const result = await runCommand(['target', 'remove'], {
      commands: [createTargetRemoveCommand({ output: 'json', name: 'foo' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    assert.strictEqual(result.exitCode, 0, `expected exit 0; stdout=${result.stdout}`);
    const written = await fs.readFile(path.join(tmpRoot, 'prompt-registry.yml'), 'utf8');
    assert.ok(!written.includes('foo'));
    assert.ok(written.includes('bar'));
  });

  it('target remove returns USAGE.MISSING_FLAG for unknown name', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'targets:\n  - name: bar\n    type: kiro\n    scope: user\n'
    );
    const result = await runCommand(['target', 'remove'], {
      commands: [createTargetRemoveCommand({ output: 'json', name: 'foo' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string; message: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
    assert.ok(parsed.errors[0].message.includes('not found'));
  });

  it('target remove rejects empty name', async () => {
    const result = await runCommand(['target', 'remove'], {
      commands: [createTargetRemoveCommand({ output: 'json', name: '' })]
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
  });
});

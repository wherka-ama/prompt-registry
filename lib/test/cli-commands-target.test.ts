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
  createTargetAddCommand,
} from '../src/cli/commands/target-add';
import {
  createTargetListCommand,
} from '../src/cli/commands/target-list';
import {
  createTargetRemoveCommand,
} from '../src/cli/commands/target-remove';
import {
  type FsAbstraction,
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

let tmpRoot: string;
let realFs: FsAbstraction;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-target-'));
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('target stubs', () => {
  it('target list returns empty array by default', async () => {
    const result = await runCommand(['target', 'list'], {
      commands: [createTargetListCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: unknown[] };
    expect(parsed.data).toStrictEqual([]);
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
    expect(parsed.data.length).toBe(1);
    expect(parsed.data[0].name).toBe('my-vscode');
  });

  it('target add rejects empty name', async () => {
    const result = await runCommand(['target', 'add'], {
      commands: [createTargetAddCommand({ output: 'json', name: '', type: 'vscode' })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('target add rejects unknown type', async () => {
    const result = await runCommand(['target', 'add'], {
      commands: [createTargetAddCommand({ output: 'json', name: 'foo', type: 'xyzzy' })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string; message: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
    expect(parsed.errors[0].message).toMatch(/xyzzy/);
  });

  it('target add persists into prompt-registry.yml (Phase 5 iter 3)', async () => {
    const result = await runCommand(['target', 'add'], {
      commands: [createTargetAddCommand({ output: 'json', name: 'foo', type: 'vscode' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { target: { name: string; type: string }; created: boolean };
    };
    expect(parsed.data.target.name).toBe('foo');
    expect(parsed.data.target.type).toBe('vscode');
    expect(parsed.data.created).toBe(true);
    const written = await fs.readFile(path.join(tmpRoot, 'prompt-registry.yml'), 'utf8');
    expect(written).toMatch(/foo/);
    expect(written).toMatch(/vscode/);
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
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string; message: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
    expect(parsed.errors[0].message).toMatch(/already exists/);
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
    expect(result.exitCode).toBe(0);
    const written = await fs.readFile(path.join(tmpRoot, 'prompt-registry.yml'), 'utf8');
    expect(written).not.toMatch(/foo/);
    expect(written).toMatch(/bar/);
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
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string; message: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
    expect(parsed.errors[0].message).toMatch(/not found/);
  });

  it('target remove rejects empty name', async () => {
    const result = await runCommand(['target', 'remove'], {
      commands: [createTargetRemoveCommand({ output: 'json', name: '' })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });
});

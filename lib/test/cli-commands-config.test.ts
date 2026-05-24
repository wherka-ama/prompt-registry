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
  createConfigGetCommand,
} from '../src/cli/commands/config-get';
import {
  createConfigListCommand,
} from '../src/cli/commands/config-list';
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
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-config-'));
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('config commands', () => {
  it('config list dumps the resolved config', async () => {
    const result = await runCommand(['config', 'list'], {
      commands: [createConfigListCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: { version: number } };
    expect(parsed.data.version).toBe(1);
  });

  it('config list reads project-level config from prompt-registry.yml', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'cli:\n  output: json\n'
    );
    const result = await runCommand(['config', 'list'], {
      commands: [createConfigListCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    const parsed = JSON.parse(result.stdout) as {
      data: { cli?: { output?: string } };
    };
    expect(parsed.data.cli?.output).toBe('json');
  });

  it('config get reads a dotted key', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'cli:\n  output: yaml\n'
    );
    const result = await runCommand(['config', 'get'], {
      commands: [createConfigGetCommand({ output: 'json', key: 'cli.output' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    const parsed = JSON.parse(result.stdout) as { data: { value: unknown } };
    expect(parsed.data.value).toBe('yaml');
  });

  it('config get returns undefined for a missing key', async () => {
    const result = await runCommand(['config', 'get'], {
      commands: [createConfigGetCommand({ output: 'json', key: 'no.such.key' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    const parsed = JSON.parse(result.stdout) as { data: { value: unknown } };
    expect(parsed.data.value).toBe(undefined);
  });

  it('config get exits 1 on empty key', async () => {
    const result = await runCommand(['config', 'get'], {
      commands: [createConfigGetCommand({ output: 'json', key: '' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('config get reads nested dotted key', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'cli:\n  output: json\n  indent: 2\n'
    );
    const result = await runCommand(['config', 'get'], {
      commands: [createConfigGetCommand({ output: 'json', key: 'cli.indent' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    const parsed = JSON.parse(result.stdout) as { data: { value: unknown } };
    expect(parsed.data.value).toBe(2);
  });

  it('config get handles object values in text output', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'cli:\n  output: json\n'
    );
    const result = await runCommand(['config', 'get'], {
      commands: [createConfigGetCommand({ output: 'text', key: 'cli' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('cli:');
    expect(result.stdout).toContain('json');
  });

  it('config get displays (unset) for undefined in text output', async () => {
    const result = await runCommand(['config', 'get'], {
      commands: [createConfigGetCommand({ output: 'text', key: 'no.such.key' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('(unset)');
  });

  it('config get handles array values', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'targets:\n  - name: vscode\n    type: vscode\n'
    );
    const result = await runCommand(['config', 'get'], {
      commands: [createConfigGetCommand({ output: 'json', key: 'targets' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    const parsed = JSON.parse(result.stdout) as { data: { value: unknown } };
    expect(Array.isArray(parsed.data.value)).toBe(true);
  });

  it('config list text output contains section headers', async () => {
    const result = await runCommand(['config', 'list'], {
      commands: [createConfigListCommand({ output: 'text' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Prompt Registry Configuration');
  });

  it('config list text output includes targets section when targets configured', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'prompt-registry.yml'),
      'targets:\n  - name: vscode-target\n    type: vscode\n    scope: user\n'
    );
    const result = await runCommand(['config', 'list'], {
      commands: [createConfigListCommand({ output: 'text' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('vscode-target');
    expect(result.stdout).toContain('vscode');
  });

  it('config list text includes "No targets" when target list empty', async () => {
    const result = await runCommand(['config', 'list'], {
      commands: [createConfigListCommand({ output: 'text' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    expect(result.exitCode).toBe(0);
    // Either no targets section or explicitly says no targets configured
    const hasNoTargets = result.stdout.includes('No targets') || !result.stdout.includes('=== Targets ===');
    expect(hasNoTargets).toBe(true);
  });

  it('config list yaml output wraps in envelope', async () => {
    const result = await runCommand(['config', 'list'], {
      commands: [createConfigListCommand({ output: 'yaml' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('status: ok');
  });

  it('config list uses text format by default', async () => {
    const result = await runCommand(['config', 'list'], {
      commands: [createConfigListCommand()],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('"status"');
  });
});

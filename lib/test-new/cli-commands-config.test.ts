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
} from '../test/cli/helpers/node-fs-adapter';

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
});

/**
 * Phase 4 / Iter 26 — `config get` + `config list` tests.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createConfigGetCommand,
} from '../../../src/cli/commands/config-get';
import {
  createConfigListCommand,
} from '../../../src/cli/commands/config-list';
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
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-config-'));
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('Phase 4 / Iter 26 — config commands', () => {
  it('config list dumps the resolved config', async () => {
    const result = await runCommand(['config', 'list'], {
      commands: [createConfigListCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as { data: { version: number } };
    // Default config carries `version: 1`.
    assert.strictEqual(parsed.data.version, 1);
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
    assert.strictEqual(parsed.data.cli?.output, 'json');
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
    assert.strictEqual(parsed.data.value, 'yaml');
  });

  it('config get returns undefined for a missing key', async () => {
    const result = await runCommand(['config', 'get'], {
      commands: [createConfigGetCommand({ output: 'json', key: 'no.such.key' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    const parsed = JSON.parse(result.stdout) as { data: { value: unknown } };
    assert.strictEqual(parsed.data.value, undefined);
  });

  it('config get exits 1 on empty key', async () => {
    const result = await runCommand(['config', 'get'], {
      commands: [createConfigGetCommand({ output: 'json', key: '' })],
      context: { cwd: tmpRoot, fs: realFs, env: {} }
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
  });
});

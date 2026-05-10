/**
 * TDD tests for uninstall CLI command.
 *
 * Tests validation and error handling for the three uninstall modes:
 * - by bundle ID
 * - from lockfile
 * - all bundles for target
 */
import * as assert from 'node:assert';
import {
  createUninstallCommand,
} from '../../../src/cli/commands/uninstall';
import {
  runCommand,
} from '../../../src/cli/framework';

describe('uninstall command', () => {
  it('exits 1 with USAGE.MISSING_FLAG when neither bundle, lockfile, nor --all is supplied', async () => {
    const result = await runCommand(['uninstall'], {
      commands: [createUninstallCommand({ output: 'json' })]
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as {
      errors: { code: string; message: string }[];
    };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
    assert.ok(parsed.errors[0].message.includes('bundle-id') || parsed.errors[0].message.includes('lockfile'));
  });

  it('exits 1 with USAGE.MISSING_FLAG when bundle is supplied without --target', async () => {
    const result = await runCommand(['uninstall'], {
      commands: [createUninstallCommand({ output: 'json', bundle: 'foo' })]
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string; message: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
    assert.ok(parsed.errors[0].message.includes('--target'));
  });

  it('exits 1 with USAGE.MISSING_FLAG when lockfile is supplied without --target', async () => {
    const result = await runCommand(['uninstall'], {
      commands: [createUninstallCommand({ output: 'json', lockfile: 'a.lock.json' })]
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
  });

  it('exits 1 with USAGE.MISSING_FLAG when --all is supplied without --target', async () => {
    const result = await runCommand(['uninstall'], {
      commands: [createUninstallCommand({ output: 'json', all: true })]
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
  });
});

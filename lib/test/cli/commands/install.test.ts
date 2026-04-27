/**
 * Phase 4 / Iter 33 — `install` stub tests.
 */
import * as assert from 'node:assert';
import {
  createInstallCommand,
} from '../../../src/cli/commands/install';
import {
  runCommand,
} from '../../../src/cli/framework';

describe('Phase 4 / Iter 33 — install stub', () => {
  it('exits 1 with USAGE.MISSING_FLAG when neither bundle nor lockfile is supplied', async () => {
    const result = await runCommand(['install'], {
      commands: [createInstallCommand({ output: 'json' })]
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as {
      errors: { code: string; message: string }[];
    };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
    assert.ok(parsed.errors[0].message.includes('bundle-id'));
  });

  it('exits 1 with USAGE.MISSING_FLAG when bundle is supplied without --target', async () => {
    // Phase 5 / Iter 23: install now requires --target. Without it,
    // the command surfaces USAGE.MISSING_FLAG (not INTERNAL.UNEXPECTED).
    const result = await runCommand(['install'], {
      commands: [createInstallCommand({ output: 'json', bundle: 'foo' })]
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string; message: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
    assert.ok(parsed.errors[0].message.includes('--target'));
  });

  it('exits 1 with USAGE.MISSING_FLAG when lockfile is supplied without --target', async () => {
    const result = await runCommand(['install'], {
      commands: [createInstallCommand({ output: 'json', lockfile: 'a.lock.json' })]
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
  });
});

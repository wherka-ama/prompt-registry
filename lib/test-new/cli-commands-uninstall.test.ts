import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createUninstallCommand,
} from '../src/cli/commands/uninstall';
import {
  runCommand,
} from '../src/cli/framework';

describe('uninstall command', () => {
  it('exits 1 with USAGE.MISSING_FLAG when neither bundle, lockfile, nor --all is supplied', async () => {
    const result = await runCommand(['uninstall'], {
      commands: [createUninstallCommand({ output: 'json' })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      errors: { code: string; message: string }[];
    };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
    expect(parsed.errors[0].message).toMatch(/bundle-id|lockfile/);
  });

  it('exits 1 with USAGE.MISSING_FLAG when bundle is supplied without --target', async () => {
    const result = await runCommand(['uninstall'], {
      commands: [createUninstallCommand({ output: 'json', bundle: 'foo' })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string; message: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
    expect(parsed.errors[0].message).toMatch(/--target/);
  });

  it('exits 1 with USAGE.MISSING_FLAG when lockfile is supplied without --target', async () => {
    const result = await runCommand(['uninstall'], {
      commands: [createUninstallCommand({ output: 'json', lockfile: 'a.lock.json' })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('exits 1 with USAGE.MISSING_FLAG when --all is supplied without --target', async () => {
    const result = await runCommand(['uninstall'], {
      commands: [createUninstallCommand({ output: 'json', all: true })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });
});

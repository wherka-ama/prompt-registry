import {
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

describe('install stub', () => {
  it('exits 1 with USAGE.MISSING_FLAG when neither bundle nor lockfile is supplied', async () => {
    const result = await runCommand(['install'], {
      commands: [createInstallCommand({ output: 'json' })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      errors: { code: string; message: string }[];
    };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
    expect(parsed.errors[0].message).toMatch(/bundle-id/);
  });

  it('exits 1 with USAGE.MISSING_FLAG when bundle is supplied without --target', async () => {
    const result = await runCommand(['install'], {
      commands: [createInstallCommand({ output: 'json', bundle: 'foo' })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string; message: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
    expect(parsed.errors[0].message).toMatch(/--target/);
  });

  it('exits 1 with USAGE.MISSING_FLAG when lockfile is supplied without --target', async () => {
    const result = await runCommand(['install'], {
      commands: [createInstallCommand({ output: 'json', lockfile: 'a.lock.json' })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });
});

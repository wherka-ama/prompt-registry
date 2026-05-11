import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createDoctorCommand,
} from '../src/cli/commands/doctor';
import {
  type FsAbstraction,
  runCommand,
} from '../src/cli/framework';

const mockFs: FsAbstraction = {
  readFile: () => Promise.reject(new Error('not implemented')),
  writeFile: () => Promise.reject(new Error('not implemented')),
  readJson: () => Promise.reject(new Error('not implemented')),
  writeJson: () => Promise.reject(new Error('not implemented')),
  exists: (p: string): Promise<boolean> => Promise.resolve(p === process.cwd() || p === '/'),
  mkdir: () => Promise.reject(new Error('not implemented')),
  readDir: () => Promise.reject(new Error('not implemented')),
  remove: () => Promise.reject(new Error('not implemented'))
};

describe('doctor command', () => {
  it('runs and exits 0 in a healthy environment (text mode default)', async () => {
    const result = await runCommand(['doctor'], {
      commands: [createDoctorCommand()],
      context: {
        env: { PATH: '/usr/bin:/bin', NODE_VERSION: 'v20.11.0' },
        cwd: process.cwd(),
        fs: mockFs
      }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/prompt-registry doctor/);
    expect(result.stdout).toMatch(/\[ OK \] node-version/);
    expect(result.stdout).toMatch(/summary:/);
  });

  it('emits the JSON envelope when output=json', async () => {
    const result = await runCommand(['doctor'], {
      commands: [createDoctorCommand({ output: 'json' })],
      context: {
        env: { PATH: '/usr/bin', NODE_VERSION: 'v20.0.0' },
        cwd: process.cwd(),
        fs: mockFs
      }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      command: string;
      status: string;
      data: { summary: { ok: number; warn: number; fail: number } };
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.command).toBe('doctor');
    expect(parsed.status === 'ok' || parsed.status === 'warning').toBe(true);
    expect(parsed.data.summary.fail).toBe(0);
  });

  it('reports a FAIL and exits non-zero when Node version is too old', async () => {
    const result = await runCommand(['doctor'], {
      commands: [createDoctorCommand()],
      context: {
        env: { PATH: '/usr/bin', NODE_VERSION: 'v18.0.0' },
        cwd: process.cwd(),
        fs: mockFs
      }
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/\[FAIL\] node-version/);
  });

  it('reports a WARN when PATH is empty', async () => {
    const result = await runCommand(['doctor'], {
      commands: [createDoctorCommand({ output: 'json' })],
      context: {
        env: { PATH: '', NODE_VERSION: 'v20.0.0' },
        cwd: process.cwd(),
        fs: mockFs
      }
    });
    const parsed = JSON.parse(result.stdout) as {
      status: string;
      data: { checks: { name: string; status: string }[]; summary: { warn: number } };
    };
    expect(parsed.status).toBe('warning');
    expect(parsed.data.summary.warn).toBeGreaterThanOrEqual(1);
    const pathCheck = parsed.data.checks.find((c) => c.name === 'path-env');
    expect(pathCheck?.status).toBe('warn');
  });
});

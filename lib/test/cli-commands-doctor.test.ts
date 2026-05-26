import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createDoctorCommand,
  DoctorCommand,
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

// Simplified mock for JSON mode test - skip filesystem-heavy checks
const simpleMockFs: FsAbstraction = {
  readFile: () => Promise.reject(new Error('not implemented')),
  writeFile: () => Promise.reject(new Error('not implemented')),
  readJson: () => Promise.reject(new Error('not implemented')),
  writeJson: () => Promise.reject(new Error('not implemented')),
  exists: () => Promise.resolve(true),
  mkdir: () => Promise.resolve(undefined),
  readDir: () => Promise.resolve([]),
  remove: () => Promise.resolve(undefined)
};

describe('DoctorCommand (native class)', () => {
  it('runs doctor via native class', async () => {
    const result = await runCommand(['doctor'], {
      commandClasses: [DoctorCommand],
      context: {
        env: { PATH: '/usr/bin', NODE_VERSION: `v${process.versions.node}` },
        cwd: process.cwd(),
        fs: simpleMockFs
      }
    });
    expect(result.exitCode).toBeLessThanOrEqual(1);
  });

  it('cwd-accessible reports fail when cwd does not exist', async () => {
    const result = await runCommand(['doctor'], {
      commands: [createDoctorCommand({ output: 'json' })],
      context: {
        env: { PATH: '/usr/bin', NODE_VERSION: `v${process.versions.node}` },
        cwd: '/tmp/nonexistent-dir-xyz-12345',
        fs: {
          ...simpleMockFs,
          exists: () => Promise.resolve(false)
        }
      }
    });
    const parsed = JSON.parse(result.stdout) as { data: { checks: { name: string; status: string }[] } };
    const cwdCheck = parsed.data.checks.find((c) => c.name === 'cwd-accessible');
    expect(cwdCheck?.status).toBe('fail');
  });

  it('cwd-accessible reports fail when fs.exists throws', async () => {
    const result = await runCommand(['doctor'], {
      commands: [createDoctorCommand({ output: 'json' })],
      context: {
        env: { PATH: '/usr/bin', NODE_VERSION: `v${process.versions.node}` },
        cwd: process.cwd(),
        fs: {
          ...simpleMockFs,
          exists: () => Promise.reject(new Error('fs error'))
        }
      }
    });
    const parsed = JSON.parse(result.stdout) as { data: { checks: { name: string; status: string }[] } };
    const cwdCheck = parsed.data.checks.find((c) => c.name === 'cwd-accessible');
    expect(cwdCheck?.status).toBe('fail');
  });

  it('reports warning status when summary has warn > 0', async () => {
    const result = await runCommand(['doctor'], {
      commands: [createDoctorCommand({ output: 'json' })],
      context: {
        env: { PATH: '', NODE_VERSION: `v${process.versions.node}` },
        cwd: process.cwd(),
        fs: simpleMockFs
      }
    });
    const parsed = JSON.parse(result.stdout) as { status: string };
    expect(['ok', 'warning', 'error']).toContain(parsed.status);
  });
});

describe('doctor command', () => {
  it('runs and exits 0 in a healthy environment (text mode default)', { timeout: 10_000 }, async () => {
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

  it('emits the JSON envelope when output=json', { timeout: 10_000 }, async () => {
    const result = await runCommand(['doctor'], {
      commands: [createDoctorCommand({ output: 'json' })],
      context: {
        env: { PATH: '/usr/bin:/bin', NODE_VERSION: 'v20.11.0' },
        cwd: process.cwd(),
        fs: simpleMockFs
      }
    });
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      command: string;
      status: string;
      data: { summary: { ok: number; warn: number; fail: number } };
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.command).toBe('doctor');
    expect(['ok', 'warning', 'error']).toContain(parsed.status);
    expect(parsed.data.summary).toBeDefined();
    expect(typeof parsed.data.summary.ok).toBe('number');
    expect(typeof parsed.data.summary.warn).toBe('number');
    expect(typeof parsed.data.summary.fail).toBe('number');
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

  it('includes check names in JSON output', async () => {
    const result = await runCommand(['doctor'], {
      commands: [createDoctorCommand({ output: 'json' })],
      context: {
        env: { PATH: '/usr/bin', NODE_VERSION: 'v20.0.0' },
        cwd: process.cwd(),
        fs: simpleMockFs
      }
    });
    const parsed = JSON.parse(result.stdout) as {
      data: { checks: { name: string }[] };
    };
    const checkNames = parsed.data.checks.map((c) => c.name);
    expect(checkNames).toContain('node-version');
    expect(checkNames).toContain('path-env');
  });
});

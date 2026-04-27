/**
 * Phase 2 / Iter 8 — `doctor` subcommand tests.
 *
 * Doctor is the first leaf command. It exercises the full framework
 * stack (Context, formatOutput, framework adapter via runCommand) and
 * is the canary for spec §14.2 invariant #2 (no clipanion imports
 * outside lib/src/cli/framework/) and #3 (Context-only IO).
 */
import * as assert from 'node:assert';
import {
  createDoctorCommand,
} from '../../../src/cli/commands/doctor';
import {
  type FsAbstraction,
  runCommand,
} from '../../../src/cli/framework';

/**
 * Mock fs that returns true for exists(cwd) to satisfy the cwd check.
 * Real fs wiring lands in iter 2; for iter 8 we only need cwd to be
 * accessible for the doctor command to pass its checks.
 */
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

describe('Phase 2 / Iter 8 — doctor command', () => {
  it('runs and exits 0 in a healthy environment (text mode default)', async () => {
    const result = await runCommand(['doctor'], {
      commands: [createDoctorCommand()],
      context: {
        env: { PATH: '/usr/bin:/bin', NODE_VERSION: 'v20.11.0' },
        cwd: process.cwd(),
        fs: mockFs
      }
    });
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes('prompt-registry doctor'),
      `stdout should include header; got: ${result.stdout}`);
    assert.ok(result.stdout.includes('[ OK ] node-version'));
    assert.ok(result.stdout.includes('summary:'));
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
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      command: string;
      status: string;
      data: { summary: { ok: number; warn: number; fail: number } };
    };
    assert.strictEqual(parsed.schemaVersion, 1);
    assert.strictEqual(parsed.command, 'doctor');
    // Phase 5 / Iter 31 added project-config and install-targets
    // checks; in the bare mockFs world both warn, so status may be
    // 'warning' even though no checks fail. The contract is that
    // exit 0 maps to summary.fail === 0.
    assert.ok(parsed.status === 'ok' || parsed.status === 'warning');
    assert.strictEqual(parsed.data.summary.fail, 0);
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
    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.stdout.includes('[FAIL] node-version'));
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
    assert.strictEqual(parsed.status, 'warning');
    // Phase 5 / Iter 31: project-config + install-targets also warn
    // in the bare mockFs world. The contract is that path-env warns
    // and the count includes that.
    assert.ok(parsed.data.summary.warn >= 1);
    const pathCheck = parsed.data.checks.find((c) => c.name === 'path-env');
    assert.strictEqual(pathCheck?.status, 'warn');
  });
});

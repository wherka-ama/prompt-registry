/**
 * Phase 2 / Iter 7 — Golden-test runner contract.
 */
import * as assert from 'node:assert';
import {
  defineCommand,
  runCommand,
} from '../../../src/cli/framework';
import type {
  Context,
} from '../../../src/cli/framework';

describe('Phase 2 / Iter 7 — runCommand golden helper', () => {
  it('captures exit code, stdout, stderr in one call', async () => {
    const result = await runCommand(['hello'], {
      commands: [
        defineCommand({
          path: ['hello'],
          description: 'print hi',
          run: ({ ctx }: { ctx: Context }) => {
            ctx.stdout.write('hi\n');
            ctx.stderr.write('warning\n');
            return 0;
          }
        })
      ]
    });
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout, 'hi\n');
    assert.strictEqual(result.stderr, 'warning\n');
  });

  it('forwards Context overrides (env, cwd) into the run handler', async () => {
    let seenEnv = '';
    let seenCwd = '';
    const result = await runCommand(['probe'], {
      context: { env: { TOKEN: 'abc' }, cwd: '/work' },
      commands: [
        defineCommand({
          path: ['probe'],
          description: 'probe',
          run: ({ ctx }: { ctx: Context }) => {
            seenEnv = ctx.env.TOKEN ?? '';
            seenCwd = ctx.cwd();
            return 0;
          }
        })
      ]
    });
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(seenEnv, 'abc');
    assert.strictEqual(seenCwd, '/work');
  });

  it('returns 64 for unknown commands and writes to stderr', async () => {
    const result = await runCommand(['nope'], {
      commands: [
        defineCommand({
          path: ['hello'], description: 'h', run: () => 0
        })
      ]
    });
    assert.strictEqual(result.exitCode, 64);
    assert.strictEqual(result.stdout, '');
    assert.ok(result.stderr.length > 0);
  });

  it('uses sensible defaults for name and version', async () => {
    const result = await runCommand(['--version'], {
      commands: []
    });
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes('0.0.0-test'),
      `default test version should appear; got ${result.stdout}`);
  });
});

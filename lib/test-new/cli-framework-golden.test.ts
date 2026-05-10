import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  defineCommand,
  runCommand,
} from '../src/cli/framework';
import type {
  Context,
} from '../src/cli/framework';

describe('runCommand golden helper', () => {
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
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hi\n');
    expect(result.stderr).toBe('warning\n');
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
    expect(result.exitCode).toBe(0);
    expect(seenEnv).toBe('abc');
    expect(seenCwd).toBe('/work');
  });

  it('returns 64 for unknown commands and writes to stderr', async () => {
    const result = await runCommand(['nope'], {
      commands: [
        defineCommand({
          path: ['hello'], description: 'h', run: () => 0
        })
      ]
    });
    expect(result.exitCode).toBe(64);
    expect(result.stdout).toBe('');
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('uses sensible defaults for name and version', async () => {
    const result = await runCommand(['--version'], {
      commands: []
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.includes('0.0.0-test')).toBe(true);
  });
});

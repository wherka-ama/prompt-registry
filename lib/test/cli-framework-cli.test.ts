import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createTestContext,
  defineCommand,
  runCli,
} from '../src/cli/framework';
import type {
  Context,
} from '../src/cli/framework';

describe('framework adapter', () => {
  describe('defineCommand()', () => {
    it('returns a definition with path, description, and run handler', () => {
      const cmd = defineCommand({
        path: ['hello'],
        description: 'Print a greeting',
        run: () => 0
      });
      expect(cmd.path).toStrictEqual(['hello']);
      expect(cmd.description).toBe('Print a greeting');
      expect(typeof cmd.run).toBe('function');
    });

    it('accepts multi-segment paths for noun-verb taxonomy', () => {
      const cmd = defineCommand({
        path: ['index', 'search'],
        description: 'Search the primitive index',
        run: () => 0
      });
      expect(cmd.path).toStrictEqual(['index', 'search']);
    });
  });

  describe('runCli() — dispatch', () => {
    it('runs the matching command and returns its exit code', async () => {
      const ctx = createTestContext();
      const code = await runCli(['hello'], {
        ctx,
        name: 'prompt-registry',
        version: '0.0.0',
        commands: [
          defineCommand({
            path: ['hello'],
            description: 'Print a greeting',
            run: ({ ctx: c }: { ctx: Context }) => {
              c.stdout.write('hi\n');
              return 0;
            }
          })
        ]
      });
      expect(code).toBe(0);
      expect(ctx.stdout.captured()).toBe('hi\n');
    });

    it('dispatches multi-segment paths', async () => {
      const ctx = createTestContext();
      const code = await runCli(['index', 'search'], {
        ctx,
        name: 'prompt-registry',
        version: '0.0.0',
        commands: [
          defineCommand({
            path: ['index', 'search'],
            description: 'Search',
            run: ({ ctx: c }: { ctx: Context }) => {
              c.stdout.write('searched\n');
              return 0;
            }
          })
        ]
      });
      expect(code).toBe(0);
      expect(ctx.stdout.captured()).toBe('searched\n');
    });

    it('returns 64 (EX_USAGE) for an unknown command', async () => {
      const ctx = createTestContext();
      const code = await runCli(['nope'], {
        ctx,
        name: 'prompt-registry',
        version: '0.0.0',
        commands: [
          defineCommand({
            path: ['hello'],
            description: 'h',
            run: () => 0
          })
        ]
      });
      expect(code).toBe(64);
      expect(ctx.stderr.captured().length).toBeGreaterThan(0);
    });

    it('passes Context into the run handler', async () => {
      const ctx = createTestContext({ env: { FOO: 'bar' }, cwd: '/work' });
      let seenEnv = '';
      let seenCwd = '';
      const code = await runCli(['probe'], {
        ctx,
        name: 'prompt-registry',
        version: '0.0.0',
        commands: [
          defineCommand({
            path: ['probe'],
            description: 'p',
            run: ({ ctx: c }: { ctx: Context }) => {
              seenEnv = c.env.FOO ?? '';
              seenCwd = c.cwd();
              return 0;
            }
          })
        ]
      });
      expect(code).toBe(0);
      expect(seenEnv).toBe('bar');
      expect(seenCwd).toBe('/work');
    });

    it('returns the run handler exit code as-is for non-zero values', async () => {
      const ctx = createTestContext();
      const code = await runCli(['fail'], {
        ctx,
        name: 'prompt-registry',
        version: '0.0.0',
        commands: [
          defineCommand({
            path: ['fail'],
            description: 'f',
            run: () => 65
          })
        ]
      });
      expect(code).toBe(65);
    });

    it('catches thrown errors and returns 70 (EX_SOFTWARE)', async () => {
      const ctx = createTestContext();
      const code = await runCli(['bug'], {
        ctx,
        name: 'prompt-registry',
        version: '0.0.0',
        commands: [
          defineCommand({
            path: ['bug'],
            description: 'b',
            run: () => {
              throw new Error('kaboom');
            }
          })
        ]
      });
      expect(code).toBe(70);
      expect(ctx.stderr.captured().includes('kaboom')).toBe(true);
    });
  });

  describe('runCli() — built-in flags', () => {
    it('--version prints the configured version and returns 0', async () => {
      const ctx = createTestContext();
      const code = await runCli(['--version'], {
        ctx,
        name: 'prompt-registry',
        version: '1.2.3',
        commands: []
      });
      expect(code).toBe(0);
      expect(ctx.stdout.captured().includes('1.2.3')).toBe(true);
    });

    it('--help prints usage and returns 0', async () => {
      const ctx = createTestContext();
      const code = await runCli(['--help'], {
        ctx,
        name: 'prompt-registry',
        version: '1.2.3',
        commands: [
          defineCommand({ path: ['hello'], description: 'Greeting', run: () => 0 })
        ]
      });
      expect(code).toBe(0);
      const out = ctx.stdout.captured();
      expect(out.includes('prompt-registry') || out.includes('Usage')).toBe(true);
    });
  });
});

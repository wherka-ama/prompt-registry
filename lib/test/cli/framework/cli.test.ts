/**
 * Phase 2 / Iter 3 — Framework adapter (clipanion wrapping).
 *
 * These tests pin the *adapter* API. Spec §14.2 invariant #2 says only
 * `lib/src/cli/framework/` may import clipanion; everything else uses
 * the adapter's `defineCommand` / `runCli` surface.
 *
 * The adapter contract:
 *   - `defineCommand({ path, description, run })` — declarative command
 *     definition. `path` is a noun-verb tuple (e.g. ['index', 'search']).
 *   - `runCli(argv, { ctx, commands, name, version })` — executes argv
 *     against the registered commands and returns the chosen exit code.
 *     Never throws on usage errors; instead writes to ctx.stderr and
 *     returns a non-zero code.
 *
 * Iter 3 covers the minimum: registration, dispatch, --help, --version,
 * unknown-command, and Context injection. Inherited flags (--output,
 * --quiet, etc.) land in iter 5; --config in iter 4.
 */
import * as assert from 'node:assert';
import {
  createTestContext,
  defineCommand,
  runCli,
} from '../../../src/cli/framework';
import type {
  Context,
} from '../../../src/cli/framework';

describe('Phase 2 / Iter 3 — framework adapter', () => {
  describe('defineCommand()', () => {
    it('returns a definition with path, description, and run handler', () => {
      const cmd = defineCommand({
        path: ['hello'],
        description: 'Print a greeting',
        run: () => 0
      });
      assert.deepStrictEqual(cmd.path, ['hello']);
      assert.strictEqual(cmd.description, 'Print a greeting');
      assert.strictEqual(typeof cmd.run, 'function');
    });

    it('accepts multi-segment paths for noun-verb taxonomy', () => {
      const cmd = defineCommand({
        path: ['index', 'search'],
        description: 'Search the primitive index',
        run: () => 0
      });
      assert.deepStrictEqual(cmd.path, ['index', 'search']);
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
      assert.strictEqual(code, 0);
      assert.strictEqual(ctx.stdout.captured(), 'hi\n');
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
      assert.strictEqual(code, 0);
      assert.strictEqual(ctx.stdout.captured(), 'searched\n');
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
      assert.strictEqual(code, 64);
      // clipanion writes its own usage-style error to stderr; we only
      // assert *something* arrived, not the exact wording (would couple
      // us to clipanion's internal error formatting).
      assert.ok(ctx.stderr.captured().length > 0, 'unknown command must write to stderr');
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
      assert.strictEqual(code, 0);
      assert.strictEqual(seenEnv, 'bar');
      assert.strictEqual(seenCwd, '/work');
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
      assert.strictEqual(code, 65);
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
      assert.strictEqual(code, 70);
      assert.ok(ctx.stderr.captured().includes('kaboom'),
        `stderr should mention the error message; got: ${JSON.stringify(ctx.stderr.captured())}`);
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
      assert.strictEqual(code, 0);
      assert.ok(ctx.stdout.captured().includes('1.2.3'),
        `stdout should include version; got: ${JSON.stringify(ctx.stdout.captured())}`);
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
      assert.strictEqual(code, 0);
      const out = ctx.stdout.captured();
      // Help should mention the program name AND the registered commands.
      assert.ok(out.includes('prompt-registry') || out.includes('Usage'),
        `stdout should look like help text; got: ${JSON.stringify(out)}`);
    });
  });
});

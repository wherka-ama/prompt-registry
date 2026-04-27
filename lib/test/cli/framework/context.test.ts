/**
 * Phase 2 / Iter 1 — Context interface skeleton.
 *
 * TDD red phase: assert the shape of the `Context` interface and the
 * `createTestContext()` factory contract documented in spec.md §11.2 and
 * §6.5.4. No production code is exercised here — these tests pin down the
 * surface area that the rest of Phase 2 will fill in.
 *
 * Key invariants under test (spec §14.2 invariant #3 "Context-only IO"):
 *   - Every IO surface (fs, net, clock, stdin/out/err, env, cwd, exit) is
 *     reachable through the Context object — never via Node globals.
 *   - The test factory captures stdout/stderr writes so commands stay
 *     observable in unit tests without spawning subprocesses.
 *   - `exit(code)` records the requested code without terminating the
 *     process, so a single test process can run thousands of command
 *     invocations.
 *
 * Production-grade IO wiring (memfs/undici/Date.now) lands in iter 2.
 */
import * as assert from 'node:assert';
import {
  createTestContext,
} from '../../../src/cli/framework';
import type {
  Context,
} from '../../../src/cli/framework';

describe('Phase 2 / Iter 1 — Context interface skeleton', () => {
  describe('createTestContext()', () => {
    it('returns an object exposing every IO surface from spec §11.2', () => {
      const ctx: Context = createTestContext();
      assert.ok(ctx.fs, 'fs surface must be present');
      assert.ok(ctx.net, 'net surface must be present');
      assert.ok(ctx.clock, 'clock surface must be present');
      assert.ok(ctx.stdin, 'stdin stream must be present');
      assert.ok(ctx.stdout, 'stdout stream must be present');
      assert.ok(ctx.stderr, 'stderr stream must be present');
      assert.strictEqual(typeof ctx.env, 'object', 'env must be an object');
      assert.strictEqual(typeof ctx.cwd, 'function', 'cwd must be a function');
      assert.strictEqual(typeof ctx.exit, 'function', 'exit must be a function');
    });

    it('captures stdout writes for golden-test assertions', () => {
      const ctx = createTestContext();
      ctx.stdout.write('hello\n');
      ctx.stdout.write('world\n');
      assert.strictEqual(ctx.stdout.captured(), 'hello\nworld\n');
    });

    it('captures stderr writes separately from stdout', () => {
      const ctx = createTestContext();
      ctx.stdout.write('out');
      ctx.stderr.write('err');
      assert.strictEqual(ctx.stdout.captured(), 'out');
      assert.strictEqual(ctx.stderr.captured(), 'err');
    });

    it('records exit codes without terminating the process', () => {
      const ctx = createTestContext();
      ctx.exit(2);
      assert.strictEqual(ctx.exitCode(), 2);
    });

    it('defaults exit code to 0 when exit() is never called', () => {
      const ctx = createTestContext();
      assert.strictEqual(ctx.exitCode(), 0);
    });

    it('keeps the first exit code when exit() is called multiple times', () => {
      // Rationale: command code may call exit() in a finally block after a
      // domain handler already chose an exit code; we want the first
      // semantic decision to win, matching POSIX shell semantics where
      // an early exit cannot be overridden by later cleanup work.
      const ctx = createTestContext();
      ctx.exit(64);
      ctx.exit(0);
      assert.strictEqual(ctx.exitCode(), 64);
    });

    it('exposes a deterministic clock that can be advanced manually', () => {
      // Spec §11.2 requires Clock be injectable so timing-sensitive code
      // (cache TTL, retry backoff, log timestamps) is testable without
      // sleeping. The test factory must offer a fake clock.
      const ctx = createTestContext({ now: 1000 });
      assert.strictEqual(ctx.clock.now(), 1000);
      ctx.clock.advance(500);
      assert.strictEqual(ctx.clock.now(), 1500);
    });

    it('honours a frozen env map provided at construction time', () => {
      const ctx = createTestContext({ env: { FOO: 'bar' } });
      assert.strictEqual(ctx.env.FOO, 'bar');
    });

    it('returns an empty env map by default to prevent ambient leakage', () => {
      // Spec §14.2 invariant #3: command code must never read process.env
      // directly. The test factory must not silently inherit the host
      // process env, otherwise tests become non-hermetic.
      const ctx = createTestContext();
      assert.deepStrictEqual(ctx.env, {});
    });

    it('honours a cwd override for filesystem path resolution', () => {
      const ctx = createTestContext({ cwd: '/workspace/project' });
      assert.strictEqual(ctx.cwd(), '/workspace/project');
    });

    it('defaults cwd() to "/" so test runs are deterministic', () => {
      const ctx = createTestContext();
      assert.strictEqual(ctx.cwd(), '/');
    });
  });

  describe('Context type contract', () => {
    it('has stdin readable as a string for non-interactive tests', () => {
      // For Phase 2 / Iter 1 we only need stdin to be present and to
      // expose pre-seeded content for command tests. Streaming stdin
      // (interactive prompts) lands in iter 8 with the doctor stub.
      const ctx = createTestContext({ stdin: 'piped input\n' });
      assert.strictEqual(ctx.stdin.read(), 'piped input\n');
    });

    it('returns empty stdin by default', () => {
      const ctx = createTestContext();
      assert.strictEqual(ctx.stdin.read(), '');
    });
  });
});

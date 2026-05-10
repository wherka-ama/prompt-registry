import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createTestContext,
} from '../src/cli/framework';
import type {
  Context,
} from '../src/cli/framework';

describe('Context interface skeleton', () => {
  describe('createTestContext()', () => {
    it('returns an object exposing every IO surface', () => {
      const ctx: Context = createTestContext();
      expect(ctx.fs).toBeDefined();
      expect(ctx.net).toBeDefined();
      expect(ctx.clock).toBeDefined();
      expect(ctx.stdin).toBeDefined();
      expect(ctx.stdout).toBeDefined();
      expect(ctx.stderr).toBeDefined();
      expect(typeof ctx.env).toBe('object');
      expect(typeof ctx.cwd).toBe('function');
      expect(typeof ctx.exit).toBe('function');
    });

    it('captures stdout writes for golden-test assertions', () => {
      const ctx = createTestContext();
      ctx.stdout.write('hello\n');
      ctx.stdout.write('world\n');
      expect(ctx.stdout.captured()).toBe('hello\nworld\n');
    });

    it('captures stderr writes separately from stdout', () => {
      const ctx = createTestContext();
      ctx.stdout.write('out');
      ctx.stderr.write('err');
      expect(ctx.stdout.captured()).toBe('out');
      expect(ctx.stderr.captured()).toBe('err');
    });

    it('records exit codes without terminating the process', () => {
      const ctx = createTestContext();
      ctx.exit(2);
      expect(ctx.exitCode()).toBe(2);
    });

    it('defaults exit code to 0 when exit() is never called', () => {
      const ctx = createTestContext();
      expect(ctx.exitCode()).toBe(0);
    });

    it('keeps the first exit code when exit() is called multiple times', () => {
      const ctx = createTestContext();
      ctx.exit(64);
      ctx.exit(0);
      expect(ctx.exitCode()).toBe(64);
    });

    it('exposes a deterministic clock that can be advanced manually', () => {
      const ctx = createTestContext({ now: 1000 });
      expect(ctx.clock.now()).toBe(1000);
      ctx.clock.advance(500);
      expect(ctx.clock.now()).toBe(1500);
    });

    it('honours a frozen env map provided at construction time', () => {
      const ctx = createTestContext({ env: { FOO: 'bar' } });
      expect(ctx.env.FOO).toBe('bar');
    });

    it('returns an empty env map by default to prevent ambient leakage', () => {
      const ctx = createTestContext();
      expect(ctx.env).toStrictEqual({});
    });

    it('honours a cwd override for filesystem path resolution', () => {
      const ctx = createTestContext({ cwd: '/workspace/project' });
      expect(ctx.cwd()).toBe('/workspace/project');
    });

    it('defaults cwd() to "/" so test runs are deterministic', () => {
      const ctx = createTestContext();
      expect(ctx.cwd()).toBe('/');
    });
  });

  describe('Context type contract', () => {
    it('has stdin readable as a string for non-interactive tests', () => {
      const ctx = createTestContext({ stdin: 'piped input\n' });
      expect(ctx.stdin.read()).toBe('piped input\n');
    });

    it('returns empty stdin by default', () => {
      const ctx = createTestContext();
      expect(ctx.stdin.read()).toBe('');
    });
  });
});

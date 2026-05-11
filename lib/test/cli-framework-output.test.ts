import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createTestContext,
  formatOutput,
} from '../src/cli/framework';

describe('output formatter', () => {
  describe('JSON envelope (output=json)', () => {
    it('wraps data in the stable envelope shape', () => {
      const ctx = createTestContext();
      formatOutput({
        ctx,
        command: 'index.search',
        output: 'json',
        status: 'ok',
        data: { hits: 3 }
      });
      const parsed = JSON.parse(ctx.stdout.captured()) as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.command).toBe('index.search');
      expect(parsed.status).toBe('ok');
      expect(parsed.data).toStrictEqual({ hits: 3 });
      expect(parsed.warnings).toStrictEqual([]);
      expect(parsed.errors).toStrictEqual([]);
      expect(typeof parsed.meta).toBe('object');
    });

    it('includes warnings and errors when provided', () => {
      const ctx = createTestContext();
      formatOutput({
        ctx,
        command: 'bundle.install',
        output: 'json',
        status: 'warning',
        data: { installed: 1, failed: 1 },
        warnings: ['rate-limited at hub-foo'],
        errors: [{ code: 'BUNDLE.NOT_FOUND', message: 'no such bundle: bar' }]
      });
      const parsed = JSON.parse(ctx.stdout.captured()) as Record<string, unknown>;
      expect(parsed.status).toBe('warning');
      expect(parsed.warnings).toStrictEqual(['rate-limited at hub-foo']);
      expect(parsed.errors).toStrictEqual([
        { code: 'BUNDLE.NOT_FOUND', message: 'no such bundle: bar' }
      ]);
    });

    it('emits valid JSON terminated by a single newline', () => {
      const ctx = createTestContext();
      formatOutput({
        ctx,
        command: 'x',
        output: 'json',
        status: 'ok',
        data: {}
      });
      const captured = ctx.stdout.captured();
      expect(captured.endsWith('\n')).toBe(true);
      expect((captured.match(/\n/g) ?? []).length).toBe(1);
      JSON.parse(captured.trim());
    });
  });

  describe('YAML output (output=yaml)', () => {
    it('emits the same envelope as YAML', () => {
      const ctx = createTestContext();
      formatOutput({
        ctx,
        command: 'index.search',
        output: 'yaml',
        status: 'ok',
        data: { hits: 3 }
      });
      const out = ctx.stdout.captured();
      expect(out.includes('schemaVersion: 1')).toBe(true);
      expect(out.includes('command: index.search')).toBe(true);
      expect(out.includes('status: ok')).toBe(true);
      expect(out.includes('hits: 3')).toBe(true);
    });
  });

  describe('NDJSON output (output=ndjson)', () => {
    it('emits each item in `data` (when an array) as its own JSON line', () => {
      const ctx = createTestContext();
      formatOutput({
        ctx,
        command: 'bundle.list',
        output: 'ndjson',
        status: 'ok',
        data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
      });
      const lines = ctx.stdout.captured().trimEnd().split('\n');
      expect(lines.length).toBe(3);
      expect(JSON.parse(lines[0])).toStrictEqual({ id: 'a' });
      expect(JSON.parse(lines[1])).toStrictEqual({ id: 'b' });
      expect(JSON.parse(lines[2])).toStrictEqual({ id: 'c' });
    });

    it('emits a single line for non-array data', () => {
      const ctx = createTestContext();
      formatOutput({
        ctx,
        command: 'doctor',
        output: 'ndjson',
        status: 'ok',
        data: { ok: true }
      });
      const out = ctx.stdout.captured().trimEnd();
      expect(JSON.parse(out)).toStrictEqual({ ok: true });
    });
  });

  describe('Text output (output=text)', () => {
    it('uses the supplied textRenderer', () => {
      const ctx = createTestContext();
      formatOutput({
        ctx,
        command: 'index.search',
        output: 'text',
        status: 'ok',
        data: { hits: 3 },
        textRenderer: (d: { hits: number }) => `Found ${d.hits} matches.\n`
      });
      expect(ctx.stdout.captured()).toBe('Found 3 matches.\n');
    });

    it('falls back to a JSON-serialized representation when no textRenderer is provided', () => {
      const ctx = createTestContext();
      formatOutput({
        ctx,
        command: 'x',
        output: 'text',
        status: 'ok',
        data: { a: 1 }
      });
      const out = ctx.stdout.captured().trim();
      expect(JSON.parse(out)).toStrictEqual({ a: 1 });
    });
  });

  describe('warnings routing', () => {
    it('writes warnings to stderr in text mode (so stdout stays parseable)', () => {
      const ctx = createTestContext();
      formatOutput({
        ctx,
        command: 'x',
        output: 'text',
        status: 'ok',
        data: 'ok',
        warnings: ['cache miss', 'using fallback hub'],
        textRenderer: (d: string) => `${d}\n`
      });
      expect(ctx.stdout.captured()).toBe('ok\n');
      const stderr = ctx.stderr.captured();
      expect(stderr.includes('cache miss')).toBe(true);
      expect(stderr.includes('using fallback hub')).toBe(true);
    });

    it('keeps warnings in the envelope (NOT on stderr) in json mode', () => {
      const ctx = createTestContext();
      formatOutput({
        ctx,
        command: 'x',
        output: 'json',
        status: 'ok',
        data: 'ok',
        warnings: ['heads up']
      });
      expect(ctx.stderr.captured()).toBe('');
      const parsed = JSON.parse(ctx.stdout.captured()) as { warnings: string[] };
      expect(parsed.warnings).toStrictEqual(['heads up']);
    });
  });

  describe('quiet mode', () => {
    it('suppresses stdout in text mode when quiet=true', () => {
      const ctx = createTestContext();
      formatOutput({
        ctx,
        command: 'x',
        output: 'text',
        status: 'ok',
        data: 'ok',
        quiet: true,
        textRenderer: (d: string) => `${d}\n`
      });
      expect(ctx.stdout.captured()).toBe('');
    });

    it('does NOT suppress json output even when quiet=true (machine consumers need the envelope)', () => {
      const ctx = createTestContext();
      formatOutput({
        ctx,
        command: 'x',
        output: 'json',
        status: 'ok',
        data: 'ok',
        quiet: true
      });
      expect(ctx.stdout.captured().length).toBeGreaterThan(0);
    });
  });
});

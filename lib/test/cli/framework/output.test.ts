/**
 * Phase 2 / Iter 5 — Output formatter.
 *
 * Spec §11.4 / decision D4: unified `-o, --output {text,json,yaml,ndjson}`
 * (markdown and table land in a later iter alongside their domain-
 * specific renderers). When `output=json` the payload uses the stable
 * envelope:
 *
 *   {
 *     "schemaVersion": 1,
 *     "command": "<dotted.path>",
 *     "status": "ok" | "error" | "warning",
 *     "data": <command-specific payload>,
 *     "warnings": [<string>...],
 *     "errors":   [<RegistryError JSON>...],
 *     "meta": { "durationMs": <number>, ... }
 *   }
 *
 * `formatOutput` is the single sink. Leaf commands compute `data`
 * (and optional `warnings`/`errors`/`meta`) and call once; the
 * formatter handles serialization and stdout writing.
 */
import * as assert from 'node:assert';
import {
  createTestContext,
  formatOutput,
} from '../../../src/cli/framework';

describe('Phase 2 / Iter 5 — output formatter', () => {
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
      assert.strictEqual(parsed.schemaVersion, 1);
      assert.strictEqual(parsed.command, 'index.search');
      assert.strictEqual(parsed.status, 'ok');
      assert.deepStrictEqual(parsed.data, { hits: 3 });
      assert.deepStrictEqual(parsed.warnings, []);
      assert.deepStrictEqual(parsed.errors, []);
      assert.strictEqual(typeof parsed.meta, 'object');
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
      assert.strictEqual(parsed.status, 'warning');
      assert.deepStrictEqual(parsed.warnings, ['rate-limited at hub-foo']);
      assert.deepStrictEqual(
        parsed.errors,
        [{ code: 'BUNDLE.NOT_FOUND', message: 'no such bundle: bar' }]
      );
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
      assert.ok(captured.endsWith('\n'), 'JSON output must end with a newline');
      assert.strictEqual((captured.match(/\n/g) ?? []).length, 1,
        'JSON envelope is a single line plus trailing newline');
      // Must round-trip.
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
      assert.ok(out.includes('schemaVersion: 1'), `expected schemaVersion in YAML output; got ${out}`);
      assert.ok(out.includes('command: index.search'));
      assert.ok(out.includes('status: ok'));
      assert.ok(out.includes('hits: 3'));
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
      assert.strictEqual(lines.length, 3);
      assert.deepStrictEqual(JSON.parse(lines[0]), { id: 'a' });
      assert.deepStrictEqual(JSON.parse(lines[1]), { id: 'b' });
      assert.deepStrictEqual(JSON.parse(lines[2]), { id: 'c' });
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
      assert.deepStrictEqual(JSON.parse(out), { ok: true });
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
      assert.strictEqual(ctx.stdout.captured(), 'Found 3 matches.\n');
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
      // Fallback need not be pretty; just be deterministic and contain
      // the data. We assert that it parses back to the same value.
      const out = ctx.stdout.captured().trim();
      assert.deepStrictEqual(JSON.parse(out), { a: 1 });
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
      assert.strictEqual(ctx.stdout.captured(), 'ok\n');
      const stderr = ctx.stderr.captured();
      assert.ok(stderr.includes('cache miss'));
      assert.ok(stderr.includes('using fallback hub'));
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
      assert.strictEqual(ctx.stderr.captured(), '');
      const parsed = JSON.parse(ctx.stdout.captured()) as { warnings: string[] };
      assert.deepStrictEqual(parsed.warnings, ['heads up']);
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
      assert.strictEqual(ctx.stdout.captured(), '');
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
      assert.ok(ctx.stdout.captured().length > 0);
    });
  });
});

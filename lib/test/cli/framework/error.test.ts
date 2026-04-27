/**
 * Phase 2 / Iter 6 — RegistryError + renderError.
 *
 * Spec §10 / decision D5: domain errors carry `{ code, message, hint?,
 * docsUrl?, cause?, context? }`. Code is dotted UPPER_SNAKE and must
 * follow one of the 11 namespaces locked iter 23 (BUNDLE.*, INDEX.*,
 * HUB.*, PRIMITIVE.*, CONFIG.*, NETWORK.*, AUTH.*, FS.*, PLUGIN.*,
 * USAGE.*, INTERNAL.*).
 *
 * `renderError(err, ctx, opts?)` writes a human-readable rendering to
 * stderr (text mode); commands that want the JSON envelope route the
 * error through `formatOutput({ status: 'error', errors: [err.toJSON()] })`
 * which iter 5 already supports.
 */
import * as assert from 'node:assert';
import {
  createTestContext,
  isRegistryError,
  RegistryError,
  renderError,
} from '../../../src/cli/framework';

describe('Phase 2 / Iter 6 — RegistryError + renderer', () => {
  describe('RegistryError construction', () => {
    it('exposes code, message, and optional fields', () => {
      const err = new RegistryError({
        code: 'BUNDLE.NOT_FOUND',
        message: 'no such bundle: foo',
        hint: 'Try `prompt-registry bundle list` to see available bundles.',
        docsUrl: 'https://example.com/docs/bundles',
        context: { requested: 'foo' }
      });
      assert.strictEqual(err.code, 'BUNDLE.NOT_FOUND');
      assert.strictEqual(err.message, 'no such bundle: foo');
      assert.strictEqual(err.hint, 'Try `prompt-registry bundle list` to see available bundles.');
      assert.strictEqual(err.docsUrl, 'https://example.com/docs/bundles');
      assert.deepStrictEqual(err.context, { requested: 'foo' });
    });

    it('is an instance of Error and has its name set to RegistryError', () => {
      const err = new RegistryError({ code: 'USAGE.MISSING_FLAG', message: 'x' });
      assert.ok(err instanceof Error);
      assert.strictEqual(err.name, 'RegistryError');
    });

    it('preserves the cause chain when one is provided', () => {
      const root = new TypeError('underlying typing fault');
      const err = new RegistryError({
        code: 'INTERNAL.UNEXPECTED',
        message: 'parser blew up',
        cause: root
      });
      assert.strictEqual(err.cause, root);
    });

    it('rejects malformed codes (non-namespaced or wrong case)', () => {
      assert.throws(() => new RegistryError({ code: 'no_namespace', message: 'x' }), /code/);
      assert.throws(() => new RegistryError({ code: 'BUNDLE.lowercase', message: 'x' }), /code/);
      // All-uppercase but not one of the 11 documented namespaces:
      assert.throws(() => new RegistryError({ code: 'XYZZY.SECTION', message: 'x' }), /namespace/);
    });

    it('accepts every documented namespace', () => {
      const namespaces = [
        'BUNDLE', 'INDEX', 'HUB', 'PRIMITIVE',
        'CONFIG', 'NETWORK', 'AUTH', 'FS',
        'PLUGIN', 'USAGE', 'INTERNAL'
      ];
      for (const ns of namespaces) {
        const e = new RegistryError({ code: `${ns}.SOMETHING`, message: 'x' });
        assert.strictEqual(e.code, `${ns}.SOMETHING`);
      }
    });
  });

  describe('toJSON', () => {
    it('serializes to the OutputError shape iter-5 expects', () => {
      const err = new RegistryError({
        code: 'NETWORK.TIMEOUT',
        message: 'request timed out',
        hint: 'Increase --timeout or check connectivity.',
        docsUrl: 'https://example.com/docs/timeouts',
        context: { url: 'https://x' }
      });
      assert.deepStrictEqual(err.toJSON(), {
        code: 'NETWORK.TIMEOUT',
        message: 'request timed out',
        hint: 'Increase --timeout or check connectivity.',
        docsUrl: 'https://example.com/docs/timeouts',
        context: { url: 'https://x' }
      });
    });

    it('omits absent optional fields from the JSON output', () => {
      const err = new RegistryError({ code: 'USAGE.MISSING_FLAG', message: 'x' });
      const json = err.toJSON();
      assert.strictEqual(json.code, 'USAGE.MISSING_FLAG');
      assert.strictEqual(json.message, 'x');
      assert.strictEqual('hint' in json, false);
      assert.strictEqual('docsUrl' in json, false);
      assert.strictEqual('context' in json, false);
    });
  });

  describe('isRegistryError type guard', () => {
    it('returns true for RegistryError instances', () => {
      assert.strictEqual(
        isRegistryError(new RegistryError({ code: 'USAGE.X', message: 'x' })),
        true
      );
    });

    it('returns false for vanilla Errors and non-Errors', () => {
      assert.strictEqual(isRegistryError(new Error('plain')), false);
      assert.strictEqual(isRegistryError('a string'), false);
      assert.strictEqual(isRegistryError(null), false);
      assert.strictEqual(isRegistryError(undefined), false);
      assert.strictEqual(isRegistryError({ code: 'BUNDLE.X', message: 'duck' }), false);
    });
  });

  describe('renderError (text mode)', () => {
    it('writes code and message to stderr', () => {
      const ctx = createTestContext();
      renderError(new RegistryError({
        code: 'BUNDLE.NOT_FOUND',
        message: 'no such bundle: foo'
      }), ctx);
      const out = ctx.stderr.captured();
      assert.ok(out.includes('BUNDLE.NOT_FOUND'), `stderr must include code; got: ${out}`);
      assert.ok(out.includes('no such bundle: foo'));
    });

    it('appends the hint on its own line when present', () => {
      const ctx = createTestContext();
      renderError(new RegistryError({
        code: 'CONFIG.INVALID',
        message: 'unknown key `outpot`',
        hint: 'Did you mean `output`?'
      }), ctx);
      const out = ctx.stderr.captured();
      assert.ok(out.includes('Did you mean `output`?'));
    });

    it('appends docsUrl when present', () => {
      const ctx = createTestContext();
      renderError(new RegistryError({
        code: 'NETWORK.TIMEOUT',
        message: 'timed out',
        docsUrl: 'https://example.com/docs/timeouts'
      }), ctx);
      const out = ctx.stderr.captured();
      assert.ok(out.includes('https://example.com/docs/timeouts'));
    });

    it('renders a non-RegistryError as INTERNAL.UNEXPECTED', () => {
      const ctx = createTestContext();
      renderError(new Error('kaboom'), ctx);
      const out = ctx.stderr.captured();
      assert.ok(out.includes('INTERNAL.UNEXPECTED'));
      assert.ok(out.includes('kaboom'));
    });
  });
});

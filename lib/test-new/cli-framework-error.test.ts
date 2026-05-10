import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createTestContext,
  isRegistryError,
  RegistryError,
  renderError,
} from '../src/cli/framework';

describe('RegistryError + renderer', () => {
  describe('RegistryError construction', () => {
    it('exposes code, message, and optional fields', () => {
      const err = new RegistryError({
        code: 'BUNDLE.NOT_FOUND',
        message: 'no such bundle: foo',
        hint: 'Try `prompt-registry bundle list` to see available bundles.',
        docsUrl: 'https://example.com/docs/bundles',
        context: { requested: 'foo' }
      });
      expect(err.code).toBe('BUNDLE.NOT_FOUND');
      expect(err.message).toBe('no such bundle: foo');
      expect(err.hint).toBe('Try `prompt-registry bundle list` to see available bundles.');
      expect(err.docsUrl).toBe('https://example.com/docs/bundles');
      expect(err.context).toStrictEqual({ requested: 'foo' });
    });

    it('is an instance of Error and has its name set to RegistryError', () => {
      const err = new RegistryError({ code: 'USAGE.MISSING_FLAG', message: 'x' });
      expect(err instanceof Error).toBe(true);
      expect(err.name).toBe('RegistryError');
    });

    it('preserves the cause chain when one is provided', () => {
      const root = new TypeError('underlying typing fault');
      const err = new RegistryError({
        code: 'INTERNAL.UNEXPECTED',
        message: 'parser blew up',
        cause: root
      });
      expect(err.cause).toBe(root);
    });

    it('rejects malformed codes (non-namespaced or wrong case)', () => {
      expect(() => new RegistryError({ code: 'no_namespace', message: 'x' })).toThrow(/code/);
      expect(() => new RegistryError({ code: 'BUNDLE.lowercase', message: 'x' })).toThrow(/code/);
      expect(() => new RegistryError({ code: 'XYZZY.SECTION', message: 'x' })).toThrow(/namespace/);
    });

    it('accepts every documented namespace', () => {
      const namespaces = [
        'BUNDLE', 'INDEX', 'HUB', 'PRIMITIVE',
        'CONFIG', 'NETWORK', 'AUTH', 'FS',
        'PLUGIN', 'USAGE', 'INTERNAL'
      ];
      for (const ns of namespaces) {
        const e = new RegistryError({ code: `${ns}.SOMETHING`, message: 'x' });
        expect(e.code).toBe(`${ns}.SOMETHING`);
      }
    });
  });

  describe('toJSON', () => {
    it('serializes to the OutputError shape', () => {
      const err = new RegistryError({
        code: 'NETWORK.TIMEOUT',
        message: 'request timed out',
        hint: 'Increase --timeout or check connectivity.',
        docsUrl: 'https://example.com/docs/timeouts',
        context: { url: 'https://x' }
      });
      expect(err.toJSON()).toStrictEqual({
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
      expect(json.code).toBe('USAGE.MISSING_FLAG');
      expect(json.message).toBe('x');
      expect('hint' in json).toBe(false);
      expect('docsUrl' in json).toBe(false);
      expect('context' in json).toBe(false);
    });
  });

  describe('isRegistryError type guard', () => {
    it('returns true for RegistryError instances', () => {
      expect(
        isRegistryError(new RegistryError({ code: 'USAGE.X', message: 'x' }))
      ).toBe(true);
    });

    it('returns false for vanilla Errors and non-Errors', () => {
      expect(isRegistryError(new Error('plain'))).toBe(false);
      expect(isRegistryError('a string')).toBe(false);
      expect(isRegistryError(null)).toBe(false);
      expect(isRegistryError(undefined)).toBe(false);
      expect(isRegistryError({ code: 'BUNDLE.X', message: 'duck' })).toBe(false);
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
      expect(out.includes('BUNDLE.NOT_FOUND')).toBe(true);
      expect(out.includes('no such bundle: foo')).toBe(true);
    });

    it('appends the hint on its own line when present', () => {
      const ctx = createTestContext();
      renderError(new RegistryError({
        code: 'CONFIG.INVALID',
        message: 'unknown key `outpot`',
        hint: 'Did you mean `output`?'
      }), ctx);
      const out = ctx.stderr.captured();
      expect(out.includes('Did you mean `output`?')).toBe(true);
    });

    it('appends docsUrl when present', () => {
      const ctx = createTestContext();
      renderError(new RegistryError({
        code: 'NETWORK.TIMEOUT',
        message: 'timed out',
        docsUrl: 'https://example.com/docs/timeouts'
      }), ctx);
      const out = ctx.stderr.captured();
      expect(out.includes('https://example.com/docs/timeouts')).toBe(true);
    });

    it('renders a non-RegistryError as INTERNAL.UNEXPECTED', () => {
      const ctx = createTestContext();
      renderError(new Error('kaboom'), ctx);
      const out = ctx.stderr.captured();
      expect(out.includes('INTERNAL.UNEXPECTED')).toBe(true);
      expect(out.includes('kaboom')).toBe(true);
    });
  });
});

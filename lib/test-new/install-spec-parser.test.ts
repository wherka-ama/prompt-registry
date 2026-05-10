import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  BundleSpecParseError,
  parseBundleSpec,
} from '../src/install/spec-parser';

describe('parseBundleSpec', () => {
  it('parses a bare bundle id', () => {
    const spec = parseBundleSpec('tdd-helper');
    expect(spec).toStrictEqual({ bundleId: 'tdd-helper' });
  });

  it('parses sourceId:bundleId', () => {
    const spec = parseBundleSpec('owner/repo:tdd-helper');
    expect(spec).toStrictEqual({
      sourceId: 'owner/repo',
      bundleId: 'tdd-helper'
    });
  });

  it('parses sourceId:bundleId@version', () => {
    const spec = parseBundleSpec('owner/repo:tdd-helper@1.2.3');
    expect(spec).toStrictEqual({
      sourceId: 'owner/repo',
      bundleId: 'tdd-helper',
      bundleVersion: '1.2.3'
    });
  });

  it('parses bundleId@latest', () => {
    const spec = parseBundleSpec('foo@latest');
    expect(spec).toStrictEqual({
      bundleId: 'foo',
      bundleVersion: 'latest'
    });
  });

  it('accepts a sub-pathed sourceId', () => {
    const spec = parseBundleSpec('owner/repo/sub:foo');
    expect(spec.sourceId).toBe('owner/repo/sub');
    expect(spec.bundleId).toBe('foo');
  });

  it('rejects empty input', () => {
    expect(() => parseBundleSpec('')).toThrow(BundleSpecParseError);
    expect(() => parseBundleSpec('   ')).toThrow(BundleSpecParseError);
  });

  it('rejects malformed @version', () => {
    expect(() => parseBundleSpec('@1.2.3')).toThrow(/malformed @version/);
    expect(() => parseBundleSpec('foo@')).toThrow(/malformed @version/);
  });

  it('rejects malformed sourceId:bundleId', () => {
    expect(() => parseBundleSpec(':foo')).toThrow(/malformed sourceId/);
    expect(() => parseBundleSpec('owner/repo:')).toThrow(/malformed sourceId/);
  });

  it('rejects bundleId outside kebab-case alphabet', () => {
    expect(() => parseBundleSpec('FooBar')).toThrow(/must match/);
    expect(() => parseBundleSpec('foo_bar')).toThrow(/must match/);
    expect(() => parseBundleSpec('-leading-dash')).toThrow(/must match/);
  });

  it('treats trailing whitespace as part of trim, not the bundleId', () => {
    const spec = parseBundleSpec('  foo-bar  ');
    expect(spec).toStrictEqual({ bundleId: 'foo-bar' });
  });

  it('rejects multiple @ versions', () => {
    expect(() => parseBundleSpec('foo@bar@1.0.0')).toThrow(/must match/);
  });

  it('preserves the raw input on the thrown error', () => {
    try {
      parseBundleSpec('FooBar');
      expect.fail('expected throw');
    } catch (err) {
      expect(err instanceof BundleSpecParseError).toBe(true);
      expect((err as BundleSpecParseError).raw).toBe('FooBar');
    }
  });
});

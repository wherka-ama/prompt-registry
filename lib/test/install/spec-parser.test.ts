/**
 * Phase 5 / Iter 10 — BundleSpec parser unit tests.
 */
import * as assert from 'node:assert';
import {
  BundleSpecParseError,
  parseBundleSpec,
} from '../../src/install/spec-parser';

describe('Phase 5 / Iter 10 — parseBundleSpec', () => {
  it('parses a bare bundle id', () => {
    const spec = parseBundleSpec('tdd-helper');
    assert.deepStrictEqual(spec, { bundleId: 'tdd-helper' });
  });

  it('parses sourceId:bundleId', () => {
    const spec = parseBundleSpec('owner/repo:tdd-helper');
    assert.deepStrictEqual(spec, {
      sourceId: 'owner/repo',
      bundleId: 'tdd-helper'
    });
  });

  it('parses sourceId:bundleId@version', () => {
    const spec = parseBundleSpec('owner/repo:tdd-helper@1.2.3');
    assert.deepStrictEqual(spec, {
      sourceId: 'owner/repo',
      bundleId: 'tdd-helper',
      bundleVersion: '1.2.3'
    });
  });

  it('parses bundleId@latest', () => {
    const spec = parseBundleSpec('foo@latest');
    assert.deepStrictEqual(spec, {
      bundleId: 'foo',
      bundleVersion: 'latest'
    });
  });

  it('accepts a sub-pathed sourceId', () => {
    const spec = parseBundleSpec('owner/repo/sub:foo');
    assert.strictEqual(spec.sourceId, 'owner/repo/sub');
    assert.strictEqual(spec.bundleId, 'foo');
  });

  it('rejects empty input', () => {
    assert.throws(() => parseBundleSpec(''), BundleSpecParseError);
    assert.throws(() => parseBundleSpec('   '), BundleSpecParseError);
  });

  it('rejects malformed @version', () => {
    assert.throws(() => parseBundleSpec('@1.2.3'), /malformed @version/);
    assert.throws(() => parseBundleSpec('foo@'), /malformed @version/);
  });

  it('rejects malformed sourceId:bundleId', () => {
    assert.throws(() => parseBundleSpec(':foo'), /malformed sourceId/);
    assert.throws(() => parseBundleSpec('owner/repo:'), /malformed sourceId/);
  });

  it('rejects bundleId outside kebab-case alphabet', () => {
    assert.throws(() => parseBundleSpec('FooBar'), /must match/);
    assert.throws(() => parseBundleSpec('foo_bar'), /must match/);
    assert.throws(() => parseBundleSpec('-leading-dash'), /must match/);
  });

  it('treats trailing whitespace as part of trim, not the bundleId', () => {
    const spec = parseBundleSpec('  foo-bar  ');
    assert.deepStrictEqual(spec, { bundleId: 'foo-bar' });
  });

  it('rejects multiple @ versions', () => {
    // The lastIndexOf('@') strategy means the rightmost @ wins;
    // bundleId then contains a stray @ which fails the alphabet check.
    assert.throws(() => parseBundleSpec('foo@bar@1.0.0'), /must match/);
  });

  it('preserves the raw input on the thrown error', () => {
    try {
      parseBundleSpec('FooBar');
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof BundleSpecParseError);
      assert.strictEqual((err).raw, 'FooBar');
    }
  });
});

/**
 * Phase 6 / Iter 17 — Profile + ProfileBundle type guards.
 */
import * as assert from 'node:assert';
import {
  isProfile,
  isProfileBundle,
} from '../../../src/domain/registry/profile';

describe('Phase 6 / iter 17 - profile domain', () => {
  describe('isProfileBundle', () => {
    it('accepts a complete bundle ref', () => {
      assert.ok(isProfileBundle({
        id: 'foo', version: '1.0.0', source: 'github-abc', required: true
      }));
    });
    it('rejects missing required fields', () => {
      assert.strictEqual(isProfileBundle({ id: 'foo', version: '1.0.0', source: 'x' }), false);
      assert.strictEqual(isProfileBundle({ id: 'foo', source: 'x', required: false }), false);
    });
    it('rejects empty strings', () => {
      assert.strictEqual(isProfileBundle({
        id: '', version: '1.0.0', source: 'x', required: false
      }), false);
    });
  });

  describe('isProfile', () => {
    it('accepts a profile with zero bundles', () => {
      assert.ok(isProfile({ id: 'p', name: 'P', bundles: [] }));
    });
    it('accepts a profile with valid bundles', () => {
      assert.ok(isProfile({
        id: 'backend',
        name: 'Backend Developer',
        bundles: [
          { id: 'foo', version: '1.0.0', source: 'github-abc', required: true },
          { id: 'bar', version: 'latest', source: 'github-def', required: false }
        ]
      }));
    });
    it('rejects on a bad nested bundle', () => {
      assert.strictEqual(isProfile({
        id: 'p', name: 'P',
        bundles: [{ id: 'foo' }]
      }), false);
    });
    it('rejects empty id/name', () => {
      assert.strictEqual(isProfile({ id: '', name: 'P', bundles: [] }), false);
      assert.strictEqual(isProfile({ id: 'p', name: '', bundles: [] }), false);
    });
  });
});

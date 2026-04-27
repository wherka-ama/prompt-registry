/**
 * Phase 6 / Iter 16 — HubConfig + HubReference + sanitizeHubId tests.
 */
import * as assert from 'node:assert';
import {
  DEFAULT_LOCAL_HUB_ID,
  isHubConfig,
  isHubReference,
  sanitizeHubId,
} from '../../../src/domain/registry/hub-config';

describe('Phase 6 / iter 16 - hub-config domain', () => {
  describe('sanitizeHubId', () => {
    it('lowercases and replaces non-alnum with single dash', () => {
      assert.strictEqual(sanitizeHubId('My_Hub Name!'), 'my-hub-name');
    });
    it('strips leading/trailing dashes', () => {
      assert.strictEqual(sanitizeHubId('---abc---'), 'abc');
    });
    it('throws on empty-after-sanitize', () => {
      assert.throws(() => sanitizeHubId('!!!'), /empty after sanitization/);
    });
    it('throws on >64 chars', () => {
      assert.throws(() => sanitizeHubId('a'.repeat(65)), />64 chars/);
    });
  });

  describe('DEFAULT_LOCAL_HUB_ID', () => {
    it('is the literal "default-local"', () => {
      assert.strictEqual(DEFAULT_LOCAL_HUB_ID, 'default-local');
    });
    it('survives sanitizeHubId round-trip', () => {
      assert.strictEqual(sanitizeHubId(DEFAULT_LOCAL_HUB_ID), DEFAULT_LOCAL_HUB_ID);
    });
  });

  describe('isHubReference', () => {
    it('accepts the three reserved types', () => {
      for (const type of ['github', 'local', 'url'] as const) {
        assert.ok(isHubReference({ type, location: 'x' }), `expected to accept ${type}`);
      }
    });
    it('rejects unknown type', () => {
      assert.strictEqual(isHubReference({ type: 'ftp', location: 'x' }), false);
    });
    it('rejects empty location', () => {
      assert.strictEqual(isHubReference({ type: 'github', location: '' }), false);
    });
    it('rejects non-objects', () => {
      assert.strictEqual(isHubReference(null), false);
      assert.strictEqual(isHubReference('github://x'), false);
    });
  });

  describe('isHubConfig', () => {
    const minimal = {
      version: '1.0.0',
      metadata: { name: 'h', description: 'd', maintainer: 'm', updatedAt: 'now' },
      sources: [],
      profiles: []
    };
    it('accepts a minimal valid config', () => {
      assert.ok(isHubConfig(minimal));
    });
    it('rejects missing arrays', () => {
      assert.strictEqual(isHubConfig({ ...minimal, sources: undefined }), false);
      assert.strictEqual(isHubConfig({ ...minimal, profiles: 'oops' }), false);
    });
    it('rejects missing version/metadata', () => {
      assert.strictEqual(isHubConfig({ ...minimal, version: 1 }), false);
      assert.strictEqual(isHubConfig({ ...minimal, metadata: null }), false);
    });
  });
});

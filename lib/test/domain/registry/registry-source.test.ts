/**
 * Phase 6 / Iter 18 — RegistrySource type guard.
 */
import * as assert from 'node:assert';
import {
  isRegistrySource,
} from '../../../src/domain/registry/registry-source';

describe('Phase 6 / iter 18 - registry-source domain', () => {
  it('accepts a complete github source', () => {
    assert.ok(isRegistrySource({
      id: 'github-abc',
      name: 'My Repo',
      type: 'github',
      url: 'owner/repo',
      enabled: true,
      priority: 0,
      hubId: 'my-hub'
    }));
  });

  it('rejects missing required fields', () => {
    const base = {
      id: 'github-abc', name: 'x', type: 'github',
      url: 'owner/repo', enabled: true, priority: 0, hubId: 'h'
    };
    for (const k of ['id', 'name', 'type', 'url', 'hubId'] as const) {
      const broken = { ...base, [k]: undefined };
      assert.strictEqual(isRegistrySource(broken), false, `should reject missing ${k}`);
    }
  });

  it('rejects empty hubId', () => {
    assert.strictEqual(isRegistrySource({
      id: 'x', name: 'x', type: 'github', url: 'x',
      enabled: true, priority: 0, hubId: ''
    }), false);
  });

  it('rejects wrong types on numeric fields', () => {
    assert.strictEqual(isRegistrySource({
      id: 'x', name: 'x', type: 'github', url: 'x',
      enabled: true, priority: '0', hubId: 'h'
    }), false);
  });
});

/**
 * Phase 5 / Iter 11 — BundleResolver tests.
 */
import * as assert from 'node:assert';
import type {
  Installable,
} from '../../src/domain/install';
import {
  MapBundleResolver,
} from '../../src/install/resolver';

const mk = (sourceId: string, bundleId: string, v: string): Installable => ({
  ref: {
    sourceId,
    sourceType: 'github',
    bundleId,
    bundleVersion: v,
    installed: false
  },
  downloadUrl: `https://example.com/${sourceId}/${bundleId}/${v}.zip`
});

describe('Phase 5 / Iter 11 — MapBundleResolver', () => {
  it('returns null on miss', async () => {
    const r = new MapBundleResolver({});
    assert.strictEqual(await r.resolve({ bundleId: 'x' }), null);
  });

  it('returns the latest entry by default', async () => {
    const r = new MapBundleResolver({
      'owner/repo:foo': [
        mk('owner/repo', 'foo', '1.0.0'),
        mk('owner/repo', 'foo', '1.1.0')
      ]
    });
    const got = await r.resolve({ sourceId: 'owner/repo', bundleId: 'foo' });
    assert.strictEqual(got?.ref.bundleVersion, '1.1.0');
  });

  it('resolves an exact version request', async () => {
    const r = new MapBundleResolver({
      'owner/repo:foo': [
        mk('owner/repo', 'foo', '1.0.0'),
        mk('owner/repo', 'foo', '1.1.0')
      ]
    });
    const got = await r.resolve({
      sourceId: 'owner/repo',
      bundleId: 'foo',
      bundleVersion: '1.0.0'
    });
    assert.strictEqual(got?.ref.bundleVersion, '1.0.0');
  });

  it('returns null when an exact version is missing', async () => {
    const r = new MapBundleResolver({
      'owner/repo:foo': [mk('owner/repo', 'foo', '1.0.0')]
    });
    assert.strictEqual(await r.resolve({
      sourceId: 'owner/repo',
      bundleId: 'foo',
      bundleVersion: '9.9.9'
    }), null);
  });

  it('resolves a bare bundleId (no sourceId)', async () => {
    const r = new MapBundleResolver({
      foo: [mk('local', 'foo', '0.1.0')]
    });
    const got = await r.resolve({ bundleId: 'foo' });
    assert.strictEqual(got?.ref.bundleId, 'foo');
  });
});

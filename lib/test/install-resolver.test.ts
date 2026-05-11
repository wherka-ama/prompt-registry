import {
  describe,
  expect,
  it,
} from 'vitest';
import type {
  Installable,
} from '../src/domain/install';
import {
  MapBundleResolver,
} from './helpers/install-test-helpers';

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

describe('MapBundleResolver', () => {
  it('returns null on miss', async () => {
    const r = new MapBundleResolver({});
    expect(await r.resolve({ bundleId: 'x' })).toBeNull();
  });

  it('returns the latest entry by default', async () => {
    const r = new MapBundleResolver({
      'owner/repo:foo': [
        mk('owner/repo', 'foo', '1.0.0'),
        mk('owner/repo', 'foo', '1.1.0')
      ]
    });
    const got = await r.resolve({ sourceId: 'owner/repo', bundleId: 'foo' });
    expect(got?.ref.bundleVersion).toBe('1.1.0');
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
    expect(got?.ref.bundleVersion).toBe('1.0.0');
  });

  it('returns null when an exact version is missing', async () => {
    const r = new MapBundleResolver({
      'owner/repo:foo': [mk('owner/repo', 'foo', '1.0.0')]
    });
    expect(await r.resolve({
      sourceId: 'owner/repo',
      bundleId: 'foo',
      bundleVersion: '9.9.9'
    })).toBeNull();
  });

  it('resolves a bare bundleId (no sourceId)', async () => {
    const r = new MapBundleResolver({
      foo: [mk('local', 'foo', '0.1.0')]
    });
    const got = await r.resolve({ bundleId: 'foo' });
    expect(got?.ref.bundleId).toBe('foo');
  });
});

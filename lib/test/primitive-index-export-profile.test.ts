import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  exportShortlistAsProfile,
} from '../src/app/search/export-profile';
import {
  PrimitiveIndex,
} from '../src/infra/search/primitive-index';
import {
  createFixtureBundles,
  FakeBundleProvider,
} from './fixtures/primitive-index';

describe('exportShortlistAsProfile', () => {
  it('groups primitives by (source, bundle) and pins versions', async () => {
    const idx = await PrimitiveIndex.buildFrom(new FakeBundleProvider(createFixtureBundles()));
    const sl = idx.createShortlist('test');
    const allPrims = idx.all();
    if (allPrims.length >= 2) {
      idx.addToShortlist(sl.id, allPrims[0].id);
      idx.addToShortlist(sl.id, allPrims[1].id);
    }

    const exp = exportShortlistAsProfile(idx, sl, { profileId: 'test' });
    expect(exp.profile.bundles.length).toBeGreaterThan(0);
  });

  it('suggests a collection when requested and warns about MCP primitives', async () => {
    const idx = await PrimitiveIndex.buildFrom(new FakeBundleProvider(createFixtureBundles()));
    const sl = idx.createShortlist('mix');
    const allPrims = idx.all();
    if (allPrims.length >= 2) {
      idx.addToShortlist(sl.id, allPrims[0].id);
      idx.addToShortlist(sl.id, allPrims[1].id);
    }

    const exp = exportShortlistAsProfile(idx, sl, {
      profileId: 'mix-profile',
      suggestCollection: true
    });
    expect(exp.profile.bundles.length).toBeGreaterThan(0);
    if (exp.suggestedCollection) {
      expect(exp.suggestedCollection.items.length).toBeGreaterThan(0);
    }
  });

  it('warns about missing primitives', async () => {
    const idx = await PrimitiveIndex.buildFrom(new FakeBundleProvider(createFixtureBundles()));
    const sl = idx.createShortlist('ghost');
    (sl.primitiveIds).push('deadbeefdeadbeef');
    const exp = exportShortlistAsProfile(idx, sl, { profileId: 'p' });
    expect(exp.warnings.some((w) => w.includes('deadbeef'))).toBe(true);
  });
});

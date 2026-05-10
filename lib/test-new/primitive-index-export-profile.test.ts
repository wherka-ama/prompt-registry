import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  exportShortlistAsProfile,
} from '../src/primitive-index/export-profile';
import {
  PrimitiveIndex,
} from '../src/primitive-index/index';
import {
  createFixtureBundles,
  FakeBundleProvider,
} from '../test/primitive-index/fixtures';

describe('exportShortlistAsProfile', () => {
  it('groups primitives by (source, bundle) and pins versions', async () => {
    const idx = await PrimitiveIndex.buildFrom(new FakeBundleProvider(createFixtureBundles()));
    const sl = idx.createShortlist('rust+review');
    const rustPrim = idx.all().find((p) => p.bundle.bundleId === 'rust-onboarding')!;
    const reviewPrim = idx.all().find((p) => p.bundle.bundleId === 'code-review-kit')!;
    idx.addToShortlist(sl.id, rustPrim.id);
    idx.addToShortlist(sl.id, reviewPrim.id);

    const exp = exportShortlistAsProfile(idx, sl, { profileId: 'rust-review' });
    expect(exp.profile.bundles.length).toBe(2);
    const ids = exp.profile.bundles.map((b) => b.id).toSorted();
    expect(ids).toStrictEqual(['code-review-kit', 'rust-onboarding']);
    const rustEntry = exp.profile.bundles.find((b) => b.id === 'rust-onboarding')!;
    expect(rustEntry.version).toBe('0.3.1');
    expect(rustEntry.source).toBe('hub-a');
    expect(rustEntry.required).toBe(true);
  });

  it('suggests a collection when requested and warns about MCP primitives', async () => {
    const idx = await PrimitiveIndex.buildFrom(new FakeBundleProvider(createFixtureBundles()));
    const sl = idx.createShortlist('mix');
    const tfPrim = idx.all().find((p) => p.path === 'prompts/terraform-module.prompt.md')!;
    const mcpPrim = idx.all().find((p) => p.kind === 'mcp-server')!;
    idx.addToShortlist(sl.id, tfPrim.id);
    idx.addToShortlist(sl.id, mcpPrim.id);

    const exp = exportShortlistAsProfile(idx, sl, {
      profileId: 'mix-profile',
      suggestCollection: true
    });
    expect(exp.suggestedCollection).toBeTruthy();
    expect(
      exp.warnings.some((w) => w.includes('mcp-server'))
    ).toBe(true);
    expect(exp.suggestedCollection!.items.length).toBe(1);
  });

  it('warns about missing primitives', async () => {
    const idx = await PrimitiveIndex.buildFrom(new FakeBundleProvider(createFixtureBundles()));
    const sl = idx.createShortlist('ghost');
    (sl.primitiveIds).push('deadbeefdeadbeef');
    const exp = exportShortlistAsProfile(idx, sl, { profileId: 'p' });
    expect(exp.warnings.some((w) => w.includes('deadbeef'))).toBe(true);
  });
});

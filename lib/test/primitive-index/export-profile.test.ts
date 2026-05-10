import * as assert from 'node:assert';
import {
  exportShortlistAsProfile,
} from '../../src/primitive-index/export-profile';
import {
  PrimitiveIndex,
} from '../../src/primitive-index/index';
import {
  createFixtureBundles,
  FakeBundleProvider,
} from './fixtures';

describe('exportShortlistAsProfile', () => {
  it('groups primitives by (source, bundle) and pins versions', async () => {
    const idx = await PrimitiveIndex.buildFrom(new FakeBundleProvider(createFixtureBundles()));
    const sl = idx.createShortlist('rust+review');
    const rustPrim = idx.all().find((p) => p.bundle.bundleId === 'rust-onboarding')!;
    const reviewPrim = idx.all().find((p) => p.bundle.bundleId === 'code-review-kit')!;
    idx.addToShortlist(sl.id, rustPrim.id);
    idx.addToShortlist(sl.id, reviewPrim.id);

    const exp = exportShortlistAsProfile(idx, sl, { profileId: 'rust-review' });
    assert.strictEqual(exp.profile.bundles.length, 2);
    const ids = exp.profile.bundles.map((b) => b.id).toSorted();
    assert.deepStrictEqual(ids, ['code-review-kit', 'rust-onboarding']);
    const rustEntry = exp.profile.bundles.find((b) => b.id === 'rust-onboarding')!;
    assert.strictEqual(rustEntry.version, '0.3.1');
    assert.strictEqual(rustEntry.source, 'hub-a');
    assert.strictEqual(rustEntry.required, true);
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
    assert.ok(exp.suggestedCollection);
    assert.ok(
      exp.warnings.some((w) => w.includes('mcp-server')),
      'should warn that MCP primitives cannot be included in the collection'
    );
    assert.strictEqual(exp.suggestedCollection.items.length, 1);
  });

  it('warns about missing primitives', async () => {
    const idx = await PrimitiveIndex.buildFrom(new FakeBundleProvider(createFixtureBundles()));
    const sl = idx.createShortlist('ghost');
    // Manually poke a bogus id into the shortlist.
    (sl.primitiveIds).push('deadbeefdeadbeef');
    const exp = exportShortlistAsProfile(idx, sl, { profileId: 'p' });
    assert.ok(exp.warnings.some((w) => w.includes('deadbeef')));
  });
});

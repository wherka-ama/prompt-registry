import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  harvest,
} from '../../src/primitive-index/harvester';
import {
  PrimitiveIndex,
} from '../../src/primitive-index/index';
import {
  loadIndex,
  saveIndex,
} from '../../src/primitive-index/store';
import {
  createFixtureBundles,
  FakeBundleProvider,
} from './fixtures';

async function buildIndex(): Promise<PrimitiveIndex> {
  return PrimitiveIndex.buildFrom(new FakeBundleProvider(createFixtureBundles()));
}

describe('PrimitiveIndex', () => {
  it('builds and exposes stats', async () => {
    const idx = await buildIndex();
    const stats = idx.stats();
    assert.ok(stats.primitives >= 20);
    assert.ok(stats.bundles >= 7);
    assert.ok(stats.byKind.prompt >= 1);
  });

  it('search matches relevant primitives by title+tags', async () => {
    const idx = await buildIndex();
    const res = idx.search({ q: 'terraform module', limit: 5 });
    assert.ok(res.hits.length > 0);
    assert.match(res.hits[0].primitive.title.toLowerCase(), /terraform/);
  });

  it('facet filters narrow candidates', async () => {
    const idx = await buildIndex();
    const res = idx.search({ kinds: ['chat-mode'] });
    assert.ok(res.hits.every((h) => h.primitive.kind === 'chat-mode'));
    assert.strictEqual(res.facets.kinds['chat-mode'], res.total);
  });

  it('installedOnly filter works', async () => {
    const idx = await buildIndex();
    const res = idx.search({ installedOnly: true });
    assert.ok(res.hits.every((h) => h.primitive.bundle.installed));
  });

  it('explain mode attaches matches', async () => {
    const idx = await buildIndex();
    const res = idx.search({ q: 'review', limit: 3, explain: true });
    assert.ok(res.hits[0].matches && res.hits[0].matches.length > 0);
  });

  it('is deterministic across runs', async () => {
    const a = await buildIndex();
    const b = await buildIndex();
    const ra = a.search({ q: 'rust' });
    const rb = b.search({ q: 'rust' });
    assert.deepStrictEqual(
      ra.hits.map((h) => h.primitive.id),
      rb.hits.map((h) => h.primitive.id)
    );
  });

  it('shortlist CRUD', async () => {
    const idx = await buildIndex();
    const prim = idx.all()[0];
    const sl = idx.createShortlist('my');
    idx.addToShortlist(sl.id, prim.id);
    assert.deepStrictEqual(idx.getShortlist(sl.id)?.primitiveIds, [prim.id]);
    idx.addToShortlist(sl.id, prim.id); // idempotent
    assert.strictEqual(idx.getShortlist(sl.id)?.primitiveIds.length, 1);
    idx.removeFromShortlist(sl.id, prim.id);
    assert.strictEqual(idx.getShortlist(sl.id)?.primitiveIds.length, 0);
    assert.throws(() => idx.addToShortlist(sl.id, 'bogus'));
    assert.throws(() => idx.addToShortlist('bogus', prim.id));
  });

  it('round-trips via save/load preserving searchability and shortlists', async () => {
    const idx = await buildIndex();
    const sl = idx.createShortlist('persisted');
    const prim = idx.all()[0];
    idx.addToShortlist(sl.id, prim.id);
    const file = path.join(os.tmpdir(), `pi-${Date.now()}.json`);
    try {
      saveIndex(idx, file);
      const loaded = loadIndex(file);
      assert.strictEqual(loaded.stats().primitives, idx.stats().primitives);
      assert.strictEqual(loaded.getShortlist(sl.id)?.primitiveIds[0], prim.id);
      const res = loaded.search({ q: 'terraform' });
      assert.ok(res.hits.length > 0);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it('refresh reports adds/updates/removes and prunes shortlists', async () => {
    const bundles = createFixtureBundles();
    const provider = new FakeBundleProvider(bundles);
    const prims = await harvest(provider);
    const idx = PrimitiveIndex.fromPrimitives(prims);
    const sl = idx.createShortlist('check');
    const removedId = prims[0].id;
    idx.addToShortlist(sl.id, removedId);

    // Create a mutated provider: drop the first primitive's file, add a new one.
    const mutated = createFixtureBundles();
    delete mutated[0].files['prompts/terraform-module.prompt.md'];
    mutated[0].manifest.items = mutated[0].manifest.items!.filter(
      (i) => i.path !== 'prompts/terraform-module.prompt.md'
    );
    // Change existing content to trigger update.
    mutated[1].files['prompts/rust-intro.prompt.md'] =
      mutated[1].files['prompts/rust-intro.prompt.md'] + '\nextra content';

    const report = await idx.refresh(new FakeBundleProvider(mutated));
    assert.ok(report.removed.includes(removedId));
    assert.ok(report.updated.length > 0);
    assert.strictEqual(idx.getShortlist(sl.id)?.primitiveIds.length, 0);
  });
});

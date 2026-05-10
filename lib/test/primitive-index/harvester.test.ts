import * as assert from 'node:assert';
import {
  harvest,
} from '../../src/primitive-index/harvester';
import {
  createFixtureBundles,
  FakeBundleProvider,
} from './fixtures';

describe('harvester', () => {
  it('produces primitives for all bundles and includes MCP servers', async () => {
    const provider = new FakeBundleProvider(createFixtureBundles());
    const prims = await harvest(provider);
    const byKind = prims.reduce<Record<string, number>>((acc, p) => {
      acc[p.kind] = (acc[p.kind] ?? 0) + 1;
      return acc;
    }, {});
    assert.ok(prims.length >= 20);
    assert.ok(byKind.prompt >= 8);
    assert.ok(byKind['chat-mode'] >= 3);
    assert.ok(byKind.instruction >= 3);
    assert.ok(byKind.agent >= 2);
    assert.strictEqual(byKind.skill, 1);
    assert.strictEqual(byKind['mcp-server'], 1);
  });

  it('isolates errors per bundle via onError hook', async () => {
    const bundles = createFixtureBundles();
    // Force a file-read error on the first bundle by removing a file.
    delete bundles[0].files['prompts/terraform-module.prompt.md'];
    const errors: unknown[] = [];
    const provider = new FakeBundleProvider(bundles);
    const prims = await harvest(provider, { onError: (_, e) => errors.push(e) });
    assert.ok(errors.length > 0);
    // Other bundles still produced primitives.
    assert.ok(prims.some((p) => p.bundle.bundleId === 'rust-onboarding'));
  });

  it('yields stable primitive ids (deterministic)', async () => {
    const provider = new FakeBundleProvider(createFixtureBundles());
    const a = await harvest(provider);
    const b = await harvest(new FakeBundleProvider(createFixtureBundles()));
    const idsA = a.map((p) => p.id).toSorted();
    const idsB = b.map((p) => p.id).toSorted();
    assert.deepStrictEqual(idsA, idsB);
  });
});

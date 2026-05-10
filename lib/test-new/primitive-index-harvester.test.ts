import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  harvest,
} from '../src/primitive-index/harvester';
import {
  createFixtureBundles,
  FakeBundleProvider,
} from '../test/primitive-index/fixtures';

describe('harvester', () => {
  it('produces primitives for all bundles and includes MCP servers', async () => {
    const provider = new FakeBundleProvider(createFixtureBundles());
    const prims = await harvest(provider);
    const byKind = prims.reduce<Record<string, number>>((acc, p) => {
      acc[p.kind] = (acc[p.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(prims.length).toBeGreaterThanOrEqual(20);
    expect(byKind.prompt).toBeGreaterThanOrEqual(8);
    expect(byKind['chat-mode']).toBeGreaterThanOrEqual(3);
    expect(byKind.instruction).toBeGreaterThanOrEqual(3);
    expect(byKind.agent).toBeGreaterThanOrEqual(2);
    expect(byKind.skill).toBe(1);
    expect(byKind['mcp-server']).toBe(1);
  });

  it('isolates errors per bundle via onError hook', async () => {
    const bundles = createFixtureBundles();
    delete bundles[0].files['prompts/terraform-module.prompt.md'];
    const errors: unknown[] = [];
    const provider = new FakeBundleProvider(bundles);
    const prims = await harvest(provider, { onError: (_, e) => errors.push(e) });
    expect(errors.length).toBeGreaterThan(0);
    expect(prims.some((p) => p.bundle.bundleId === 'rust-onboarding')).toBe(true);
  });

  it('yields stable primitive ids (deterministic)', async () => {
    const provider = new FakeBundleProvider(createFixtureBundles());
    const a = await harvest(provider);
    const b = await harvest(new FakeBundleProvider(createFixtureBundles()));
    const idsA = a.map((p) => p.id).toSorted();
    const idsB = b.map((p) => p.id).toSorted();
    expect(idsA).toStrictEqual(idsB);
  });
});

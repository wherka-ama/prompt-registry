/**
 * Phase 1 / Step 1.4 — TargetStateStore tests.
 *
 * TDD tests for target state persistence covering:
 * - save and load round-trip
 * - loadAll returns all states
 * - remove deletes state
 * - getLastUsedTarget returns most recent
 * - file doesn't exist handling
 */

import assert from 'node:assert';
import {
  describe,
  it,
} from 'node:test';
import type {
  FsAbstraction,
} from '../src/cli/framework';
import {
  type TargetState,
  TargetStateStore,
} from '../src/install/target-state-store';

// eslint-disable-next-line @typescript-eslint/no-floating-promises -- describe doesn't return a promise
describe('TargetStateStore', () => {
  /**
   * In-memory FS abstraction for testing.
   */
  class TestFs implements FsAbstraction {
    private readonly files = new Map<string, string>();

    public readFile(path: string): Promise<string> {
      const content = this.files.get(path);
      if (content === undefined) {
        throw new Error(`File not found: ${path}`);
      }
      return Promise.resolve(content);
    }

    public writeFile(path: string, contents: string): Promise<void> {
      this.files.set(path, contents);
      return Promise.resolve();
    }

    public readJson<T = unknown>(path: string): Promise<T> {
      return this.readFile(path).then((content) => JSON.parse(content) as T);
    }

    public writeJson(path: string, value: unknown): Promise<void> {
      return this.writeFile(path, JSON.stringify(value, null, 2));
    }

    public exists(path: string): Promise<boolean> {
      return Promise.resolve(this.files.has(path));
    }

    public mkdir(_path: string, _opts?: { recursive?: boolean }): Promise<void> {
      // No-op for in-memory FS
      return Promise.resolve();
    }

    public readDir(): Promise<string[]> {
      return Promise.resolve([]);
    }

    public remove(): Promise<void> {
      // No-op for in-memory FS
      return Promise.resolve();
    }
  }

  const createTestFs = (): TestFs => new TestFs();
  const createState = (targetName: string, lastUsedAt?: string): TargetState => ({
    targetName,
    lastInstalledBundles: [
      { bundleId: 'test-bundle', version: '1.0.0', installedAt: '2024-01-01T00:00:00Z' }
    ],
    lastUsedAt: lastUsedAt ?? '2024-01-01T00:00:00Z'
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('saves and loads state round-trip', async () => {
    const fs = createTestFs();
    const store = new TargetStateStore({
      fs,
      statePath: '/project/.prompt-registry/target-state.json'
    });

    const state = createState('my-target');
    await store.save(state);

    const loaded = await store.load('my-target');
    assert.strictEqual(loaded?.targetName, 'my-target');
    assert.strictEqual(loaded?.lastInstalledBundles.length, 1);
    assert.strictEqual(loaded?.lastInstalledBundles[0].bundleId, 'test-bundle');
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('loadAll returns all target states', async () => {
    const fs = createTestFs();
    const store = new TargetStateStore({
      fs,
      statePath: '/project/.prompt-registry/target-state.json'
    });

    await store.save(createState('target-1'));
    await store.save(createState('target-2'));

    const all = await store.loadAll();
    assert.strictEqual(Object.keys(all.targets).length, 2);
    assert.ok(all.targets['target-1']);
    assert.ok(all.targets['target-2']);
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('remove deletes a target state', async () => {
    const fs = createTestFs();
    const store = new TargetStateStore({
      fs,
      statePath: '/project/.prompt-registry/target-state.json'
    });

    await store.save(createState('target-1'));
    await store.save(createState('target-2'));

    await store.remove('target-1');

    const all = await store.loadAll();
    assert.strictEqual(Object.keys(all.targets).length, 1);
    assert.ok(!all.targets['target-1']);
    assert.ok(all.targets['target-2']);
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('getLastUsedTarget returns most recently used target', async () => {
    const fs = createTestFs();
    const store = new TargetStateStore({
      fs,
      statePath: '/project/.prompt-registry/target-state.json'
    });

    await store.save(createState('target-1', '2024-01-01T00:00:00Z'));
    await store.save(createState('target-2', '2024-01-02T00:00:00Z'));
    await store.save(createState('target-3', '2024-01-03T00:00:00Z'));

    const lastUsed = await store.getLastUsedTarget();
    assert.strictEqual(lastUsed, 'target-3');
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('load returns null for non-existent target', async () => {
    const fs = createTestFs();
    const store = new TargetStateStore({
      fs,
      statePath: '/project/.prompt-registry/target-state.json'
    });

    const loaded = await store.load('non-existent');
    assert.strictEqual(loaded, null);
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('loadAll returns empty object when file does not exist', async () => {
    const fs = createTestFs();
    const store = new TargetStateStore({
      fs,
      statePath: '/project/.prompt-registry/target-state.json'
    });

    const all = await store.loadAll();
    assert.deepStrictEqual(all, { targets: {} });
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('getLastUsedTarget returns null when no state exists', async () => {
    const fs = createTestFs();
    const store = new TargetStateStore({
      fs,
      statePath: '/project/.prompt-registry/target-state.json'
    });

    const lastUsed = await store.getLastUsedTarget();
    assert.strictEqual(lastUsed, null);
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('remove handles non-existent target gracefully', () => {
    const fs = createTestFs();
    const store = new TargetStateStore({
      fs,
      statePath: '/project/.prompt-registry/target-state.json'
    });

    // Should not throw
    void store.remove('non-existent');
  });
});

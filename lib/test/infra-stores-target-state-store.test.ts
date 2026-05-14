import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';
import {
  TargetStateStore,
  type TargetState,
} from '../src/infra/stores/target-state-store';

let tmp: string;
const realFs = createNodeFsAdapter();

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-target-state-store-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('TargetStateStore', () => {
  it('saves and loads target state', async () => {
    const statePath = path.join(tmp, 'target-state.json');
    const store = new TargetStateStore({ fs: realFs, statePath });
    const state: TargetState = {
      targetName: 'test-target',
      lastInstalledBundles: [
        { bundleId: 'bundle1', version: '1.0.0', installedAt: '2024-01-01T00:00:00Z' },
      ],
      lastUsedAt: '2024-01-01T00:00:00Z',
    };
    await store.save(state);
    const loaded = await store.load('test-target');
    expect(loaded).toEqual(state);
  });

  it('returns null for missing target', async () => {
    const statePath = path.join(tmp, 'target-state.json');
    const store = new TargetStateStore({ fs: realFs, statePath });
    const loaded = await store.load('missing-target');
    expect(loaded).toBeNull();
  });

  it('returns empty object when file does not exist for loadAll', async () => {
    const statePath = path.join(tmp, 'target-state.json');
    const store = new TargetStateStore({ fs: realFs, statePath });
    const loaded = await store.loadAll();
    expect(loaded).toEqual({ targets: {} });
  });

  it('loads all target states', async () => {
    const statePath = path.join(tmp, 'target-state.json');
    const store = new TargetStateStore({ fs: realFs, statePath });
    const state1: TargetState = {
      targetName: 'target1',
      lastInstalledBundles: [{ bundleId: 'bundle1', version: '1.0.0', installedAt: '2024-01-01T00:00:00Z' }],
      lastUsedAt: '2024-01-01T00:00:00Z',
    };
    const state2: TargetState = {
      targetName: 'target2',
      lastInstalledBundles: [{ bundleId: 'bundle2', version: '2.0.0', installedAt: '2024-01-02T00:00:00Z' }],
      lastUsedAt: '2024-01-02T00:00:00Z',
    };
    await store.save(state1);
    await store.save(state2);
    const loaded = await store.loadAll();
    expect(loaded.targets['target1']).toEqual(state1);
    expect(loaded.targets['target2']).toEqual(state2);
  });

  it('removes target state', async () => {
    const statePath = path.join(tmp, 'target-state.json');
    const store = new TargetStateStore({ fs: realFs, statePath });
    const state: TargetState = {
      targetName: 'test-target',
      lastInstalledBundles: [{ bundleId: 'bundle1', version: '1.0.0', installedAt: '2024-01-01T00:00:00Z' }],
      lastUsedAt: '2024-01-01T00:00:00Z',
    };
    await store.save(state);
    await store.remove('test-target');
    const loaded = await store.load('test-target');
    expect(loaded).toBeNull();
  });

  it('removes target when file does not exist', async () => {
    const statePath = path.join(tmp, 'target-state.json');
    const store = new TargetStateStore({ fs: realFs, statePath });
    await store.remove('missing-target');
    // Should not throw
  });

  it('gets last used target', async () => {
    const statePath = path.join(tmp, 'target-state.json');
    const store = new TargetStateStore({ fs: realFs, statePath });
    const state1: TargetState = {
      targetName: 'target1',
      lastInstalledBundles: [{ bundleId: 'bundle1', version: '1.0.0', installedAt: '2024-01-01T00:00:00Z' }],
      lastUsedAt: '2024-01-01T00:00:00Z',
    };
    const state2: TargetState = {
      targetName: 'target2',
      lastInstalledBundles: [{ bundleId: 'bundle2', version: '2.0.0', installedAt: '2024-01-02T00:00:00Z' }],
      lastUsedAt: '2024-01-02T00:00:00Z',
    };
    await store.save(state1);
    await store.save(state2);
    const lastUsed = await store.getLastUsedTarget();
    expect(lastUsed).toBe('target2');
  });

  it('returns null for last used target when no states exist', async () => {
    const statePath = path.join(tmp, 'target-state.json');
    const store = new TargetStateStore({ fs: realFs, statePath });
    const lastUsed = await store.getLastUsedTarget();
    expect(lastUsed).toBeNull();
  });

  it('creates parent directories when saving', async () => {
    const statePath = path.join(tmp, 'nested', 'dir', 'target-state.json');
    const store = new TargetStateStore({ fs: realFs, statePath });
    const state: TargetState = {
      targetName: 'test-target',
      lastInstalledBundles: [{ bundleId: 'bundle1', version: '1.0.0', installedAt: '2024-01-01T00:00:00Z' }],
      lastUsedAt: '2024-01-01T00:00:00Z',
    };
    await store.save(state);
    const loaded = await store.load('test-target');
    expect(loaded).toEqual(state);
  });
});

/**
 * Coverage tests for app/registry/hub-manager.ts.
 *
 * Tests the HubManager class which orchestrates HubStore, ActiveHubStore,
 * and HubResolver to provide hub import/list/use/sync/remove flows.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  HubManager,
} from '../src/app/registry/hub-manager';
import {
  DEFAULT_LOCAL_HUB_ID,
} from '../src/domain/registry';
import {
  ActiveHubStore,
} from '../src/infra/stores/active-hub-store';
import {
  HubStore,
} from '../src/infra/stores/yaml-hub-store';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

const MINIMAL_HUB_CONFIG = {
  version: '1.0.0',
  metadata: {
    name: 'Test Hub',
    description: 'A test hub',
    maintainer: 'test',
    updatedAt: '2026-01-01T00:00:00Z'
  },
  sources: [],
  profiles: []
};

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-hubmgr-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('HubManager', () => {
  it('imports a hub and sets it as active when no active hub exists', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: MINIMAL_HUB_CONFIG,
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    const hubId = await manager.importHub({ type: 'local', location: '/test/hub' });

    expect(hubId).toBeTruthy();
    expect(await activeStore.get()).toBe(hubId);
    expect(resolver.resolve).toHaveBeenCalledOnce();
  });

  it('does not override existing active hub when importing a new hub', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    await activeStore.set('existing-hub');

    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: MINIMAL_HUB_CONFIG,
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    await manager.importHub({ type: 'local', location: '/test/hub' });

    expect(await activeStore.get()).toBe('existing-hub');
  });

  it('throws when importing a hub with reserved id', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: MINIMAL_HUB_CONFIG,
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);

    await expect(
      manager.importHub({ type: 'local', location: '/test/hub' }, DEFAULT_LOCAL_HUB_ID)
    ).rejects.toThrow('Reserved hub id');
  });

  it('lists all hubs on disk', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: MINIMAL_HUB_CONFIG,
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    await manager.importHub({ type: 'local', location: '/test/hub1' }, 'hub-1');
    await manager.importHub({ type: 'local', location: '/test/hub2' }, 'hub-2');

    const hubs = await manager.listHubs();
    expect(hubs).toHaveLength(2);
    expect(hubs.map((h) => h.id)).toContain('hub-1');
    expect(hubs.map((h) => h.id)).toContain('hub-2');
  });

  it('returns null when no active hub is set', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn()
    };

    const manager = new HubManager(store, activeStore, resolver);
    const active = await manager.getActiveHub();

    expect(active).toBeNull();
  });

  it('gets the active hub when one is set', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: MINIMAL_HUB_CONFIG,
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    const hubId = await manager.importHub({ type: 'local', location: '/test/hub' });

    const active = await manager.getActiveHub();
    expect(active).not.toBeNull();
    expect(active?.id).toBe(hubId);
  });

  it('clears stale active pointer when hub no longer exists', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    await activeStore.set('nonexistent-hub');

    const resolver = {
      resolve: vi.fn()
    };

    const manager = new HubManager(store, activeStore, resolver);
    const active = await manager.getActiveHub();

    expect(active).toBeNull();
    expect(await activeStore.get()).toBeNull();
  });

  it('sets a hub as active', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: MINIMAL_HUB_CONFIG,
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    const hubId = await manager.importHub({ type: 'local', location: '/test/hub' });

    await manager.useHub(hubId);
    expect(await activeStore.get()).toBe(hubId);
  });

  it('throws when setting a non-existent hub as active', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn()
    };

    const manager = new HubManager(store, activeStore, resolver);

    await expect(manager.useHub('nonexistent')).rejects.toThrow('Hub not found');
  });

  it('clears the active hub when null is passed', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: MINIMAL_HUB_CONFIG,
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    await manager.importHub({ type: 'local', location: '/test/hub' });

    await manager.useHub(null);
    expect(await activeStore.get()).toBeNull();
  });

  it('checks hub reachability successfully', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: MINIMAL_HUB_CONFIG,
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    const hubId = await manager.importHub({ type: 'local', location: '/test/hub' });

    const check = await manager.checkHub(hubId);
    expect(check.status).toBe('ok');
  });

  it('returns error when hub is unreachable', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: MINIMAL_HUB_CONFIG,
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    const hubId = await manager.importHub({ type: 'local', location: '/test/hub' });

    resolver.resolve = vi.fn().mockRejectedValue(new Error('Network error'));

    const check = await manager.checkHub(hubId);
    expect(check.status).toBe('error');
    expect(check.reason).toBe('Network error');
  });

  it('syncs a hub by re-resolving its reference', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: MINIMAL_HUB_CONFIG,
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    const hubId = await manager.importHub({ type: 'local', location: '/test/hub' });

    await manager.syncHub(hubId);
    expect(resolver.resolve).toHaveBeenCalledTimes(2); // import + sync
  });

  it('removes a hub and clears active pointer if it was active', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: MINIMAL_HUB_CONFIG,
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    const hubId = await manager.importHub({ type: 'local', location: '/test/hub' });

    await manager.removeHub(hubId);
    expect(await activeStore.get()).toBeNull();
    expect(await store.has(hubId)).toBe(false);
  });

  it('lists sources from the active hub', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: {
          ...MINIMAL_HUB_CONFIG,
          sources: [{ id: 'src1', type: 'local', url: '/src1' }]
        },
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    const hubId = await manager.importHub({ type: 'local', location: '/test/hub' });

    const sources = await manager.listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe('src1');
    expect(sources[0].hubId).toBe(hubId);
  });

  it('returns empty source list when no hub is active', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn()
    };

    const manager = new HubManager(store, activeStore, resolver);
    const sources = await manager.listSources();

    expect(sources).toHaveLength(0);
  });

  it('lists sources across all hubs', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockImplementation((ref) => {
        if (ref.location === '/hub1') {
          return Promise.resolve({
            config: { ...MINIMAL_HUB_CONFIG, sources: [{ id: 'src1', type: 'local', url: '/src1' }] },
            reference: { type: 'local', location: '/hub1' }
          });
        }
        return Promise.resolve({
          config: { ...MINIMAL_HUB_CONFIG, sources: [{ id: 'src2', type: 'local', url: '/src2' }] },
          reference: { type: 'local', location: '/hub2' }
        });
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    await manager.importHub({ type: 'local', location: '/hub1' }, 'hub1');
    await manager.importHub({ type: 'local', location: '/hub2' }, 'hub2');

    const sources = await manager.listSourcesAcrossAllHubs();
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.id)).toContain('src1');
    expect(sources.map((s) => s.id)).toContain('src2');
  });

  it('adds a detached source to default-local hub', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn()
    };

    const manager = new HubManager(store, activeStore, resolver);
    const source = await manager.addDetachedSource({ id: 'detached-1', type: 'local', url: '/detached' });

    expect(source.hubId).toBe(DEFAULT_LOCAL_HUB_ID);
    expect(source.id).toBe('detached-1');
    expect(await store.has(DEFAULT_LOCAL_HUB_ID)).toBe(true);
  });

  it('removes a detached source from default-local hub', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn()
    };

    const manager = new HubManager(store, activeStore, resolver);
    await manager.addDetachedSource({ id: 'detached-1', type: 'local', url: '/detached' });

    const removed = await manager.removeDetachedSource('detached-1');
    expect(removed).toBe(true);
  });

  it('returns false when removing non-existent detached source', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn()
    };

    const manager = new HubManager(store, activeStore, resolver);
    const removed = await manager.removeDetachedSource('nonexistent');

    expect(removed).toBe(false);
  });

  it('adds a profile to a hub', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: MINIMAL_HUB_CONFIG,
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    const profile = {
      id: 'test-profile',
      name: 'Test Profile',
      description: 'A test profile',
      bundles: []
    };

    await manager.addProfile('hub-1', profile);
    expect(await store.has('hub-1')).toBe(true);
  });

  it('removes a profile from a hub', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: MINIMAL_HUB_CONFIG,
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    const profile = {
      id: 'test-profile',
      name: 'Test Profile',
      description: 'A test profile',
      bundles: []
    };

    await manager.addProfile('hub-1', profile);
    const removed = await manager.removeProfile('hub-1', 'test-profile');

    expect(removed).toBe(true);
  });

  it('returns false when removing non-existent profile', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const activePath = path.join(tmp, 'active-hub.json');
    const fsAdapter = createNodeFsAdapter();
    await fs.mkdir(hubsDir, { recursive: true });

    const store = new HubStore(hubsDir, fsAdapter);
    const activeStore = new ActiveHubStore(activePath, fsAdapter);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        config: MINIMAL_HUB_CONFIG,
        reference: { type: 'local', location: '/test/hub' }
      })
    };

    const manager = new HubManager(store, activeStore, resolver);
    await manager.importHub({ type: 'local', location: '/test/hub' }, 'hub-1');

    const removed = await manager.removeProfile('hub-1', 'nonexistent');
    expect(removed).toBe(false);
  });
});

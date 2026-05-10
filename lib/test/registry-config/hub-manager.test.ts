/**
 * Phase 6 / Iter 46-50 — HubManager tests.
 *
 * Composes a stub resolver + real HubStore/ActiveHubStore against
 * a tmpdir. Covers: import, list, use, sync, remove,
 * listSourcesAcrossAllHubs, addDetachedSource (default-local hub
 * synthesis per D23).
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_LOCAL_HUB_ID,
  type HubConfig,
  type HubReference,
} from '../../src/domain/registry';
import {
  ActiveHubStore,
  HubManager,
  type HubResolver,
  HubStore,
} from '../../src/registry-config';
import {
  createNodeFsAdapter,
} from '../cli/helpers/node-fs-adapter';

const realFs = createNodeFsAdapter();

const stubResolver = (config: HubConfig): HubResolver => ({
  resolve: (ref: HubReference) => Promise.resolve({ config, reference: ref })
});

const sampleConfig = (): HubConfig => ({
  version: '1.0.0',
  metadata: { name: 'My Hub', description: 'd', maintainer: 'm', updatedAt: 'now' },
  sources: [{
    id: 'github-abc', name: 'r', type: 'github', url: 'o/r',
    enabled: true, priority: 0, hubId: 'placeholder'
  }],
  profiles: []
});

let work: string;
beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-hm-'));
});
afterEach(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

describe('Phase 6 / iter 46-50 - HubManager', () => {
  const newMgr = (config: HubConfig = sampleConfig()): HubManager =>
    new HubManager(
      new HubStore(path.join(work, 'hubs'), realFs),
      new ActiveHubStore(path.join(work, 'active-hub.json'), realFs),
      stubResolver(config)
    );

  it('importHub persists config + sets it active when no active hub yet', async () => {
    const mgr = newMgr();
    const id = await mgr.importHub({ type: 'github', location: 'o/r' });
    assert.strictEqual(id, 'my-hub');
    const active = await mgr.getActiveHub();
    assert.strictEqual(active?.id, 'my-hub');
  });

  it('importHub respects an existing active pointer', async () => {
    const mgr = newMgr();
    await mgr.importHub({ type: 'github', location: 'o/first' }, 'first');
    await mgr.importHub({ type: 'github', location: 'o/second' }, 'second');
    const active = await mgr.getActiveHub();
    assert.strictEqual(active?.id, 'first');
  });

  it('importHub refuses the reserved default-local id', async () => {
    const mgr = newMgr();
    await assert.rejects(
      () => mgr.importHub({ type: 'local', location: '/x' }, DEFAULT_LOCAL_HUB_ID),
      /Reserved/
    );
  });

  it('listHubs returns id + name + description for every saved hub', async () => {
    const mgr = newMgr();
    await mgr.importHub({ type: 'github', location: 'o/r' }, 'h1');
    await mgr.importHub({ type: 'github', location: 'o/r2' }, 'h2');
    const hubs = await mgr.listHubs();
    assert.deepStrictEqual(hubs.map((h) => h.id).toSorted(), ['h1', 'h2']);
  });

  it('useHub sets / clears the active pointer', async () => {
    const mgr = newMgr();
    await mgr.importHub({ type: 'github', location: 'o/r' }, 'h1');
    await mgr.importHub({ type: 'github', location: 'o/r2' }, 'h2');
    await mgr.useHub('h2');
    assert.strictEqual((await mgr.getActiveHub())?.id, 'h2');
    await mgr.useHub(null);
    assert.strictEqual(await mgr.getActiveHub(), null);
  });

  it('useHub throws on unknown id', async () => {
    const mgr = newMgr();
    await assert.rejects(() => mgr.useHub('nope'), /Hub not found/);
  });

  it('removeHub clears active pointer when active is removed', async () => {
    const mgr = newMgr();
    await mgr.importHub({ type: 'github', location: 'o/r' }, 'h1');
    await mgr.removeHub('h1');
    assert.strictEqual(await mgr.getActiveHub(), null);
  });

  it('listSources from active hub re-stamps hubId on each source', async () => {
    const mgr = newMgr();
    await mgr.importHub({ type: 'github', location: 'o/r' }, 'h1');
    const sources = await mgr.listSources();
    assert.strictEqual(sources.length, 1);
    assert.strictEqual(sources[0].hubId, 'h1');
  });

  it('listSourcesAcrossAllHubs aggregates everywhere', async () => {
    const mgr = newMgr();
    await mgr.importHub({ type: 'github', location: 'o/r' }, 'h1');
    await mgr.importHub({ type: 'github', location: 'o/r2' }, 'h2');
    const sources = await mgr.listSourcesAcrossAllHubs();
    assert.strictEqual(sources.length, 2);
    const hubIds = sources.map((s) => s.hubId).toSorted();
    assert.deepStrictEqual(hubIds, ['h1', 'h2']);
  });

  it('addDetachedSource auto-creates default-local hub on first call (D23)', async () => {
    const mgr = newMgr();
    const added = await mgr.addDetachedSource({
      id: 'github-zzz', name: 'z', type: 'github', url: 'o/z',
      enabled: true, priority: 0
    });
    assert.strictEqual(added.hubId, DEFAULT_LOCAL_HUB_ID);
    const hubs = await mgr.listHubs();
    assert.ok(hubs.some((h) => h.id === DEFAULT_LOCAL_HUB_ID));
    const sources = await mgr.listSourcesAcrossAllHubs();
    assert.ok(sources.some((s) => s.id === 'github-zzz'));
  });

  it('addDetachedSource appends to an existing default-local hub', async () => {
    const mgr = newMgr();
    await mgr.addDetachedSource({
      id: 'a', name: 'a', type: 'github', url: 'o/a',
      enabled: true, priority: 0
    });
    await mgr.addDetachedSource({
      id: 'b', name: 'b', type: 'github', url: 'o/b',
      enabled: true, priority: 0
    });
    const sources = await mgr.listSources(DEFAULT_LOCAL_HUB_ID);
    assert.strictEqual(sources.length, 2);
  });

  it('addDetachedSource replaces existing entry with same id', async () => {
    const mgr = newMgr();
    await mgr.addDetachedSource({
      id: 'a', name: 'old', type: 'github', url: 'o/a',
      enabled: true, priority: 0
    });
    await mgr.addDetachedSource({
      id: 'a', name: 'new', type: 'github', url: 'o/a',
      enabled: true, priority: 1
    });
    const sources = await mgr.listSources(DEFAULT_LOCAL_HUB_ID);
    assert.strictEqual(sources.length, 1);
    assert.strictEqual(sources[0].name, 'new');
  });

  it('removeDetachedSource drops by id', async () => {
    const mgr = newMgr();
    await mgr.addDetachedSource({
      id: 'a', name: 'a', type: 'github', url: 'o/a',
      enabled: true, priority: 0
    });
    assert.strictEqual(await mgr.removeDetachedSource('a'), true);
    assert.strictEqual(await mgr.removeDetachedSource('a'), false);
  });

  it('syncHub re-runs the resolver and persists', async () => {
    const v1 = sampleConfig();
    const v2: HubConfig = {
      ...v1,
      metadata: { ...v1.metadata, description: 'updated' }
    };
    let useV2 = false;
    const flexResolver: HubResolver = {
      resolve: (ref) => Promise.resolve({ config: useV2 ? v2 : v1, reference: ref })
    };
    const mgr = new HubManager(
      new HubStore(path.join(work, 'hubs'), realFs),
      new ActiveHubStore(path.join(work, 'active-hub.json'), realFs),
      flexResolver
    );
    const id = await mgr.importHub({ type: 'github', location: 'o/r' }, 'h');
    useV2 = true;
    await mgr.syncHub(id);
    const list = await mgr.listHubs();
    assert.strictEqual(list[0].description, 'updated');
  });
});

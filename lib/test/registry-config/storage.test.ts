/**
 * Phase 6 / Iter 28-30 — registry-config storage tests.
 *
 * Covers: resolveUserConfigPaths, HubStore, ActiveHubStore,
 * ProfileActivationStore. Uses real node:fs against a tmpdir so
 * the YAML <-> JSON round-trip is exercised end-to-end.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ActiveHubStore,
  HubStore,
  ProfileActivationStore,
  resolveUserConfigPaths,
} from '../../src/registry-config';
import {
  createNodeFsAdapter,
} from '../cli/helpers/node-fs-adapter';

const realFs = createNodeFsAdapter();
let work: string;

beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-uc-'));
});
afterEach(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

describe('Phase 6 / iter 28 - resolveUserConfigPaths', () => {
  it('uses XDG_CONFIG_HOME when set', () => {
    const p = resolveUserConfigPaths({ XDG_CONFIG_HOME: '/x' });
    assert.strictEqual(p.root, '/x/prompt-registry');
    assert.strictEqual(p.hubs, '/x/prompt-registry/hubs');
    assert.strictEqual(p.profileActivations, '/x/prompt-registry/profile-activations');
    assert.strictEqual(p.activeHub, '/x/prompt-registry/active-hub.json');
  });
  it('falls back to $HOME/.config when XDG unset', () => {
    const p = resolveUserConfigPaths({ HOME: '/u/me' });
    assert.strictEqual(p.root, '/u/me/.config/prompt-registry');
  });
  it('handles missing HOME gracefully (paths still produced)', () => {
    const p = resolveUserConfigPaths({});
    // root resolves to ".config/prompt-registry" relative
    assert.ok(p.root.endsWith('.config/prompt-registry'));
  });
});

describe('Phase 6 / iter 29 - HubStore', () => {
  const sampleConfig = {
    version: '1.0.0',
    metadata: { name: 'My Hub', description: 'd', maintainer: 'me', updatedAt: '2026-04-26T00:00:00Z' },
    sources: [{
      id: 'github-abc',
      name: 'r',
      type: 'github',
      url: 'owner/repo',
      enabled: true,
      priority: 0,
      hubId: 'my-hub'
    }],
    profiles: [{
      id: 'backend',
      name: 'Backend Dev',
      bundles: [{ id: 'foo', version: '1.0.0', source: 'github-abc', required: true }]
    }]
  };

  it('save+load round-trips a config', async () => {
    const store = new HubStore(path.join(work, 'hubs'), realFs);
    const id = await store.save('My Hub', sampleConfig as any, { type: 'github', location: 'owner/hub-repo' });
    assert.strictEqual(id, 'my-hub');

    const loaded = await store.load('my-hub');
    assert.strictEqual(loaded.id, 'my-hub');
    assert.strictEqual(loaded.config.metadata.name, 'My Hub');
    assert.strictEqual(loaded.reference.location, 'owner/hub-repo');
    assert.strictEqual(loaded.config.sources.length, 1);
    assert.strictEqual(loaded.config.profiles[0].bundles.length, 1);
  });

  it('list returns saved ids sorted', async () => {
    const store = new HubStore(path.join(work, 'hubs'), realFs);
    await store.save('zeta', sampleConfig as any, { type: 'local', location: '/x' });
    await store.save('alpha', sampleConfig as any, { type: 'local', location: '/y' });
    assert.deepStrictEqual(await store.list(), ['alpha', 'zeta']);
  });

  it('remove drops both files', async () => {
    const store = new HubStore(path.join(work, 'hubs'), realFs);
    await store.save('h', sampleConfig as any, { type: 'local', location: '/x' });
    assert.ok(await store.has('h'));
    await store.remove('h');
    assert.strictEqual(await store.has('h'), false);
    assert.deepStrictEqual(await store.list(), []);
  });

  it('load throws on missing hub', async () => {
    const store = new HubStore(path.join(work, 'hubs'), realFs);
    await assert.rejects(() => store.load('nope'), /Hub not found/);
  });

  it('load throws on malformed config', async () => {
    await fs.mkdir(path.join(work, 'hubs'), { recursive: true });
    await fs.writeFile(path.join(work, 'hubs', 'bad.yml'), 'not: a hub config');
    const store = new HubStore(path.join(work, 'hubs'), realFs);
    await assert.rejects(() => store.load('bad'), /malformed/);
  });

  it('save sanitizes the id', async () => {
    const store = new HubStore(path.join(work, 'hubs'), realFs);
    const id = await store.save('Weird ID!!', sampleConfig as any, { type: 'local', location: '/x' });
    assert.strictEqual(id, 'weird-id');
  });
});

describe('Phase 6 / iter 30a - ActiveHubStore', () => {
  it('returns null when no pointer file exists', async () => {
    const store = new ActiveHubStore(path.join(work, 'active-hub.json'), realFs);
    assert.strictEqual(await store.get(), null);
  });
  it('set + get round-trip', async () => {
    const store = new ActiveHubStore(path.join(work, 'active-hub.json'), realFs);
    await store.set('my-hub');
    assert.strictEqual(await store.get(), 'my-hub');
  });
  it('set(null) clears the pointer', async () => {
    const store = new ActiveHubStore(path.join(work, 'active-hub.json'), realFs);
    await store.set('my-hub');
    await store.set(null);
    assert.strictEqual(await store.get(), null);
  });
});

describe('Phase 6 / iter 30b - ProfileActivationStore', () => {
  const state = {
    hubId: 'h', profileId: 'p',
    activatedAt: '2026-04-26T00:00:00Z',
    syncedBundles: ['foo'],
    syncedBundleVersions: { foo: '1.0.0' },
    syncedTargets: ['my-vscode']
  };

  it('save+load round-trips', async () => {
    const dir = path.join(work, 'profile-activations');
    const store = new ProfileActivationStore(dir, realFs);
    await store.save(state);
    const loaded = await store.load('h', 'p');
    assert.deepStrictEqual(loaded, state);
  });

  it('load returns null when no state on disk', async () => {
    const dir = path.join(work, 'profile-activations');
    const store = new ProfileActivationStore(dir, realFs);
    assert.strictEqual(await store.load('h', 'p'), null);
  });

  it('getActive returns the single active state', async () => {
    const dir = path.join(work, 'profile-activations');
    const store = new ProfileActivationStore(dir, realFs);
    await store.save(state);
    const active = await store.getActive();
    assert.strictEqual(active?.profileId, 'p');
  });

  it('getActive throws when 2+ activations are present (D21 violation)', async () => {
    const dir = path.join(work, 'profile-activations');
    const store = new ProfileActivationStore(dir, realFs);
    await store.save(state);
    await store.save({ ...state, hubId: 'h2', profileId: 'p2' });
    await assert.rejects(() => store.getActive(), /D21 violation/);
  });

  it('remove drops the file (D21 caller invariant)', async () => {
    const dir = path.join(work, 'profile-activations');
    const store = new ProfileActivationStore(dir, realFs);
    await store.save(state);
    await store.remove('h', 'p');
    assert.strictEqual(await store.load('h', 'p'), null);
  });
});

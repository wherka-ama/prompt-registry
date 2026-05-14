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
import type {
  HubConfig,
  HubReference,
} from '../src/domain/registry';
import {
  HubStore,
} from '../src/infra/stores/yaml-hub-store';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

let tmp: string;
const realFs = createNodeFsAdapter();

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-yaml-hub-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const SAMPLE_CONFIG: HubConfig = {
  version: '1.0.0',
  metadata: {
    name: 'Test Hub',
    description: 'A test hub',
    maintainer: 'test-maintainer',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  sources: [],
  profiles: [],
};

const SAMPLE_REFERENCE: HubReference = {
  type: 'github',
  location: 'test-owner/test-repo',
};

describe('HubStore', () => {
  it('saves a hub config with reference', async () => {
    const store = new HubStore(tmp, realFs);
    const safeId = await store.save('my-hub', SAMPLE_CONFIG, SAMPLE_REFERENCE);
    expect(safeId).toBe('my-hub');
    
    const cfgPath = path.join(tmp, 'my-hub.yml');
    expect(await realFs.exists(cfgPath)).toBe(true);
    
    const metaPath = path.join(tmp, 'my-hub.meta.json');
    expect(await realFs.exists(metaPath)).toBe(true);
  });

  it('sanitizes hub id on save', async () => {
    const store = new HubStore(tmp, realFs);
    const safeId = await store.save('My Hub!', SAMPLE_CONFIG, SAMPLE_REFERENCE);
    expect(safeId).toBe('my-hub');
  });

  it('creates hubs directory if it does not exist', async () => {
    const hubsDir = path.join(tmp, 'hubs');
    const store = new HubStore(hubsDir, realFs);
    await store.save('test-hub', SAMPLE_CONFIG, SAMPLE_REFERENCE);
    expect(await realFs.exists(hubsDir)).toBe(true);
  });

  it('loads a saved hub', async () => {
    const store = new HubStore(tmp, realFs);
    await store.save('my-hub', SAMPLE_CONFIG, SAMPLE_REFERENCE);
    
    const saved = await store.load('my-hub');
    expect(saved.id).toBe('my-hub');
    expect(saved.config.metadata.name).toBe('Test Hub');
    expect(saved.config.metadata.description).toBe('A test hub');
    expect(saved.reference).toEqual(SAMPLE_REFERENCE);
  });

  it('throws when loading non-existent hub', async () => {
    const store = new HubStore(tmp, realFs);
    await expect(store.load('nonexistent')).rejects.toThrow('Hub not found: nonexistent');
  });

  it('throws when loading malformed hub config', async () => {
    const store = new HubStore(tmp, realFs);
    const cfgPath = path.join(tmp, 'bad-hub.yml');
    await fs.writeFile(cfgPath, 'name: Local Hub\ninvalid: yaml');
    
    await expect(store.load('bad-hub')).rejects.toThrow('Hub config is malformed: bad-hub');
  });

  it('loads hub without meta sidecar as local reference', async () => {
    const store = new HubStore(tmp, realFs);
    const cfgPath = path.join(tmp, 'local-hub.yml');
    const validConfig = `version: 1.0.0
metadata:
  name: Local Hub
  description: A local hub
  maintainer: test
  updatedAt: 2024-01-01T00:00:00Z
sources: []
profiles: []`;
    await fs.writeFile(cfgPath, validConfig);
    
    const saved = await store.load('local-hub');
    expect(saved.reference).toEqual({ type: 'local', location: cfgPath });
  });

  it('lists saved hubs', async () => {
    const store = new HubStore(tmp, realFs);
    await store.save('hub-a', SAMPLE_CONFIG, SAMPLE_REFERENCE);
    await store.save('hub-b', SAMPLE_CONFIG, SAMPLE_REFERENCE);
    await store.save('hub-c', SAMPLE_CONFIG, SAMPLE_REFERENCE);
    
    const ids = await store.list();
    expect(ids).toEqual(['hub-a', 'hub-b', 'hub-c']);
  });

  it('returns empty list when hubs directory does not exist', async () => {
    const store = new HubStore(tmp, realFs);
    const ids = await store.list();
    expect(ids).toEqual([]);
  });

  it('sorts hub ids alphabetically', async () => {
    const store = new HubStore(tmp, realFs);
    await store.save('z-hub', SAMPLE_CONFIG, SAMPLE_REFERENCE);
    await store.save('a-hub', SAMPLE_CONFIG, SAMPLE_REFERENCE);
    await store.save('m-hub', SAMPLE_CONFIG, SAMPLE_REFERENCE);
    
    const ids = await store.list();
    expect(ids).toEqual(['a-hub', 'm-hub', 'z-hub']);
  });

  it('removes a hub and its sidecar', async () => {
    const store = new HubStore(tmp, realFs);
    await store.save('my-hub', SAMPLE_CONFIG, SAMPLE_REFERENCE);
    
    const cfgPath = path.join(tmp, 'my-hub.yml');
    const metaPath = path.join(tmp, 'my-hub.meta.json');
    
    expect(await realFs.exists(cfgPath)).toBe(true);
    expect(await realFs.exists(metaPath)).toBe(true);
    
    await store.remove('my-hub');
    
    expect(await realFs.exists(cfgPath)).toBe(false);
    expect(await realFs.exists(metaPath)).toBe(false);
  });

  it('does not error when removing non-existent hub', async () => {
    const store = new HubStore(tmp, realFs);
    await expect(store.remove('nonexistent')).resolves.not.toThrow();
  });

  it('checks if a hub exists', async () => {
    const store = new HubStore(tmp, realFs);
    expect(await store.has('my-hub')).toBe(false);
    
    await store.save('my-hub', SAMPLE_CONFIG, SAMPLE_REFERENCE);
    expect(await store.has('my-hub')).toBe(true);
  });

  it('checks hub existence with sanitized id', async () => {
    const store = new HubStore(tmp, realFs);
    await store.save('My Hub!', SAMPLE_CONFIG, SAMPLE_REFERENCE);
    
    expect(await store.has('My Hub!')).toBe(true);
    expect(await store.has('my-hub')).toBe(true);
  });
});

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
  ActiveHubStore,
} from '../src/infra/stores/active-hub-store';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

let tmp: string;
const realFs = createNodeFsAdapter();

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-active-hub-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('ActiveHubStore', () => {
  it('returns null when file does not exist', async () => {
    const store = new ActiveHubStore(path.join(tmp, 'active-hub.json'), realFs);
    expect(await store.get()).toBeNull();
  });

  it('returns null when file is corrupted', async () => {
    const filePath = path.join(tmp, 'active-hub.json');
    await fs.writeFile(filePath, 'invalid json');
    const store = new ActiveHubStore(filePath, realFs);
    expect(await store.get()).toBeNull();
  });

  it('returns null when hubId is null in file', async () => {
    const filePath = path.join(tmp, 'active-hub.json');
    await fs.writeFile(filePath, JSON.stringify({ hubId: null, setAt: '2024-01-01' }));
    const store = new ActiveHubStore(filePath, realFs);
    expect(await store.get()).toBeNull();
  });

  it('returns the active hub id', async () => {
    const filePath = path.join(tmp, 'active-hub.json');
    await fs.writeFile(filePath, JSON.stringify({ hubId: 'test-hub', setAt: '2024-01-01' }));
    const store = new ActiveHubStore(filePath, realFs);
    expect(await store.get()).toBe('test-hub');
  });

  it('sets the active hub id', async () => {
    const filePath = path.join(tmp, 'active-hub.json');
    const store = new ActiveHubStore(filePath, realFs);
    await store.set('test-hub');
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content) as { hubId: string; setAt: string };
    expect(data.hubId).toBe('test-hub');
    expect(data.setAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('clears the active hub id when set to null', async () => {
    const filePath = path.join(tmp, 'active-hub.json');
    await fs.writeFile(filePath, JSON.stringify({ hubId: 'test-hub', setAt: '2024-01-01' }));
    const store = new ActiveHubStore(filePath, realFs);
    await store.set(null);
    expect(await realFs.exists(filePath)).toBe(false);
  });

  it('does not error when clearing non-existent file', async () => {
    const filePath = path.join(tmp, 'active-hub.json');
    const store = new ActiveHubStore(filePath, realFs);
    await expect(store.set(null)).resolves.not.toThrow();
  });
});

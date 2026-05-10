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
  type Lockfile,
  type LockfileEntry,
  readLockfile,
  upsertEntry,
  upsertHub,
  upsertProfile,
  upsertSource,
  writeLockfile,
} from '../src/install/lockfile';
import {
  createNodeFsAdapter,
} from '../test/cli/helpers/node-fs-adapter';

const realFs = createNodeFsAdapter();

const entry = (overrides: Partial<LockfileEntry> = {}): LockfileEntry => ({
  target: 'my-vscode',
  sourceId: '',
  bundleId: 'foo',
  bundleVersion: '1.0.0',
  installedAt: '2026-04-26T08:00:00.000Z',
  files: ['prompts/a.md'],
  ...overrides
});

let work: string;

beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-lock-'));
});

afterEach(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

describe('lockfile', () => {
  it('readLockfile returns the empty lockfile when absent', async () => {
    const got = await readLockfile(path.join(work, 'p.lock.json'), realFs);
    expect(got).toStrictEqual({ schemaVersion: 1, entries: [] });
  });

  it('write + read round-trip preserves entries', async () => {
    const file = path.join(work, 'p.lock.json');
    const lock: Lockfile = { schemaVersion: 1, entries: [entry()] };
    await writeLockfile(file, lock, realFs);
    const got = await readLockfile(file, realFs);
    expect(got).toStrictEqual(lock);
  });

  it('upsertEntry replaces an existing target+bundleId pair', () => {
    const lock: Lockfile = {
      schemaVersion: 1,
      entries: [entry({ bundleVersion: '1.0.0' })]
    };
    const next = upsertEntry(lock, entry({ bundleVersion: '2.0.0' }));
    expect(next.entries.length).toBe(1);
    expect(next.entries[0].bundleVersion).toBe('2.0.0');
  });

  it('upsertEntry appends when target+bundleId differs', () => {
    const lock: Lockfile = {
      schemaVersion: 1,
      entries: [entry()]
    };
    const next = upsertEntry(lock, entry({ bundleId: 'bar' }));
    expect(next.entries.length).toBe(2);
  });

  it('rejects unsupported schemaVersion', async () => {
    const file = path.join(work, 'bad.lock.json');
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 99, entries: [] }));
    await expect(readLockfile(file, realFs)).rejects.toThrow(/schemaVersion 99/);
  });

  it('upsertEntry preserves the schemaVersion (immutability)', () => {
    const lock: Lockfile = { schemaVersion: 1, entries: [] };
    const next = upsertEntry(lock, entry());
    expect(next.schemaVersion).toBe(1);
    expect(lock.entries.length).toBe(0);
    expect(next.entries.length).toBe(1);
  });

  describe('additive sections (D13)', () => {
    it('upsertSource adds to lock.sources without disturbing entries', () => {
      const lock = upsertEntry({ schemaVersion: 1, entries: [] }, entry());
      const next = upsertSource(lock, 'github-abc', {
        type: 'github',
        url: 'https://github.com/o/r'
      });
      expect(next.entries.length).toBe(1);
      expect(next.sources).toStrictEqual({
        'github-abc': { type: 'github', url: 'https://github.com/o/r' }
      });
    });

    it('upsertHub + upsertProfile compose without overwriting siblings', () => {
      let lock: Lockfile = { schemaVersion: 1, entries: [] };
      lock = upsertSource(lock, 'github-abc', { type: 'github', url: 'u1' });
      lock = upsertHub(lock, 'h1', { name: 'My Hub', url: 'u2' });
      lock = upsertProfile(lock, 'p1', { name: 'Profile', bundleIds: ['foo'] });
      expect(Object.keys(lock.sources ?? {}).length).toBe(1);
      expect(Object.keys(lock.hubs ?? {}).length).toBe(1);
      expect(Object.keys(lock.profiles ?? {}).length).toBe(1);
    });

    it('round-trips additive sections through write/read', async () => {
      const file = path.join(work, 'extended.lock.json');
      let lock: Lockfile = { schemaVersion: 1, entries: [] };
      lock = upsertEntry(lock, entry());
      lock = upsertSource(lock, 'github-abc', {
        type: 'github',
        url: 'https://github.com/o/r',
        branch: 'main'
      });
      lock = upsertHub(lock, 'h1', { name: 'Hub', url: 'h.example.com' });
      await writeLockfile(file, lock, realFs);
      const back = await readLockfile(file, realFs);
      expect(back.sources).toStrictEqual(lock.sources);
      expect(back.hubs).toStrictEqual(lock.hubs);
    });

    it('upsertUseProfile sets and clears the linkage (D24)', async () => {
      const { upsertUseProfile } = await import('../src/install/lockfile');
      let lock: Lockfile = { schemaVersion: 1, entries: [] };
      lock = upsertUseProfile(lock, { hubId: 'h', profileId: 'p' });
      expect(lock.useProfile).toStrictEqual({ hubId: 'h', profileId: 'p' });
      lock = upsertUseProfile(lock, null);
      expect(lock.useProfile).toBeUndefined();
    });

    it('useProfile round-trips through write/read', async () => {
      const { upsertUseProfile } = await import('../src/install/lockfile');
      const file = path.join(work, 'with-profile.lock.json');
      let lock: Lockfile = { schemaVersion: 1, entries: [] };
      lock = upsertUseProfile(lock, { hubId: 'h', profileId: 'p' });
      await writeLockfile(file, lock, realFs);
      const back = await readLockfile(file, realFs);
      expect(back.useProfile).toStrictEqual({ hubId: 'h', profileId: 'p' });
    });

    it('reads a lockfile without optional sections (back-compat)', async () => {
      const file = path.join(work, 'minimal.lock.json');
      await fs.writeFile(file, JSON.stringify({
        schemaVersion: 1,
        entries: [entry()]
      }));
      const lock = await readLockfile(file, realFs);
      expect(lock.entries.length).toBe(1);
      expect(lock.sources).toBeUndefined();
      expect(lock.hubs).toBeUndefined();
    });
  });

  it('rejects entries that is not an array', async () => {
    const file = path.join(work, 'bad.lock.json');
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, entries: 'nope' }));
    await expect(readLockfile(file, realFs)).rejects.toThrow(/must be an array/);
  });
});

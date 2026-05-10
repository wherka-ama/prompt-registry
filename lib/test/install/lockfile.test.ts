/**
 * Phase 5 / Iter 26 — lockfile tests.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  type Lockfile,
  type LockfileEntry,
  readLockfile,
  upsertEntry,
  upsertHub,
  upsertProfile,
  upsertSource,
  writeLockfile,
} from '../../src/install/lockfile';
import {
  createNodeFsAdapter,
} from '../cli/helpers/node-fs-adapter';

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

describe('Phase 5 / Iter 26 — lockfile', () => {
  it('readLockfile returns the empty lockfile when absent', async () => {
    const got = await readLockfile(path.join(work, 'p.lock.json'), realFs);
    assert.deepStrictEqual(got, { schemaVersion: 1, entries: [] });
  });

  it('write + read round-trip preserves entries', async () => {
    const file = path.join(work, 'p.lock.json');
    const lock: Lockfile = { schemaVersion: 1, entries: [entry()] };
    await writeLockfile(file, lock, realFs);
    const got = await readLockfile(file, realFs);
    assert.deepStrictEqual(got, lock);
  });

  it('upsertEntry replaces an existing target+bundleId pair', () => {
    const lock: Lockfile = {
      schemaVersion: 1,
      entries: [entry({ bundleVersion: '1.0.0' })]
    };
    const next = upsertEntry(lock, entry({ bundleVersion: '2.0.0' }));
    assert.strictEqual(next.entries.length, 1);
    assert.strictEqual(next.entries[0].bundleVersion, '2.0.0');
  });

  it('upsertEntry appends when target+bundleId differs', () => {
    const lock: Lockfile = {
      schemaVersion: 1,
      entries: [entry()]
    };
    const next = upsertEntry(lock, entry({ bundleId: 'bar' }));
    assert.strictEqual(next.entries.length, 2);
  });

  it('rejects unsupported schemaVersion', async () => {
    const file = path.join(work, 'bad.lock.json');
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 99, entries: [] }));
    await assert.rejects(() => readLockfile(file, realFs), /schemaVersion 99/);
  });

  it('upsertEntry preserves the schemaVersion (immutability)', () => {
    const lock: Lockfile = { schemaVersion: 1, entries: [] };
    const next = upsertEntry(lock, entry());
    assert.strictEqual(next.schemaVersion, 1);
    // Pure function: input is not mutated.
    assert.strictEqual(lock.entries.length, 0);
    assert.strictEqual(next.entries.length, 1);
  });

  describe('Phase 5 spillover / iter 13 - additive sections (D13)', () => {
    it('upsertSource adds to lock.sources without disturbing entries', () => {
      const lock = upsertEntry({ schemaVersion: 1, entries: [] }, entry());
      const next = upsertSource(lock, 'github-abc', {
        type: 'github',
        url: 'https://github.com/o/r'
      });
      assert.strictEqual(next.entries.length, 1);
      assert.deepStrictEqual(next.sources, {
        'github-abc': { type: 'github', url: 'https://github.com/o/r' }
      });
    });

    it('upsertHub + upsertProfile compose without overwriting siblings', () => {
      let lock: Lockfile = { schemaVersion: 1, entries: [] };
      lock = upsertSource(lock, 'github-abc', { type: 'github', url: 'u1' });
      lock = upsertHub(lock, 'h1', { name: 'My Hub', url: 'u2' });
      lock = upsertProfile(lock, 'p1', { name: 'Profile', bundleIds: ['foo'] });
      assert.strictEqual(Object.keys(lock.sources ?? {}).length, 1);
      assert.strictEqual(Object.keys(lock.hubs ?? {}).length, 1);
      assert.strictEqual(Object.keys(lock.profiles ?? {}).length, 1);
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
      assert.deepStrictEqual(back.sources, lock.sources);
      assert.deepStrictEqual(back.hubs, lock.hubs);
    });

    it('upsertUseProfile sets and clears the linkage (D24)', async () => {
      const { upsertUseProfile } = await import('../../src/install/lockfile');
      let lock: Lockfile = { schemaVersion: 1, entries: [] };
      lock = upsertUseProfile(lock, { hubId: 'h', profileId: 'p' });
      assert.deepStrictEqual(lock.useProfile, { hubId: 'h', profileId: 'p' });
      lock = upsertUseProfile(lock, null);
      assert.strictEqual(lock.useProfile, undefined);
    });

    it('useProfile round-trips through write/read', async () => {
      const { upsertUseProfile } = await import('../../src/install/lockfile');
      const file = path.join(work, 'with-profile.lock.json');
      let lock: Lockfile = { schemaVersion: 1, entries: [] };
      lock = upsertUseProfile(lock, { hubId: 'h', profileId: 'p' });
      await writeLockfile(file, lock, realFs);
      const back = await readLockfile(file, realFs);
      assert.deepStrictEqual(back.useProfile, { hubId: 'h', profileId: 'p' });
    });

    it('reads a lockfile without optional sections (back-compat)', async () => {
      const file = path.join(work, 'minimal.lock.json');
      await fs.writeFile(file, JSON.stringify({
        schemaVersion: 1,
        entries: [entry()]
      }));
      const lock = await readLockfile(file, realFs);
      assert.strictEqual(lock.entries.length, 1);
      assert.strictEqual(lock.sources, undefined);
      assert.strictEqual(lock.hubs, undefined);
    });
  });

  it('rejects entries that is not an array', async () => {
    const file = path.join(work, 'bad.lock.json');
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, entries: 'nope' }));
    await assert.rejects(() => readLockfile(file, realFs), /must be an array/);
  });
});

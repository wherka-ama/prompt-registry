/**
 * Coverage tests for infra/stores/json-lockfile-store.ts.
 *
 * Tests lockfile functions: readLockfile, writeLockfile, upsertEntry,
 * upsertSource, upsertHub, upsertProfile, upsertUseProfile, removeEntry.
 */
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  type Lockfile,
  type LockfileEntry,
  type LockfileFs,
  type LockfileHub,
  type LockfileProfile,
  type LockfileSource,
  type LockfileUseProfile,
  readLockfile,
  removeEntry,
  upsertEntry,
  upsertHub,
  upsertProfile,
  upsertSource,
  upsertUseProfile,
  writeLockfile,
} from '../src/infra/stores/json-lockfile-store';

describe('readLockfile', () => {
  const mockFs: LockfileFs = {
    readFile: vi.fn() as any,
    writeFile: vi.fn() as any,
    exists: vi.fn() as any
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty lockfile when file does not exist', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    vi.mocked(mockFs.exists).mockResolvedValue(false);
    const lock = await readLockfile('/path/to/lock.json', mockFs);
    expect(lock).toEqual({ schemaVersion: 1, entries: [] });
  });

  it('parses valid lockfile', async () => {
    const validLock: Lockfile = {
      schemaVersion: 1,
      entries: [
        {
          target: 'test',
          sourceId: 'owner/repo',
          bundleId: 'test-bundle',
          bundleVersion: '1.0.0',
          installedAt: '2024-01-01T00:00:00Z',
          files: []
        }
      ]
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    vi.mocked(mockFs.exists).mockResolvedValue(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    vi.mocked(mockFs.readFile).mockResolvedValue(JSON.stringify(validLock));
    const lock = await readLockfile('/path/to/lock.json', mockFs);
    expect(lock.entries).toHaveLength(1);
  });

  it('throws error on unsupported schema version', async () => {
    const invalidLock = { schemaVersion: 2, entries: [] };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    vi.mocked(mockFs.exists).mockResolvedValue(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    vi.mocked(mockFs.readFile).mockResolvedValue(JSON.stringify(invalidLock));
    await expect(readLockfile('/path/to/lock.json', mockFs)).rejects.toThrow(
      'unsupported lockfile schemaVersion 2'
    );
  });

  it('throws error when entries is not an array', async () => {
    const invalidLock = { schemaVersion: 1, entries: {} };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    vi.mocked(mockFs.exists).mockResolvedValue(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    vi.mocked(mockFs.readFile).mockResolvedValue(JSON.stringify(invalidLock));
    await expect(readLockfile('/path/to/lock.json', mockFs)).rejects.toThrow(
      'lockfile entries must be an array'
    );
  });

  it('throws error on invalid JSON', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    vi.mocked(mockFs.exists).mockResolvedValue(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    vi.mocked(mockFs.readFile).mockResolvedValue('invalid json');
    await expect(readLockfile('/path/to/lock.json', mockFs)).rejects.toThrow();
  });
});

describe('writeLockfile', () => {
  const mockFs: LockfileFs = {
    readFile: vi.fn() as any,
    writeFile: vi.fn() as any,
    exists: vi.fn() as any,
    mkdir: vi.fn() as any
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes lockfile as pretty JSON', async () => {
    const lock: Lockfile = { schemaVersion: 1, entries: [] };
    await writeLockfile('/path/to/lock.json', lock, mockFs);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    expect(vi.mocked(mockFs.writeFile)).toHaveBeenCalledWith(
      '/path/to/lock.json',
      JSON.stringify(lock, null, 2) + '\n'
    );
  });

  it('creates parent directory when mkdir is available', async () => {
    const lock: Lockfile = { schemaVersion: 1, entries: [] };
    await writeLockfile('/path/to/lock.json', lock, mockFs);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    expect(vi.mocked(mockFs.mkdir)).toHaveBeenCalledWith('/path/to', { recursive: true });
  });

  it('does not create directory when mkdir is not available', async () => {
    const fsWithoutMkdir: LockfileFs = {
      readFile: vi.fn() as any,
      writeFile: vi.fn() as any,
      exists: vi.fn() as any
    };
    const lock: Lockfile = { schemaVersion: 1, entries: [] };
    await writeLockfile('/path/to/lock.json', lock, fsWithoutMkdir);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    expect(vi.mocked(fsWithoutMkdir.writeFile)).toHaveBeenCalled();
  });
});

describe('upsertEntry', () => {
  it('adds new entry to empty lockfile', () => {
    const lock: Lockfile = { schemaVersion: 1, entries: [] };
    const entry: LockfileEntry = {
      target: 'test',
      sourceId: 'owner/repo',
      bundleId: 'test-bundle',
      bundleVersion: '1.0.0',
      installedAt: '2024-01-01T00:00:00Z',
      files: []
    };
    const result = upsertEntry(lock, entry);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toEqual(entry);
  });

  it('replaces existing entry with same target and bundleId', () => {
    const lock: Lockfile = {
      schemaVersion: 1,
      entries: [
        {
          target: 'test',
          sourceId: 'owner/repo',
          bundleId: 'test-bundle',
          bundleVersion: '1.0.0',
          installedAt: '2024-01-01T00:00:00Z',
          files: []
        }
      ]
    };
    const newEntry: LockfileEntry = {
      target: 'test',
      sourceId: 'owner/repo',
      bundleId: 'test-bundle',
      bundleVersion: '2.0.0',
      installedAt: '2024-01-02T00:00:00Z',
      files: []
    };
    const result = upsertEntry(lock, newEntry);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].bundleVersion).toBe('2.0.0');
  });

  it('does not mutate input lockfile', () => {
    const lock: Lockfile = { schemaVersion: 1, entries: [] };
    const entry: LockfileEntry = {
      target: 'test',
      sourceId: 'owner/repo',
      bundleId: 'test-bundle',
      bundleVersion: '1.0.0',
      installedAt: '2024-01-01T00:00:00Z',
      files: []
    };
    const originalEntries = lock.entries;
    upsertEntry(lock, entry);
    expect(lock.entries).toBe(originalEntries);
  });
});

describe('upsertSource', () => {
  it('adds source to lockfile', () => {
    const lock: Lockfile = { schemaVersion: 1, entries: [] };
    const source: LockfileSource = {
      type: 'github',
      url: 'https://github.com/owner/repo'
    };
    const updated = upsertSource(lock, 'github-owner-repo', source);
    expect(updated.sources).toBeDefined();
    expect(updated.sources!['github-owner-repo']).toEqual(source);
  });

  it('replaces existing source with same sourceId', () => {
    const lock: Lockfile = {
      schemaVersion: 1,
      entries: [],
      sources: { 'github-owner-repo': { type: 'github', url: 'https://github.com/owner/repo' } }
    };
    const newSource: LockfileSource = {
      type: 'github',
      url: 'https://github.com/owner/repo',
      branch: 'develop'
    };
    const updated = upsertSource(lock, 'github-owner-repo', newSource);
    expect(updated.sources!['github-owner-repo'].branch).toBe('develop');
  });
});

describe('upsertHub', () => {
  it('adds hub to lockfile', () => {
    const lock: Lockfile = { schemaVersion: 1, entries: [] };
    const hub: LockfileHub = {
      name: 'Test Hub',
      url: 'https://github.com/owner/hub'
    };
    const updated = upsertHub(lock, 'owner-hub', hub);
    expect(updated.hubs).toBeDefined();
    expect(updated.hubs!['owner-hub']).toEqual(hub);
  });
});

describe('upsertProfile', () => {
  it('adds profile to lockfile', () => {
    const lock: Lockfile = { schemaVersion: 1, entries: [] };
    const profile: LockfileProfile = {
      name: 'Test Profile',
      bundleIds: ['bundle1', 'bundle2']
    };
    const updated = upsertProfile(lock, 'test-profile', profile);
    expect(updated.profiles).toBeDefined();
    expect(updated.profiles!['test-profile']).toEqual(profile);
  });
});

describe('upsertUseProfile', () => {
  it('sets useProfile link', () => {
    const lock: Lockfile = { schemaVersion: 1, entries: [] };
    const useProfile: LockfileUseProfile = {
      hubId: 'test-hub',
      profileId: 'test-profile'
    };
    const updated = upsertUseProfile(lock, useProfile);
    expect(updated.useProfile).toEqual(useProfile);
  });

  it('clears useProfile when passed null', () => {
    const lock: Lockfile = {
      schemaVersion: 1,
      entries: [],
      useProfile: { hubId: 'test-hub', profileId: 'test-profile' }
    };
    const updated = upsertUseProfile(lock, null);
    expect(updated.useProfile).toBeUndefined();
  });
});

describe('removeEntry', () => {
  it('removes entry matching target and bundleId', () => {
    const lock: Lockfile = {
      schemaVersion: 1,
      entries: [
        {
          target: 'test',
          sourceId: 'owner/repo',
          bundleId: 'test-bundle',
          bundleVersion: '1.0.0',
          installedAt: '2024-01-01T00:00:00Z',
          files: []
        },
        {
          target: 'other',
          sourceId: 'owner/repo',
          bundleId: 'other-bundle',
          bundleVersion: '1.0.0',
          installedAt: '2024-01-01T00:00:00Z',
          files: []
        }
      ]
    };
    const toRemove: LockfileEntry = {
      target: 'test',
      sourceId: 'owner/repo',
      bundleId: 'test-bundle',
      bundleVersion: '1.0.0',
      installedAt: '2024-01-01T00:00:00Z',
      files: []
    };
    const updated = removeEntry(lock, toRemove);
    expect(updated.entries).toHaveLength(1);
    expect(updated.entries[0].bundleId).toBe('other-bundle');
  });

  it('does not mutate input lockfile', () => {
    const lock: Lockfile = {
      schemaVersion: 1,
      entries: [
        {
          target: 'test',
          sourceId: 'owner/repo',
          bundleId: 'test-bundle',
          bundleVersion: '1.0.0',
          installedAt: '2024-01-01T00:00:00Z',
          files: []
        }
      ]
    };
    const toRemove: LockfileEntry = {
      target: 'test',
      sourceId: 'owner/repo',
      bundleId: 'test-bundle',
      bundleVersion: '1.0.0',
      installedAt: '2024-01-01T00:00:00Z',
      files: []
    };
    const originalEntries = lock.entries;
    removeEntry(lock, toRemove);
    expect(lock.entries).toBe(originalEntries);
  });
});

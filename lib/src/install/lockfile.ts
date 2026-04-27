/**
 * Phase 5 / Iter 25-26 — install lockfile.
 *
 * The lockfile (`prompt-registry.lock.json` by default) records every
 * installed bundle so a subsequent `prompt-registry install --lockfile`
 * is reproducible. Format mirrors the VS Code extension's repository-
 * scope lockfile: an ordered list of entries keyed on
 * `target + sourceId + bundleId`.
 *
 * Schema is stable from this iter on; future fields land additively.
 */

export interface LockfileEntry {
  /** Target name the bundle was installed into. */
  target: string;
  /** Source identifier (e.g., `owner/repo`); empty when local-only. */
  sourceId: string;
  /** Bundle id. */
  bundleId: string;
  /** Resolved version. */
  bundleVersion: string;
  /** SHA-256 of the bundle bytes (when downloaded). */
  sha256?: string;
  /** ISO 8601 timestamp of the install. */
  installedAt: string;
  /**
   * List of bundle-relative file paths written. Strings for
   * back-compat with iter-25 schema; readers tolerate both.
   *
   * When iter-12 (D13) has computed checksums, the same logical
   * file is also recorded in `fileChecksums` (parallel array).
   * Future iters may collapse to `LockfileFileEntry[]` once all
   * known consumers handle the richer shape.
   */
  files: string[];
  /**
   * Optional per-file SHA-256 sums, parallel to `files`. Emitted
   * only when populated; matches extension's
   * `LockfileFileEntry.checksum` semantics. (D13)
   */
  fileChecksums?: Record<string, string>;
}

/**
 * Source descriptor recorded in the lockfile so reproducible installs
 * can replay against the same upstream. Mirrors the extension's
 * `LockfileSourceEntry`. (D13)
 */
export interface LockfileSource {
  /** Source type (github, awesome-copilot, apm, skills, local, …). */
  type: string;
  /** Source URL (or local path). */
  url: string;
  /** Optional git branch for git-based sources. */
  branch?: string;
}

/** Hub descriptor — mirrors extension's LockfileHubEntry. (D13) */
export interface LockfileHub {
  /** Display name. */
  name: string;
  /** Hub config URL. */
  url: string;
}

/** Profile descriptor — mirrors extension's LockfileProfileEntry. (D13) */
export interface LockfileProfile {
  /** Display name. */
  name: string;
  /** Member bundle ids. */
  bundleIds: string[];
}

/**
 * D24: optional pointer linking a project to a (hubId, profileId).
 * Set by `profile activate` (Phase 6 / iter 88) and consumed by
 * `install --lockfile` replay (iter 89) so a fresh checkout re-runs
 * the same profile activation.
 */
export interface LockfileUseProfile {
  hubId: string;
  profileId: string;
}

export interface Lockfile {
  schemaVersion: 1;
  entries: LockfileEntry[];
  /**
   * D24: project<->profile linkage. When set, install --lockfile
   * replay will also re-activate this profile after replaying
   * entries. Unset projects work as before.
   */
  useProfile?: LockfileUseProfile;
  /**
   * Optional source registry; emitted only when populated.
   * Keys are sourceIds produced by `generateSourceId(type, url, …)`. (D13)
   */
  sources?: Record<string, LockfileSource>;
  /** Optional hub registry; emitted only when populated. (D13) */
  hubs?: Record<string, LockfileHub>;
  /** Optional profile registry; emitted only when populated. (D13) */
  profiles?: Record<string, LockfileProfile>;
}

const EMPTY: Lockfile = { schemaVersion: 1, entries: [] };

export interface LockfileFs {
  readFile(p: string): Promise<string>;
  writeFile(p: string, contents: string): Promise<void>;
  exists(p: string): Promise<boolean>;
  mkdir?(p: string, opts?: { recursive?: boolean }): Promise<void>;
}

/**
 * Read a lockfile from disk; returns the empty lockfile when absent.
 * @param file - Absolute lockfile path.
 * @param fs - LockfileFs adapter.
 * @returns Parsed Lockfile.
 * @throws {Error} On schemaVersion mismatch or invalid JSON.
 */
export const readLockfile = async (file: string, fs: LockfileFs): Promise<Lockfile> => {
  if (!(await fs.exists(file))) {
    return { ...EMPTY };
  }
  const raw = await fs.readFile(file);
  const parsed = JSON.parse(raw) as Lockfile;
  if (parsed.schemaVersion !== 1) {
    throw new Error(`unsupported lockfile schemaVersion ${String(parsed.schemaVersion)}`);
  }
  if (!Array.isArray(parsed.entries)) {
    throw new Error('lockfile entries must be an array');
  }
  return parsed;
};

/**
 * Write a lockfile to disk (pretty-printed JSON for diff-friendliness).
 * @param file - Absolute lockfile path.
 * @param lock - Lockfile to write.
 * @param fs - LockfileFs adapter.
 */
export const writeLockfile = async (
  file: string,
  lock: Lockfile,
  fs: LockfileFs
): Promise<void> => {
  if (fs.mkdir !== undefined) {
    const dir = file.replace(/[/\\][^/\\]*$/, '');
    if (dir.length > 0 && dir !== file) {
      await fs.mkdir(dir, { recursive: true });
    }
  }
  await fs.writeFile(file, JSON.stringify(lock, null, 2) + '\n');
};

/**
 * Upsert an entry into a lockfile (matching by target + bundleId).
 * Pure; doesn't touch disk.
 * @param lock - Existing Lockfile.
 * @param entry - Entry to add or replace.
 * @returns New Lockfile (input is not mutated).
 */
export const upsertEntry = (lock: Lockfile, entry: LockfileEntry): Lockfile => {
  const next = lock.entries.filter(
    (e) => !(e.target === entry.target && e.bundleId === entry.bundleId)
  );
  next.push(entry);
  return { ...lock, schemaVersion: 1, entries: next };
};

/**
 * Upsert a source descriptor in `lock.sources`. Pure; doesn't touch
 * disk. (D13 / iter 12)
 * @param lock - Existing Lockfile.
 * @param sourceId - Stable source id (`generateSourceId` output).
 * @param source - Source descriptor.
 * @returns New Lockfile (input is not mutated).
 */
export const upsertSource = (
  lock: Lockfile,
  sourceId: string,
  source: LockfileSource
): Lockfile => ({
  ...lock,
  schemaVersion: 1,
  sources: { ...lock.sources, [sourceId]: source }
});

/**
 * Upsert a hub descriptor in `lock.hubs`. (D13 / iter 12)
 * @param lock - Existing Lockfile.
 * @param hubKey - Stable hub key (`generateHubKey` output).
 * @param hub - Hub descriptor.
 * @returns New Lockfile (input is not mutated).
 */
export const upsertHub = (
  lock: Lockfile,
  hubKey: string,
  hub: LockfileHub
): Lockfile => ({
  ...lock,
  schemaVersion: 1,
  hubs: { ...lock.hubs, [hubKey]: hub }
});

/**
 * Upsert a profile descriptor in `lock.profiles`. (D13 / iter 12)
 * @param lock - Existing Lockfile.
 * @param profileId - Profile id.
 * @param profile - Profile descriptor.
 * @returns New Lockfile (input is not mutated).
 */
export const upsertProfile = (
  lock: Lockfile,
  profileId: string,
  profile: LockfileProfile
): Lockfile => ({
  ...lock,
  schemaVersion: 1,
  profiles: { ...lock.profiles, [profileId]: profile }
});

/**
 * D24: set or clear the `useProfile` link.
 * @param lock Existing lockfile.
 * @param useProfile The link to set; pass `null` to clear.
 * @returns Updated lockfile.
 */
export const upsertUseProfile = (
  lock: Lockfile,
  useProfile: LockfileUseProfile | null
): Lockfile => {
  if (useProfile === null) {
    const next: Lockfile = { ...lock, schemaVersion: 1 };
    delete next.useProfile;
    return next;
  }
  return { ...lock, schemaVersion: 1, useProfile };
};

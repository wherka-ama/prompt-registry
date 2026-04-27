/**
 * Phase 6 / Iter 25 — ActiveHubStore.
 *
 * Persists "which hub is active right now" as a tiny JSON pointer.
 * Singleton across all hubs (D21 mirror at the hub level: the
 * profile invariant builds on top of the active-hub invariant).
 */
import {
  type FsAbstraction,
} from '../cli/framework';

interface ActiveHubFile {
  hubId: string | null;
  setAt: string;
}

/** Filesystem-backed active-hub pointer. */
export class ActiveHubStore {
  /**
   * @param activeHubPath Resolved path of `active-hub.json`.
   * @param fs Filesystem abstraction.
   */
  public constructor(
    private readonly activeHubPath: string,
    private readonly fs: FsAbstraction
  ) {}

  /**
   * Get the active hub id, if any.
   * @returns Active hub id or null.
   */
  public async get(): Promise<string | null> {
    if (!(await this.fs.exists(this.activeHubPath))) {
      return null;
    }
    try {
      const data = await this.fs.readJson<ActiveHubFile>(this.activeHubPath);
      return data.hubId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Set the active hub id, or clear it with `null`.
   * @param hubId Hub id (already sanitized) or null.
   */
  public async set(hubId: string | null): Promise<void> {
    if (hubId === null) {
      if (await this.fs.exists(this.activeHubPath)) {
        await this.fs.remove(this.activeHubPath);
      }
      return;
    }
    await this.fs.writeJson(this.activeHubPath, {
      hubId,
      setAt: new Date().toISOString()
    });
  }
}

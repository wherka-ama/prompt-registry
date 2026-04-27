/**
 * Phase 6 / Iter 26-27 — ProfileActivationStore (D21, D22).
 *
 * Persists `ProfileActivationState` per (hubId, profileId) under
 * `<userConfig>/profile-activations/`. The store enforces D21
 * (single-active-profile-globally) at the API level: there is no
 * `setMany` and `get()` returns the single active state if any.
 */
import * as path from 'node:path';
import {
  type FsAbstraction,
} from '../cli/framework';
import {
  type ProfileActivationState,
} from '../domain/registry';

/**
 * Filesystem-backed profile-activation store. Lives at
 * `<userConfig>/profile-activations/{hubId}_{profileId}.json`.
 */
export class ProfileActivationStore {
  /**
   * @param dir Resolved path of the activations directory.
   * @param fs Filesystem abstraction.
   */
  public constructor(
    private readonly dir: string,
    private readonly fs: FsAbstraction
  ) {}

  /**
   * Persist an activation state. Caller is expected to have
   * cleared any previously-active profile first (D21).
   * @param state Activation state.
   */
  public async save(state: ProfileActivationState): Promise<void> {
    await this.fs.mkdir(this.dir, { recursive: true });
    await this.fs.writeJson(this.statePath(state.hubId, state.profileId), state);
  }

  /**
   * Read an activation state.
   * @param hubId Hub id.
   * @param profileId Profile id.
   * @returns State or null when no activation file exists.
   */
  public async load(hubId: string, profileId: string): Promise<ProfileActivationState | null> {
    const p = this.statePath(hubId, profileId);
    if (!(await this.fs.exists(p))) {
      return null;
    }
    return this.fs.readJson<ProfileActivationState>(p);
  }

  /**
   * Delete an activation state. No-op when missing.
   * @param hubId Hub id.
   * @param profileId Profile id.
   */
  public async remove(hubId: string, profileId: string): Promise<void> {
    const p = this.statePath(hubId, profileId);
    if (await this.fs.exists(p)) {
      await this.fs.remove(p);
    }
  }

  /**
   * Get the single active profile across all hubs (D21).
   * Throws if more than one activation file is present (corrupt
   * state); callers may catch and remediate.
   * @returns The active state or null.
   */
  public async getActive(): Promise<ProfileActivationState | null> {
    if (!(await this.fs.exists(this.dir))) {
      return null;
    }
    const files = (await this.fs.readDir(this.dir)).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      return null;
    }
    if (files.length > 1) {
      throw new Error(
        `D21 violation: ${String(files.length)} active profiles on disk, expected at most 1: ${files.join(', ')}`
      );
    }
    return this.fs.readJson<ProfileActivationState>(path.join(this.dir, files[0]));
  }

  /**
   * List all activation states (debug / diagnostics).
   * @returns All on-disk activation states.
   */
  public async listAll(): Promise<ProfileActivationState[]> {
    if (!(await this.fs.exists(this.dir))) {
      return [];
    }
    const files = (await this.fs.readDir(this.dir)).filter((f) => f.endsWith('.json'));
    const out: ProfileActivationState[] = [];
    for (const f of files) {
      out.push(await this.fs.readJson<ProfileActivationState>(path.join(this.dir, f)));
    }
    return out;
  }

  private statePath(hubId: string, profileId: string): string {
    return path.join(this.dir, `${hubId}_${profileId}.json`);
  }
}

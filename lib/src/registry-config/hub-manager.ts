/**
 * Phase 6 / Iter 41-50 — HubManager (lib).
 *
 * Orchestrates HubStore + ActiveHubStore + HubResolver to provide
 * the import / list / use / sync / remove / detached-source flow.
 * Mirrors the extension's `HubManager` (without vscode.* deps).
 *
 * Default-local-hub synthesis (D23): on first detached
 * `addDetachedSource()`, the manager auto-creates a synthetic hub
 * with id `default-local` whose `sources[]` accumulates every
 * detached source the user adds. Detached sources are not
 * orphaned; they are always discoverable through `listSources()`.
 */
import {
  DEFAULT_LOCAL_HUB_ID,
  type HubConfig,
  type HubReference,
  type RegistrySource,
} from '../domain/registry';
import {
  ActiveHubStore,
} from './active-hub-store';
import {
  type HubResolver,
  type ResolvedHub,
} from './hub-resolver';
import {
  HubStore,
} from './hub-store';

export interface HubInfo {
  id: string;
  config: HubConfig;
  reference: HubReference;
}

/** Lib-side counterpart of the extension's `HubManager`. */
export class HubManager {
  /**
   * @param store HubStore for persistence.
   * @param activeStore ActiveHubStore for the active-hub pointer.
   * @param resolver HubResolver to fetch configs from references.
   */
  public constructor(
    private readonly store: HubStore,
    private readonly activeStore: ActiveHubStore,
    private readonly resolver: HubResolver
  ) {}

  /**
   * Import a hub from its reference. Persists the config + sets
   * it as active when no active hub yet exists.
   * @param reference Hub reference.
   * @param hubId Optional explicit id (sanitized).
   * @returns Saved hub id.
   */
  public async importHub(reference: HubReference, hubId?: string): Promise<string> {
    const resolved = await this.resolver.resolve(reference);
    const id = hubId ?? this.deriveId(resolved.config.metadata.name);
    if (id === DEFAULT_LOCAL_HUB_ID) {
      throw new Error(`Reserved hub id: ${DEFAULT_LOCAL_HUB_ID}`);
    }
    const safeId = await this.store.save(id, resolved.config, resolved.reference);
    if ((await this.activeStore.get()) === null) {
      await this.activeStore.set(safeId);
    }
    return safeId;
  }

  /**
   * List every hub on disk (id+name+description).
   * @returns Lightweight info entries.
   */
  public async listHubs(): Promise<{ id: string; name: string; description: string }[]> {
    const ids = await this.store.list();
    const out: { id: string; name: string; description: string }[] = [];
    for (const id of ids) {
      try {
        const h = await this.store.load(id);
        out.push({ id, name: h.config.metadata.name, description: h.config.metadata.description });
      } catch {
        // skip malformed
      }
    }
    return out;
  }

  /**
   * Get the currently active hub.
   * @returns ResolvedHub-shaped record or null.
   */
  public async getActiveHub(): Promise<HubInfo | null> {
    const id = await this.activeStore.get();
    if (id === null) {
      return null;
    }
    try {
      const h = await this.store.load(id);
      return { id: h.id, config: h.config, reference: h.reference };
    } catch {
      // active pointer is stale; clear it
      await this.activeStore.set(null);
      return null;
    }
  }

  /**
   * Set the active hub. Throws when the hub is not on disk
   * (unless `null` is passed to clear).
   * @param hubId Hub id or null.
   */
  public async useHub(hubId: string | null): Promise<void> {
    if (hubId !== null && !(await this.store.has(hubId))) {
      throw new Error(`Hub not found: ${hubId}`);
    }
    await this.activeStore.set(hubId);
  }

  /**
   * I-007: probe whether a hub is still reachable upstream by
   * re-resolving its reference. Returns `'ok'` on success, `'error'`
   * with a short reason on failure. Never throws.
   * @param hubId Hub id.
   * @returns Reachability outcome.
   */
  public async checkHub(hubId: string): Promise<{ status: 'ok' | 'error'; reason?: string }> {
    try {
      const existing = await this.store.load(hubId);
      await this.resolver.resolve(existing.reference);
      return { status: 'ok' };
    } catch (cause) {
      return { status: 'error', reason: (cause as Error).message };
    }
  }

  /**
   * Re-fetch a hub's config from its recorded reference and
   * persist the updated version.
   * @param hubId Hub id.
   */
  public async syncHub(hubId: string): Promise<void> {
    const existing = await this.store.load(hubId);
    const resolved = await this.resolver.resolve(existing.reference);
    await this.store.save(hubId, resolved.config, existing.reference);
  }

  /**
   * Remove a hub. If the active hub matches, the active pointer
   * is cleared.
   * @param hubId Hub id.
   */
  public async removeHub(hubId: string): Promise<void> {
    await this.store.remove(hubId);
    if ((await this.activeStore.get()) === hubId) {
      await this.activeStore.set(null);
    }
  }

  /**
   * Aggregate sources from a chosen hub (default: active).
   * @param hubId Optional hub id; defaults to active.
   * @returns Sources or empty list when no hub is active.
   */
  public async listSources(hubId?: string): Promise<RegistrySource[]> {
    let resolvedId = hubId;
    if (resolvedId === undefined) {
      resolvedId = (await this.activeStore.get()) ?? undefined;
      if (resolvedId === undefined) {
        return [];
      }
    }
    const h = await this.store.load(resolvedId);
    return h.config.sources.map((s) => ({ ...s, hubId: h.id }));
  }

  /**
   * List sources across **every** hub on disk (used by
   * `source list`). Each source carries its `hubId`.
   * @returns Flattened source list.
   */
  public async listSourcesAcrossAllHubs(): Promise<RegistrySource[]> {
    const ids = await this.store.list();
    const out: RegistrySource[] = [];
    for (const id of ids) {
      try {
        const h = await this.store.load(id);
        for (const s of h.config.sources) {
          out.push({ ...s, hubId: h.id });
        }
      } catch {
        // skip malformed
      }
    }
    return out;
  }

  /**
   * Add a detached source. Creates the synthetic `default-local`
   * hub on first call (D23). Returns the (possibly auto-generated)
   * sourceId.
   * @param source Source to add (its hubId is ignored — always set to default-local).
   * @returns The persisted source.
   */
  public async addDetachedSource(source: Omit<RegistrySource, 'hubId'>): Promise<RegistrySource> {
    const finalSource: RegistrySource = { ...source, hubId: DEFAULT_LOCAL_HUB_ID };
    let cfg: HubConfig;
    let ref: HubReference;
    if (await this.store.has(DEFAULT_LOCAL_HUB_ID)) {
      const loaded = await this.store.load(DEFAULT_LOCAL_HUB_ID);
      cfg = loaded.config;
      ref = loaded.reference;
    } else {
      cfg = {
        version: '1.0.0',
        metadata: {
          name: 'Local sources',
          description: 'Auto-managed default-local hub for detached sources (D23).',
          maintainer: 'cli',
          updatedAt: new Date().toISOString()
        },
        sources: [],
        profiles: []
      };
      ref = { type: 'local', location: 'default-local' };
    }
    // Replace any existing source with the same id; otherwise append.
    const filtered = cfg.sources.filter((s) => s.id !== finalSource.id);
    cfg = { ...cfg, sources: [...filtered, finalSource] };
    await this.store.save(DEFAULT_LOCAL_HUB_ID, cfg, ref);
    return finalSource;
  }

  /**
   * Remove a detached source from the default-local hub. No-op
   * if either hub or source is missing.
   * @param sourceId Source id.
   * @returns true iff a source was actually removed.
   */
  public async removeDetachedSource(sourceId: string): Promise<boolean> {
    if (!(await this.store.has(DEFAULT_LOCAL_HUB_ID))) {
      return false;
    }
    const loaded = await this.store.load(DEFAULT_LOCAL_HUB_ID);
    const before = loaded.config.sources.length;
    const after = loaded.config.sources.filter((s) => s.id !== sourceId);
    if (after.length === before) {
      return false;
    }
    await this.store.save(DEFAULT_LOCAL_HUB_ID, { ...loaded.config, sources: after }, loaded.reference);
    return true;
  }

  private deriveId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

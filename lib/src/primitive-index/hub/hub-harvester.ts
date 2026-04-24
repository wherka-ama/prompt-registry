/**
 * HubHarvester — orchestrates a full harvest over a list of hub sources.
 *
 * Responsibilities:
 *   - Create a per-source BundleProvider (GitHubSingleBundleProvider
 *     today; AwesomeCopilotBundleProvider in iter 13).
 *   - Resolve the latest commit sha for each source and consult the
 *     progress log via shouldResume. If a bundle is already "done" at
 *     that sha, emit a skip event and move on — this is the smart-rebuild
 *     path that makes second and Nth runs near-free.
 *   - Harvest primitives via `harvestBundle` and accumulate.
 *   - Record start/done/error/skip for each bundle so SIGKILL + resume
 *     picks up exactly where we left off.
 *   - Bounded concurrency (p-limit style, without the dep).
 *
 * At the end of the run we materialise a single PrimitiveIndex from the
 * accumulated primitives. Incremental persistence of the index is layered
 * on top in a later iteration (iter 16).
 */

import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import {
  harvestBundle,
} from '../harvester';
import {
  PrimitiveIndex,
} from '../index';
import type {
  Primitive,
} from '../types';
import type {
  BlobFetcher,
} from './blob-fetcher';
import type {
  EtagStore,
} from './etag-store';
import type {
  GitHubApiClient,
} from './github-api-client';
import {
  GitHubSingleBundleProvider,
} from './github-bundle-provider';
import type {
  HubSourceSpec,
} from './hub-config';
import {
  AwesomeCopilotPluginBundleProvider,
} from './plugin-bundle-provider';
import {
  HarvestProgressLog,
  type ProgressSummary,
} from './progress-log';
import {
  resolveCommitSha,
} from './tree-enumerator';

export interface HubHarvesterOptions {
  sources: HubSourceSpec[];
  client: GitHubApiClient;
  blobs: BlobFetcher;
  progressFile: string;
  /** Max number of bundles harvested in parallel. Default 1 (serial). */
  concurrency?: number;
  /** Observer hook for CLI logging, tests, etc. */
  onEvent?: (ev: HubHarvestEvent) => void;
  /**
   * Optional ETag store; enables conditional /commits/:ref lookups so
   * warm runs can answer "did anything change?" with a 304 replay.
   */
  etagStore?: EtagStore;
  /**
   * When true, ignores the progress log's shouldResume() and re-harvests
   * every source. Use to refresh the snapshot after content changes that
   * don't move the commit sha (rare — mainly for forced reindex).
   */
  force?: boolean;
  /**
   * When true, the harvester resolves commit shas and logs what it would
   * do, but never calls into harvestBundle or writes the snapshot. Useful
   * for "how much does this hub cost to ingest" estimates.
   */
  dryRun?: boolean;
}

export type HubHarvestEvent =
  | { kind: 'source-start'; sourceId: string }
  | { kind: 'source-skip'; sourceId: string; commitSha: string; reason: string }
  | { kind: 'source-done'; sourceId: string; commitSha: string; primitives: number; ms: number }
  | { kind: 'source-error'; sourceId: string; error: string };

export interface HubHarvestResult extends ProgressSummary {
  /** Wall-clock total in ms. */
  totalMs: number;
  /**
   * Final index assembled from every successful harvest in this run *and*
   * previously completed bundles carried via cache (iter 16). For now
   * this holds only the primitives newly collected in this run.
   */
  index: PrimitiveIndex;
}

/* eslint-disable @typescript-eslint/member-ordering -- public API kept at top. */
export class HubHarvester {
  public constructor(private readonly opts: HubHarvesterOptions) {}

  public async run(): Promise<HubHarvestResult> {
    const startedAt = Date.now();
    const log = await HarvestProgressLog.open(this.opts.progressFile);
    const snapshot = await loadSnapshot(this.snapshotFile());
    const primitives: Primitive[] = [];
    const concurrency = Math.max(1, this.opts.concurrency ?? 1);

    const queue = [...this.opts.sources];
    const workers: Promise<void>[] = [];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const spec = queue.shift();
        if (!spec) {
          return;
        }
        await this.processSource(spec, log, primitives, snapshot);
      }
    };
    for (let i = 0; i < concurrency; i += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);

    await log.close();

    // Persist a fresh snapshot capturing the latest set of primitives per
    // sourceId so the next warm run can reconstruct the full index.
    const fresh = new Map<string, Primitive[]>();
    for (const p of primitives) {
      const list = fresh.get(p.bundle.sourceId) ?? [];
      list.push(p);
      fresh.set(p.bundle.sourceId, list);
    }
    await saveSnapshot(this.snapshotFile(), fresh);

    const index = PrimitiveIndex.fromPrimitives(primitives);
    const summary = log.summary();
    return {
      ...summary,
      totalMs: Date.now() - startedAt,
      index
    };
  }

  private snapshotFile(): string {
    return path.join(path.dirname(this.opts.progressFile), 'primitives-snapshot.json');
  }

  private async processSource(
    spec: HubSourceSpec,
    log: HarvestProgressLog,
    out: Primitive[],
    snapshot: Map<string, Primitive[]>
  ): Promise<void> {
    const bundleId = spec.id;
    this.opts.onEvent?.({ kind: 'source-start', sourceId: spec.id });
    let commitSha: string | undefined;
    try {
      // Cheap conditional /commits/ check first. If the sha matches what
      // the progress log already marked "done", we skip the entire tree
      // enumeration — the biggest warm-path saving available.
      commitSha = await resolveCommitSha(this.opts.client, {
        owner: spec.owner,
        repo: spec.repo,
        ref: spec.branch,
        etagStore: this.opts.etagStore
      });
      if (!this.opts.force && !log.shouldResume(spec.id, bundleId, commitSha)) {
        await log.recordSkip({
          sourceId: spec.id, bundleId, commitSha,
          reason: 'already-harvested'
        });
        // Reuse previously harvested primitives from the snapshot so the
        // index returned from this run is complete even when every source
        // is skipped. Missing snapshot => skip silently (the user can run
        // with --force to repopulate if they care).
        const cached = snapshot.get(spec.id) ?? [];
        out.push(...cached);
        this.opts.onEvent?.({
          kind: 'source-skip', sourceId: spec.id, commitSha, reason: 'already-harvested'
        });
        return;
      }
      if (this.opts.dryRun) {
        await log.recordSkip({
          sourceId: spec.id, bundleId, commitSha,
          reason: 'dry-run'
        });
        this.opts.onEvent?.({
          kind: 'source-skip', sourceId: spec.id, commitSha, reason: 'dry-run'
        });
        return;
      }
      // Plugin sources expose N bundles per repo (one per plugin), so
      // we dispatch on spec.type and use a different provider + bundle
      // loop. Source-level resume (above) already short-circuits the
      // common "nothing changed in the repo" case for both kinds.
      let primsTotal = 0;
      const startedRepo = Date.now();
      if (spec.type === 'awesome-copilot-plugin') {
        const provider = new AwesomeCopilotPluginBundleProvider({
          spec, client: this.opts.client, blobs: this.opts.blobs,
          etagStore: this.opts.etagStore
        });
        // Collect refs first, then harvest plugins in parallel with the
        // same concurrency cap as the outer source-level loop. Each
        // harvestBundle already fetches its item blobs in parallel, so
        // this adds a second layer of parallelism that scales well
        // because plugins share the blob cache + client rate budget.
        const refs: Parameters<typeof harvestBundle>[1][] = [];
        for await (const ref of provider.listBundles()) {
          refs.push(ref);
        }
        const pluginConcurrency = Math.max(1, this.opts.concurrency ?? 4);
        const sha = commitSha;
        const harvestOne = async (ref: Parameters<typeof harvestBundle>[1]): Promise<number> => {
          const perStart = Date.now();
          await log.recordStart({
            sourceId: spec.id, bundleId: ref.bundleId, commitSha: sha
          });
          const prims = await harvestBundle(provider, ref);
          const ms = Date.now() - perStart;
          // out.push is safe under parallelism because Node is single-threaded;
          // the spread pushes are atomic w.r.t. each other.
          out.push(...prims);
          await log.recordDone({
            sourceId: spec.id, bundleId: ref.bundleId, commitSha: sha,
            primitives: prims.length, ms
          });
          return prims.length;
        };
        for (let i = 0; i < refs.length; i += pluginConcurrency) {
          const batch = refs.slice(i, i + pluginConcurrency);
          const counts = await Promise.all(batch.map((r) => harvestOne(r)));
          primsTotal += counts.reduce((a, b) => a + b, 0);
        }
        // A final source-level "done" marker uses the spec.id as bundleId
        // (matching the github case) so the shouldResume() fast-path works
        // unchanged on warm runs: unchanged repo sha → all plugins skipped.
        await log.recordDone({
          sourceId: spec.id, bundleId, commitSha,
          primitives: 0, ms: Date.now() - startedRepo
        });
      } else {
        await log.recordStart({ sourceId: spec.id, bundleId, commitSha });
        const provider = new GitHubSingleBundleProvider({
          spec, client: this.opts.client, blobs: this.opts.blobs
        });
        const refs: Parameters<typeof harvestBundle>[1][] = [];
        for await (const r of provider.listBundles()) {
          refs.push(r);
        }
        const ref = refs[0];
        const prims = await harvestBundle(provider, ref);
        primsTotal = prims.length;
        out.push(...prims);
        await log.recordDone({
          sourceId: spec.id, bundleId, commitSha,
          primitives: prims.length, ms: Date.now() - startedRepo
        });
      }
      this.opts.onEvent?.({
        kind: 'source-done', sourceId: spec.id, commitSha,
        primitives: primsTotal, ms: Date.now() - startedRepo
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await log.recordError({
        sourceId: spec.id, bundleId,
        commitSha: commitSha ?? 'unknown', error: msg
      });
      this.opts.onEvent?.({ kind: 'source-error', sourceId: spec.id, error: msg });
    }
  }
}

/**
 * Snapshot of the latest Primitive[] per sourceId. Persisted next to the
 * progress log so warm runs can serve an up-to-date index even when every
 * source is skipped. Written atomically via tmp + rename.
 * @param file - Absolute path of the snapshot JSON file.
 */
async function loadSnapshot(file: string): Promise<Map<string, Primitive[]>> {
  try {
    const raw = await fsPromises.readFile(file, 'utf8');
    const obj = JSON.parse(raw) as { primitivesBySource: Record<string, Primitive[]> };
    return new Map(Object.entries(obj.primitivesBySource ?? {}));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Map();
    }
    // Corrupt snapshot is not fatal; the worst case is an empty warm-run
    // index on one run, which the next run will repopulate.
    return new Map();
  }
}

async function saveSnapshot(file: string, snapshot: Map<string, Primitive[]>): Promise<void> {
  await fsPromises.mkdir(path.dirname(file), { recursive: true });
  const obj = { primitivesBySource: Object.fromEntries(snapshot) };
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsPromises.writeFile(tmp, JSON.stringify(obj), 'utf8');
  await fsPromises.rename(tmp, file);
}

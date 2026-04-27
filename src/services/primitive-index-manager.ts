/**
 * PrimitiveIndexManager — bridges the extension's installed bundles with the
 * framework-agnostic `PrimitiveIndex` exposed by
 * `@prompt-registry/collection-scripts`.
 *
 * v1 integration harvests from **installed bundles** (the primary "local"
 * scope). Bundles advertised by the active hub but not yet installed are a
 * separate, per-adapter fetch problem and are declared out of scope for v1.
 *
 * The extension's `DeploymentManifest` describes bundle packaging, not
 * agentic items. We therefore walk the install directory and synthesise
 * a `BundleManifest` whose `items[]` reflects the files we find. The
 * library's extractor then fills in frontmatter + heuristics.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  BlobCache,
  BlobFetcher,
  type BundleManifest as LibBundleManifest,
  type BundleProvider,
  type BundleRef,
  EtagStore,
  GitHubApiClient,
  HubHarvester,
  PrimitiveIndex,
  detectKindFromPath,
  loadIndex,
  parseHubConfig,
  resolveGithubToken,
  redactToken,
  saveIndex,
} from '@prompt-registry/collection-scripts';
import type {
  InstalledBundle,
} from '../types/registry';
import { Logger } from '../utils/logger';
import { RegistryManager } from './registry-manager';

const INDEX_FILENAME = 'primitive-index.json';
const MAX_WALK_DEPTH = 8;

/**
 * BundleProvider backed by the extension's list of installed bundles.
 *
 * - `listBundles` yields one `BundleRef` per `InstalledBundle` with a
 *   readable `installPath`.
 * - `readManifest` walks the install directory and produces a synthetic
 *   manifest with the detected primitive-bearing files.
 * - `readFile` reads directly from disk, refusing traversal outside the
 *   bundle root.
 */
export class InstalledBundlesProvider implements BundleProvider {
  public constructor(private readonly bundles: InstalledBundle[]) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- async generator required by BundleProvider interface; the installed list is in-memory.
  public async *listBundles(): AsyncIterable<BundleRef> {
    for (const b of this.bundles) {
      if (!b.installPath || !fs.existsSync(b.installPath)) {
        continue;
      }
      yield this.refFor(b);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async required by BundleProvider interface; the walk is synchronous.
  public async readManifest(ref: BundleRef): Promise<LibBundleManifest> {
    const b = this.find(ref);
    return synthesizeManifest(b);
  }

  public readFile(ref: BundleRef, relPath: string): Promise<string> {
    const b = this.find(ref);
    const full = path.resolve(b.installPath, relPath);
    if (!full.startsWith(path.resolve(b.installPath) + path.sep)) {
      return Promise.reject(new Error(`Refusing to read outside bundle: ${relPath}`));
    }
    return fs.promises.readFile(full, 'utf8');
  }

  private refFor(b: InstalledBundle): BundleRef {
    return {
      sourceId: b.sourceId ?? 'local',
      sourceType: b.sourceType ?? 'local',
      bundleId: b.bundleId,
      bundleVersion: b.version,
      installed: true,
    };
  }

  private find(ref: BundleRef): InstalledBundle {
    const match = this.bundles.find(
      (b) =>
        b.bundleId === ref.bundleId
        && (b.sourceId ?? 'local') === ref.sourceId
        && b.version === ref.bundleVersion,
    );
    if (!match) {
      throw new Error(`Unknown installed bundle: ${ref.sourceId}/${ref.bundleId}@${ref.bundleVersion}`);
    }
    return match;
  }
}

function synthesizeManifest(b: InstalledBundle): LibBundleManifest {
  const items = walkForPrimitives(b.installPath);
  const manifestAny = b.manifest as unknown as Record<string, unknown>;
  const tags = Array.isArray(manifestAny?.tags) ? (manifestAny.tags as string[]) : [];
  const name = typeof manifestAny?.name === 'string' ? (manifestAny.name as string) : b.bundleId;
  const description = typeof manifestAny?.description === 'string' ? (manifestAny.description as string) : '';
  const author = typeof manifestAny?.author === 'string' ? (manifestAny.author as string) : undefined;
  return {
    id: b.bundleId,
    version: b.version,
    name,
    description,
    author,
    tags,
    items,
  };
}

function walkForPrimitives(root: string): Array<{ path: string; kind: string }> {
  const results: Array<{ path: string; kind: string }> = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    if (depth > MAX_WALK_DEPTH) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        // Skip noisy folders.
        if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === 'dist') {
          continue;
        }
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!ent.isFile()) {
        continue;
      }
      const rel = path.relative(root, full).split(path.sep).join('/');
      const kind = detectKindFromPath(rel);
      if (kind) {
        results.push({ path: rel, kind });
      }
    }
  }
  return results;
}

export interface PrimitiveIndexSnapshot {
  primitives: number;
  bundles: number;
  byKind: Record<string, number>;
  builtAt: string;
}

export class PrimitiveIndexManager {
  private static instance: PrimitiveIndexManager | undefined;

  private index: PrimitiveIndex | undefined;
  private readonly indexPath: string;
  private readonly logger = Logger.getInstance();

  private readonly _onIndexChanged = new vscode.EventEmitter<PrimitiveIndexSnapshot>();
  public readonly onIndexChanged = this._onIndexChanged.event;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly registry: RegistryManager,
  ) {
    this.indexPath = path.join(context.globalStorageUri.fsPath, INDEX_FILENAME);
    this.tryLoadPersisted();
  }

  public static getInstance(context: vscode.ExtensionContext, registry: RegistryManager): PrimitiveIndexManager {
    if (!PrimitiveIndexManager.instance) {
      PrimitiveIndexManager.instance = new PrimitiveIndexManager(context, registry);
    }
    return PrimitiveIndexManager.instance;
  }

  public static resetInstance(): void {
    PrimitiveIndexManager.instance = undefined;
  }

  public getIndex(): PrimitiveIndex | undefined {
    return this.index;
  }

  public getIndexPath(): string {
    return this.indexPath;
  }

  public async buildFromInstalled(): Promise<PrimitiveIndex> {
    const installed = await this.registry.listInstalledBundles();
    this.logger.info(`Building primitive index from ${installed.length} installed bundles`);
    const provider = new InstalledBundlesProvider(installed);
    const index = await PrimitiveIndex.buildFrom(provider);
    this.index = index;
    this.persist();
    this.fireSnapshot();
    return index;
  }

  /**
   * Harvest primitives directly from a hub's configured GitHub sources.
   *
   * Uses the same engine as the `primitive-index hub-harvest` CLI: token
   * resolution via env/gh-cli, content-addressed blob cache, append-only
   * progress log, conditional /commits/ via ETag store, and bounded
   * concurrency across sources. All cache state lives under
   * `<globalStorage>/primitive-index-hub/<hubId>/` so hubs are isolated.
   * @param opts - Hub-harvest options.
   */
  public async buildFromHub(opts: {
    hubOwner: string;
    hubRepo: string;
    hubBranch?: string;
    hubId?: string;
    concurrency?: number;
    force?: boolean;
    /**
     * Additional source specs to append to the parsed hub-config. Enables
     * ingesting a new source type (e.g. awesome-copilot-plugin from
     * github/awesome-copilot) before the real hub config advertises it.
     * Each entry overrides any pre-existing source with the same id.
     */
    extraSources?: import('@prompt-registry/collection-scripts').HubSourceSpec[];
    onEvent?: (ev: unknown) => void;
  }): Promise<PrimitiveIndex> {
    const hubId = opts.hubId ?? `${opts.hubOwner}.${opts.hubRepo}`;
    const hubCacheDir = path.join(this.context.globalStorageUri.fsPath, 'primitive-index-hub', hubId);
    await fs.promises.mkdir(hubCacheDir, { recursive: true });

    const resolved = await resolveGithubToken({});
    if (!resolved.token) {
      throw new Error('No GitHub token available (tried env GITHUB_TOKEN, GH_TOKEN, gh CLI).');
    }
    this.logger.info(
      `[hub-harvest] hub=${opts.hubOwner}/${opts.hubRepo}@${opts.hubBranch ?? 'main'} token=${resolved.source}:${redactToken(resolved.token)}`,
    );

    const client = new GitHubApiClient({ token: resolved.token });
    const cache = new BlobCache(path.join(hubCacheDir, 'blobs'));
    const blobs = new BlobFetcher({ client, cache });
    const etagStore = await EtagStore.open(path.join(hubCacheDir, 'etags.json'));

    // Fetch hub-config.yml from the hub repo itself.
    const hubConfigYaml = await client.getText(
      `https://raw.githubusercontent.com/${opts.hubOwner}/${opts.hubRepo}/${opts.hubBranch ?? 'main'}/hub-config.yml`,
    );
    let sources = parseHubConfig(hubConfigYaml);
    this.logger.info(`[hub-harvest] parsed ${sources.length} sources from hub-config.yml`);
    if (opts.extraSources && opts.extraSources.length > 0) {
      for (const extra of opts.extraSources) {
        sources = sources.filter((s) => s.id !== extra.id);
        sources.push(extra);
        this.logger.info(`[hub-harvest] injected extra source id=${extra.id} type=${extra.type} url=${extra.url}`);
      }
    }

    const harvester = new HubHarvester({
      sources, client, blobs, etagStore,
      progressFile: path.join(hubCacheDir, 'progress.jsonl'),
      concurrency: opts.concurrency ?? 4,
      force: opts.force,
      onEvent: (ev) => opts.onEvent?.(ev),
    });
    const result = await harvester.run();
    await etagStore.save();

    this.index = result.index;
    this.persist();
    this.fireSnapshot();
    return result.index;
  }

  public async refreshFromInstalled(): Promise<{ added: string[]; updated: string[]; removed: string[]; unchanged: number }> {
    if (!this.index) {
      await this.buildFromInstalled();
      return { added: this.index!.all().map((p) => p.id), updated: [], removed: [], unchanged: 0 };
    }
    const installed = await this.registry.listInstalledBundles();
    const provider = new InstalledBundlesProvider(installed);
    const report = await this.index.refresh(provider);
    this.persist();
    this.fireSnapshot();
    return report;
  }

  public persist(): void {
    if (!this.index) {
      return;
    }
    try {
      saveIndex(this.index, this.indexPath);
    } catch (err) {
      this.logger.warn('Failed to persist primitive index', err as Error);
    }
  }

  public dispose(): void {
    this._onIndexChanged.dispose();
  }

  private fireSnapshot(): void {
    if (!this.index) {
      return;
    }
    const s = this.index.stats();
    this._onIndexChanged.fire({
      primitives: s.primitives,
      bundles: s.bundles,
      byKind: s.byKind,
      builtAt: s.builtAt,
    });
  }

  private tryLoadPersisted(): void {
    if (!fs.existsSync(this.indexPath)) {
      return;
    }
    try {
      this.index = loadIndex(this.indexPath);
      this.logger.info(
        `Loaded primitive index from ${this.indexPath} with ${this.index.stats().primitives} primitives`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to load primitive index from ${this.indexPath} — will rebuild on demand`,
        err as Error,
      );
    }
  }
}

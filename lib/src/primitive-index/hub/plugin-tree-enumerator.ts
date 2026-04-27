/**
 * Plugin tree enumerator.
 *
 * Unlike the single-bundle model where one repo = one bundle, a plugin
 * repo hosts many bundles — one per subdirectory of `<pluginsPath>/<id>/`
 * that contains `.github/plugin/plugin.json`. This enumerator:
 *
 *   1. Resolves the repo's commit sha (via the shared resolveCommitSha
 *      helper so ETag / smart-rebuild keeps working).
 *   2. Fetches the recursive git tree once.
 *   3. Discovers plugin manifests: any blob at
 *      `<pluginsPath>/<id>/.github/plugin/plugin.json`.
 *   4. Fetches each manifest's bytes, parses + derives items.
 *   5. For each item, adds the resolved entry file to that plugin's
 *      candidate list (SKILL.md / AGENT.md / *.prompt.md / ...).
 *
 * The manifest itself is included in the candidate set (path +
 * blobSha) so `GitHubSingleBundleProvider.readManifest()` can fetch
 * it by sha from the same blob cache later — no duplicate round trips.
 *
 * All blob size checks use the same default as the single-bundle
 * enumerator (256 KiB) to guard against accidentally pulling a huge
 * binary through the filter.
 */

import {
  BlobFetcher,
} from './blob-fetcher';
import type {
  EtagStore,
} from './etag-store';
import {
  GitHubApiClient,
} from './github-api-client';
import {
  derivePluginItems,
  parsePluginManifest,
  resolvePluginItemEntryPath,
} from './plugin-manifest';
import {
  resolveCommitSha,
} from './tree-enumerator';

export interface EnumeratePluginRepoOptions {
  owner: string;
  repo: string;
  ref: string;
  /** Subdir containing plugins, e.g. "plugins". */
  pluginsPath: string;
  /** Optional shared ETag store (passes through to resolveCommitSha). */
  etagStore?: EtagStore;
  /**
   * Inject an existing BlobFetcher so manifest reads hit the same blob
   * cache the caller uses elsewhere. When omitted, the enumerator will
   * not cache manifest bytes (tests typically let it create its own).
   */
  blobFetcher?: BlobFetcher;
  /** Max blob size guard (default 256 KiB). */
  maxFileSize?: number;
}

/** One plugin discovered under `pluginsPath/`. */
export interface PluginDiscovery {
  /** Folder name under pluginsPath/, e.g. "skills-plugin". */
  pluginId: string;
  /** Full path under the repo root, e.g. "plugins/skills-plugin". */
  pluginRoot: string;
  /** The parsed manifest (kept as-is for downstream use). */
  manifest: unknown;
  /** File candidates to fetch: manifest + resolved entry files. */
  candidates: { path: string; blobSha: string; size: number }[];
}

export interface EnumeratePluginRepoResult {
  commitSha: string;
  plugins: PluginDiscovery[];
}

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

interface TreeResponse {
  sha: string;
  tree: TreeEntry[];
  truncated: boolean;
}

/**
 * Enumerate all plugins in a repo, returning one PluginDiscovery per
 * subdir under pluginsPath/ that contains a plugin.json.
 * @param client - Authorised GitHub API client.
 * @param opts - Repo coordinates + pluginsPath + optional ETag/blob cache.
 * @throws {Error} if the tree is truncated (we can't guarantee all blobs).
 */
export async function enumeratePluginRepo(
  client: GitHubApiClient,
  opts: EnumeratePluginRepoOptions
): Promise<EnumeratePluginRepoResult> {
  const { owner, repo, ref, pluginsPath, etagStore, maxFileSize = 256 * 1024 } = opts;
  const commitSha = await resolveCommitSha(client, { owner, repo, ref, etagStore });
  const tree = await client.getJson<TreeResponse>(
    `/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`
  );
  if (tree.truncated) {
    throw new Error(`plugin tree truncated for ${owner}/${repo}@${commitSha}: too many entries`);
  }

  const prefix = `${pluginsPath.replace(/\/+$/u, '')}/`;
  const manifestSuffix = '/.github/plugin/plugin.json';

  // Index every blob by its path so we can resolve items O(1) later.
  const blobByPath = new Map<string, { sha: string; size: number }>();
  for (const e of tree.tree) {
    if (e.type === 'blob') {
      blobByPath.set(e.path, { sha: e.sha, size: e.size ?? 0 });
    }
  }

  // Find plugin manifests under pluginsPath/<id>/.github/plugin/plugin.json.
  const manifestPaths = [...blobByPath.keys()].filter(
    (p) => p.startsWith(prefix) && p.endsWith(manifestSuffix)
  );

  // Parallel manifest fetches: for a repo with 55 plugins this turns
  // ~55 sequential round-trips into one awaitAll. Each fetch goes
  // through the shared blob cache + GitHub client rate budget.
  const manifestResults = await Promise.all(
    manifestPaths.map(async (manifestPath) => {
      const manifestBlob = blobByPath.get(manifestPath);
      if (!manifestBlob || manifestBlob.size > maxFileSize) {
        return { manifestPath, bytes: undefined as string | undefined, manifestBlob };
      }
      try {
        const bytes = await fetchManifestBytes(
          client,
          opts.blobFetcher,
          owner,
          repo,
          manifestBlob.sha
        );
        return { manifestPath, bytes, manifestBlob };
      } catch {
        return { manifestPath, bytes: undefined, manifestBlob };
      }
    })
  );

  const plugins: PluginDiscovery[] = [];
  for (const { manifestPath, bytes, manifestBlob } of manifestResults) {
    if (!manifestBlob || bytes === undefined) {
      continue;
    }
    const rel = manifestPath.slice(prefix.length);
    const sepIdx = rel.indexOf('/');
    if (sepIdx === -1) {
      continue; // malformed; skip defensively
    }
    const pluginId = rel.slice(0, sepIdx);
    const pluginRoot = `${pluginsPath}/${pluginId}`;
    const raw = bytes;
    let manifest: ReturnType<typeof parsePluginManifest>;
    try {
      manifest = parsePluginManifest(raw);
    } catch {
      // Ill-formed manifest → skip the whole plugin (don't throw;
      // one bad plugin shouldn't kill the whole enumeration).
      continue;
    }
    // External plugins (manifest.external === true) point at another repo
    // via manifest.source. We don't follow those transitively from the hub
    // harvester — the user can add the external repo as its own extra
    // source if they want its content. Silently skip.
    if (manifest.external === true) {
      continue;
    }
    const items = derivePluginItems(manifest);
    const candidates: PluginDiscovery['candidates'] = [
      { path: manifestPath, blobSha: manifestBlob.sha, size: manifestBlob.size }
    ];
    for (const item of items) {
      const entryPath = resolvePluginItemEntryPath(pluginRoot, item);
      const blob = blobByPath.get(entryPath);
      if (!blob) {
        continue; // manifest references missing file — skip silently
      }
      if (blob.size > maxFileSize) {
        continue;
      }
      candidates.push({ path: entryPath, blobSha: blob.sha, size: blob.size });
    }
    plugins.push({ pluginId, pluginRoot, manifest, candidates });
  }
  return { commitSha, plugins };
}

async function fetchManifestBytes(
  client: GitHubApiClient,
  blobFetcher: BlobFetcher | undefined,
  owner: string,
  repo: string,
  sha: string
): Promise<string> {
  if (blobFetcher) {
    const cached = await blobFetcher.fetch({ owner, repo, sha });
    return cached.toString('utf8');
  }
  // Fallback: direct /git/blobs/:sha fetch. Mirrors BlobFetcher internals.
  const res = await client.getJson<{ encoding: string; content: string; sha: string }>(
    `/repos/${owner}/${repo}/git/blobs/${sha}`
  );
  const bytes = res.encoding === 'base64'
    ? Buffer.from(res.content, 'base64')
    : Buffer.from(res.content, 'utf8');
  return bytes.toString('utf8');
}

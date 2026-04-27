/**
 * Generic hub-harvesting layer — reusable across CLI subcommands.
 *
 * This barrel re-exports the hub modules currently living at
 * `primitive-index/hub/` under a clean top-level namespace so that a
 * future generic `prompt-registry` CLI (with subcommands like `list`,
 * `install`, `uninstall`, and `search`) can depend on stable imports:
 *
 *     import { HubHarvester, BundleProvider, GitHubApiClient } from
 *       '@prompt-registry/collection-scripts/hub';
 *
 * The physical location of the modules remains under
 * `primitive-index/hub/` for now; a follow-up PR can move them here
 * once all consumers are switched to these barrel imports.
 * @module hub
 */

// Core GitHub transport.
export {
  GitHubApiClient,
  GitHubApiError,
  type FetchLike as GitHubFetchLike,
} from '../primitive-index/hub/github-api-client';

// Content-addressed blob cache + fetcher.
export {
  BlobCache,
  computeGitBlobSha,
  type BlobCacheStats,
} from '../primitive-index/hub/blob-cache';
export { BlobFetcher } from '../primitive-index/hub/blob-fetcher';

// Persistent ETag store for conditional /commits/ requests.
export { EtagStore } from '../primitive-index/hub/etag-store';

// GitHub token resolution (env → GH_TOKEN → gh CLI).
export {
  resolveGithubToken,
  redactToken,
} from '../primitive-index/hub/token-provider';

// Bundle providers.
export { GitHubSingleBundleProvider } from '../primitive-index/hub/github-bundle-provider';
export { AwesomeCopilotPluginBundleProvider } from '../primitive-index/hub/plugin-bundle-provider';

// Plugin-format helpers (parsers stay feature-layer; types come from domain).
export {
  parsePluginManifest,
  derivePluginItems,
  resolvePluginItemEntryPath,
  extractPluginMcpServers,
} from '../primitive-index/hub/plugin-manifest';
export type {
  PluginItem,
  PluginItemKind,
  PluginManifest,
} from '../domain';
export {
  enumeratePluginRepo,
  type EnumeratePluginRepoResult,
  type PluginDiscovery,
} from '../primitive-index/hub/plugin-tree-enumerator';

// Generic tree enumerator (walks repo trees for any source type).
export {
  enumerateRepoTree,
  resolveCommitSha,
  isPrimitiveCandidatePath,
  type TreeEntry,
  type EnumerateOptions,
  type EnumerateResult,
} from '../primitive-index/hub/tree-enumerator';

// hub-config parser + CLI extra-source parser (parsers feature-layer; type from domain).
export {
  parseHubConfig,
  normalizeRepoFromUrl,
} from '../primitive-index/hub/hub-config';
export type { HubSourceSpec } from '../domain';
export { parseExtraSource } from '../primitive-index/hub/extra-source';

// Orchestrator.
export {
  HubHarvester,
  type HubHarvesterOptions,
  type HubHarvestResult,
  type HubHarvestEvent,
} from '../primitive-index/hub/hub-harvester';

// Progress log + reporting.
export {
  HarvestProgressLog,
  type ProgressEvent,
  type ProgressKind,
  type BundleState,
  type ProgressSummary,
} from '../primitive-index/hub/progress-log';

// Optional HMAC sidecar for signed index integrity.
export {
  computeIndexHmac,
  saveIndexWithIntegrity,
  verifyIndexIntegrity,
  type IntegritySecret,
  type IntegrityEnvelope,
} from '../primitive-index/hub/integrity';

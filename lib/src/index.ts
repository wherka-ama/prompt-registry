/**
 * `@prompt-registry/collection-scripts`
 *
 * Shared scripts for building, validating, and publishing Copilot prompt collections.
 * @module @prompt-registry/collection-scripts
 */

// Type exports
export type {
  ValidationResult,
  ObjectValidationResult,
  FileValidationResult,
  AllCollectionsResult,
  CollectionItem,
  Collection,
  ValidationRules,
  VersionInfo,
  BundleInfo,
} from './types';

// Validation exports
export {
  VALIDATION_RULES,
  loadItemKindsFromSchema,
  validateCollectionId,
  validateVersion,
  validateItemKind,
  normalizeRepoRelativePath,
  isSafeRepoRelativePath,
  validateCollectionObject,
  validateCollectionFile,
  validateAllCollections,
  generateMarkdown,
} from './validate';

// Collection utilities exports
export {
  listCollectionFiles,
  readCollection,
  resolveCollectionItemPaths,
} from './collections';

// Bundle ID exports
export { generateBundleId } from './bundle-id';

// CLI utilities exports
export {
  parseSingleArg,
  parseMultiArg,
  hasFlag,
  getPositionalArg,
} from './cli';

// Skills exports
export type {
  SkillMetadata,
  SkillValidationResult,
  AllSkillsValidationResult,
} from './skills';

export {
  SKILL_NAME_MAX_LENGTH,
  SKILL_DESCRIPTION_MIN_LENGTH,
  SKILL_DESCRIPTION_MAX_LENGTH,
  MAX_ASSET_SIZE,
  parseFrontmatter,
  validateSkillName,
  validateSkillDescription,
  validateSkillFolder,
  validateAllSkills,
  generateSkillContent,
  createSkill,
} from './skills';

// Domain types — single canonical home (lib/src/domain/).
export type {
  BundleProvider,
  BundleRef,
  BundleManifest,
  Primitive,
  PrimitiveKind,
} from './domain';
export { PRIMITIVE_KINDS } from './domain';

// Primitive Index feature-layer types.
export type {
  EmbeddingProvider,
  IndexStats,
  RefreshReport,
  SearchHit,
  SearchQuery,
  SearchResult,
  Shortlist,
} from './primitive-index/types';
export { PrimitiveIndex } from './primitive-index/index';
export { tokenize, stem } from './primitive-index/tokenizer';
export {
  Bm25Engine,
  type Bm25Doc,
  type Bm25Stats,
  type FieldTokens,
} from './primitive-index/bm25';

// Hub harvester public API — lets the extension (or any other caller)
// run the same harvest pipeline the CLI does, with an injected token.
export {
  BlobCache,
  computeGitBlobSha,
} from './primitive-index/hub/blob-cache';
export { BlobFetcher } from './primitive-index/hub/blob-fetcher';
export { EtagStore } from './primitive-index/hub/etag-store';
export {
  GitHubApiClient,
  type FetchLike as GitHubFetchLike,
  GitHubApiError,
} from './primitive-index/hub/github-api-client';
export { GitHubSingleBundleProvider } from './primitive-index/hub/github-bundle-provider';
export { AwesomeCopilotPluginBundleProvider } from './primitive-index/hub/plugin-bundle-provider';
export {
  derivePluginItems,
  extractPluginMcpServers,
  parsePluginManifest,
  resolvePluginItemEntryPath,
} from './primitive-index/hub/plugin-manifest';
export type {
  PluginItem,
  PluginItemKind,
  PluginManifest,
} from './domain';
export {
  enumeratePluginRepo,
  type EnumeratePluginRepoResult,
  type PluginDiscovery,
} from './primitive-index/hub/plugin-tree-enumerator';
export { parseExtraSource } from './primitive-index/hub/extra-source';
export {
  defaultCacheDir,
  defaultHubCacheDir,
  defaultIndexFile,
  defaultProgressFile,
  type DefaultPathEnv,
} from './primitive-index/default-paths';

// Generic reusable layers for a future prompt-registry CLI with
// list/install/uninstall/search subcommands. See lib/src/registry/
// and lib/src/hub/ barrel files for the contract.
export * as registry from './registry';
export * as hub from './hub';
export * as core from './core';

// Phase 3: Domain layer exports
export * as domain from './domain';

// Quality tooling: pattern-based relevance eval + search microbench.
export {
  matchPattern,
  runPatternEval,
  renderPatternReportMarkdown,
  type PatternCase,
  type PatternReport,
  type PatternCaseReport,
  type RelevancePattern,
} from './primitive-index/eval-pattern';
export {
  runBench,
  renderBenchReportMarkdown,
  type BenchCase,
  type BenchCaseResult,
  type BenchReport,
} from './primitive-index/bench';
export {
  parseHubConfig,
  normalizeRepoFromUrl,
} from './primitive-index/hub/hub-config';
export type { HubSourceSpec } from './domain';
export {
  HubHarvester,
  type HubHarvesterOptions,
  type HubHarvestResult,
  type HubHarvestEvent,
} from './primitive-index/hub/hub-harvester';
export {
  computeIndexHmac,
  saveIndexWithIntegrity,
  verifyIndexIntegrity,
  type IntegritySecret,
} from './primitive-index/hub/integrity';
export {
  HarvestProgressLog,
  type ProgressSummary,
} from './primitive-index/hub/progress-log';
export {
  redactToken,
  resolveGithubToken,
  type ResolvedToken,
} from './primitive-index/hub/token-provider';
export {
  enumerateRepoTree,
  isPrimitiveCandidatePath,
  resolveCommitSha,
} from './primitive-index/hub/tree-enumerator';
export { harvest, harvestBundle } from './primitive-index/harvester';
export {
  harvestHub,
  type HubHarvestPipelineOptions,
  type HubHarvestPipelineResult,
} from './primitive-index/hub-harvest-pipeline';
export {
  parseFrontmatter as parsePrimitiveFrontmatter,
  extractFromFile,
  extractMcpPrimitives,
  computePrimitiveId,
  detectKindFromPath,
} from './primitive-index/extract';
export { saveIndex, loadIndex, tryLoadIndex } from './primitive-index/store';
export {
  exportShortlistAsProfile,
} from './primitive-index/export-profile';
export type {
  HubProfile,
  HubProfileBundleRef,
  Collection as PrimitiveIndexCollection,
  CollectionItem as PrimitiveIndexCollectionItem,
  ExportProfileOptions,
  ProfileExport,
} from './primitive-index/export-profile';
export { LocalFolderBundleProvider } from './primitive-index/providers/local-folder';

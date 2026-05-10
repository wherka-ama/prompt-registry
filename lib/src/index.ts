/**
 * `@prompt-registry/collection-scripts`
 *
 * Shared scripts for building, validating, and publishing Copilot prompt collections.
 * @module @prompt-registry/collection-scripts
 */

// Public API - curated exports for external consumers
export * from './public';

// Legacy exports for backward compatibility (Phase 1 Step 1.9: will be phased out)
/** @deprecated Use curated public API from ./public instead */
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
} from './domain/collection/types';

/** @deprecated Use curated public API from ./public instead */
export {
  DEFAULT_VALIDATION_RULES as VALIDATION_RULES,
  validateCollectionId,
  validateVersion,
  validateItemKind,
  normalizeRepoRelativePath,
  isSafeRepoRelativePath,
  validateCollectionObject,
} from './domain/collection/validate';

/** @deprecated Use curated public API from ./public instead */
export {
  loadItemKindsFromSchema,
  validateCollectionFile,
  validateAllCollections,
  generateMarkdown,
  listCollectionFiles,
  readCollection,
  resolveCollectionItemPaths,
} from './app/collection/read-collection';

/** @deprecated Use curated public API from ./public instead */
export { generateBundleId } from './domain/bundle/id';

/** @deprecated Use curated public API from ./public instead */
export type {
  SkillMetadata,
  SkillValidationResult,
  AllSkillsValidationResult,
} from './domain/skill/validate';

/** @deprecated Use curated public API from ./public instead */
export {
  SKILL_NAME_MAX_LENGTH,
  SKILL_DESCRIPTION_MIN_LENGTH,
  SKILL_DESCRIPTION_MAX_LENGTH,
  MAX_ASSET_SIZE,
  parseFrontmatter,
  validateSkillName,
  validateSkillDescription,
} from './domain/skill/validate';

/** @deprecated Use curated public API from ./public instead */
export {
  validateSkillFolder,
  validateAllSkills,
  generateSkillContent,
  createSkill,
} from './app/collection/generate-skill';

// Domain layer exports - curated namespace
/** @internal Internal domain layer - use public API instead */
export * as domain from './domain';

// Primitive Index API
export { PrimitiveIndex } from './infra/search/primitive-index';
export type {
  SearchHit,
  SearchResult,
  SearchQuery,
  MatchExplanation,
} from './infra/search/types';

// Hub harvester API - essential exports for extension integration
export {
  HubHarvester,
  type HubHarvesterOptions,
  type HubHarvestResult,
  type HubHarvestEvent,
} from './infra/harvest/hub-harvester';
export {
  harvestHub,
  type HubHarvestPipelineOptions,
  type HubHarvestPipelineResult,
} from './infra/harvest/hub-harvester';
export {
  BlobCache,
  computeGitBlobSha,
} from './infra/github/blob-cache';
export {
  GitHubClient,
  type FetchLike as GitHubFetchLike,
  GitHubApiError,
} from './infra/github/client';
export {
  enumeratePluginRepo,
  type EnumeratePluginRepoResult,
  type PluginDiscovery,
} from './infra/harvest/plugin-tree-enumerator';
export {
  harvest,
  harvestBundle,
} from './infra/harvest/harvester';

// Index store API
export { saveIndex, loadIndex, tryLoadIndex } from './infra/stores/json-index-store';

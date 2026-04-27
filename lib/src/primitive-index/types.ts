/**
 * Phase 3 / Primitive Index — shared types (backward compatibility).
 *
 * This file now re-exports domain types for backward compatibility.
 * New code should import from `@prompt-registry/collection-scripts/domain`.
 *
 * Feature-layer types (SearchQuery, SearchResult, etc.) remain here as they
 * are specific to the primitive-index feature.
 * @module primitive-index/types
 */

// Domain types — re-exported from domain layer
// Import domain types for feature-layer type definitions
import type {
  Primitive,
  PrimitiveKind,
} from '../domain';

export {
  PRIMITIVE_KINDS,
  type PrimitiveKind,
  type BundleRef,
  type BundleManifest,
  type HarvestedFile,
  type BundleProvider,
  type Primitive,
} from '../domain';

// Feature-layer types — specific to primitive-index
export interface EmbeddingProvider {
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface SearchQuery {
  q?: string;
  kinds?: PrimitiveKind[];
  sources?: string[];
  bundles?: string[];
  tags?: string[];
  installedOnly?: boolean;
  limit?: number;
  offset?: number;
  explain?: boolean;
  ranking?: 'bm25' | 'hybrid';
  /** For hybrid ranking. Must match the embedding provider dimension. */
  queryEmbedding?: Float32Array;
}

export interface MatchExplanation {
  field: 'title' | 'description' | 'tags' | 'bodyPreview';
  term: string;
  weight: number;
  contribution: number;
}

export interface SearchHit {
  primitive: Primitive;
  score: number;
  matches?: MatchExplanation[];
}

export interface SearchResult {
  total: number;
  hits: SearchHit[];
  facets: {
    kinds: Record<string, number>;
    sources: Record<string, number>;
    tags: Record<string, number>;
  };
  tookMs: number;
}

export interface Shortlist {
  id: string;
  name: string;
  description?: string;
  primitiveIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface IndexStats {
  primitives: number;
  byKind: Record<string, number>;
  bySource: Record<string, number>;
  bundles: number;
  shortlists: number;
  builtAt: string;
}

export interface RefreshReport {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: number;
}

export interface BuildOptions {
  hubId?: string;
  embeddings?: EmbeddingProvider;
  /** Cap per-bundle file count to bound runaway sources. Default: 500. */
  maxFilesPerBundle?: number;
}

export type RefreshOptions = BuildOptions;

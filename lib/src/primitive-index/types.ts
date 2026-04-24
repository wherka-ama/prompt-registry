/**
 * Primitive Index — shared types.
 *
 * No runtime dependencies; importable from CLI, skills, or VS Code adapters.
 * @module primitive-index/types
 */

export type PrimitiveKind =
  | 'prompt'
  | 'instruction'
  | 'chat-mode'
  | 'agent'
  | 'skill'
  | 'mcp-server';

export const PRIMITIVE_KINDS: readonly PrimitiveKind[] = [
  'prompt',
  'instruction',
  'chat-mode',
  'agent',
  'skill',
  'mcp-server'
] as const;

export interface BundleRef {
  sourceId: string;
  sourceType: string;
  bundleId: string;
  bundleVersion: string;
  installed: boolean;
}

export interface BundleManifest {
  id: string;
  version: string;
  name?: string;
  description?: string;
  tags?: string[];
  author?: string;
  items?: {
    path: string;
    kind: string;
    title?: string;
    description?: string;
    tags?: string[];
  }[];
  mcp?: {
    items?: Record<string, {
      type?: string;
      command?: string;
      args?: string[];
      url?: string;
      description?: string;
    }>;
  };
  [key: string]: unknown;
}

export interface HarvestedFile {
  /** Path relative to the bundle root. */
  path: string;
  /** UTF-8 body content. */
  content: string;
}

/**
 * Adapter-agnostic provider. Anything that can enumerate bundles and read
 * their files can feed the harvester: VS Code adapters, a local folder scan,
 * a remote repo walker, etc.
 */
export interface BundleProvider {
  listBundles(): AsyncIterable<BundleRef>;
  readManifest(ref: BundleRef): Promise<BundleManifest>;
  readFile(ref: BundleRef, relPath: string): Promise<string>;
}

export interface Primitive {
  id: string;
  bundle: BundleRef;
  kind: PrimitiveKind;
  path: string;
  title: string;
  description: string;
  tags: string[];
  authors?: string[];
  applyTo?: string;
  tools?: string[];
  model?: string;
  bodyPreview: string;
  contentHash: string;
  rating?: number;
  updatedAt?: string;
}

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

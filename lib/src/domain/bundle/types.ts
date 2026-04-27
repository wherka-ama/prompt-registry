/**
 * Phase 3 / Domain Layer — Bundle types.
 *
 * Core bundle data shapes used across all features (indexing, validation,
 * publishing, install). Feature layers depend on these types; these types
 * have no feature-layer dependencies.
 * @module domain/bundle
 */

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
 * their files can feed harvesters: VS Code adapters, a local folder scan,
 * a remote repo walker, etc.
 */
export interface BundleProvider {
  listBundles(): AsyncIterable<BundleRef>;
  readManifest(ref: BundleRef): Promise<BundleManifest>;
  readFile(ref: BundleRef, relPath: string): Promise<string>;
}

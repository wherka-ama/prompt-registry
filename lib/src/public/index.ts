/* eslint-disable jsdoc/escape-inline-tags -- @prompt-registry is a package name */
/**
 * Public API for @prompt-registry/collection-scripts.
 *
 * This is the curated public API boundary. All exports here are
 * considered stable and intended for external consumption.
 *
 * Internal implementation details are in other directories and should
 * not be imported directly by external consumers.
 *
 * Phase 1 Step 1.9: Initial public API boundary. Implementation classes
 * (InstallPipeline, UninstallPipeline, etc.) are temporarily imported from
 * internal layers. Future steps will move these to the public directory.
 */
/* eslint-enable jsdoc/escape-inline-tags */

// Domain types (core data structures)
export type {
  BundleProvider,
  BundleRef,
  BundleManifest,
  HarvestedFile,
} from '../domain/bundle/types';

export type {
  Primitive,
  PrimitiveKind,
} from '../domain/primitive/types';

export { PRIMITIVE_KINDS } from '../domain/primitive/types';

// Domain install types (used by pipeline)
export type {
  BundleSpec,
  Installable,
  Target,
} from '../domain/install';

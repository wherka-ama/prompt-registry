/**
 * Re-export shim — the canonical BlobCache + computeGitBlobSha now
 * live at `lib/src/github/blob-cache.ts`. Kept here for one cycle so
 * the harvester can keep its current imports without churn.
 */
export { BlobCache, computeGitBlobSha, type BlobCacheStats } from '../../github/blob-cache';

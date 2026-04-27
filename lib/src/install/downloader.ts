/**
 * Phase 5 / Iter 12 — BundleDownloader interface + memory impl.
 *
 * Downloader = "given an Installable, fetch the bundle bytes and
 * verify integrity". Real impls use HTTP / signed URLs; this iter
 * ships only the interface plus an in-memory double sufficient for
 * piping the install pipeline's tests.
 *
 * The downloader returns raw bytes (a `Uint8Array`); zip extraction
 * is the next stage (iter 13/14). Splitting download from extract
 * lets us test integrity verification in isolation and lets future
 * iters add caching by URL without changing the downstream API.
 */
import type {
  Installable,
} from '../domain/install';

export interface DownloadResult {
  /** Raw bundle bytes (zip). */
  bytes: Uint8Array;
  /** SHA-256 hex digest of bytes (computed by the impl). */
  sha256: string;
}

export interface BundleDownloader {
  /**
   * Download the bundle's bytes and compute their SHA-256.
   * @param installable - Resolved Installable from the resolver.
   * @returns DownloadResult.
   * @throws {Error} On network failure or integrity mismatch.
   */
  download(installable: Installable): Promise<DownloadResult>;
}

/**
 * Test-double downloader backed by an in-memory map keyed on
 * installable.downloadUrl.
 */
export class MemoryBundleDownloader implements BundleDownloader {
  /**
   * Build the downloader.
   * @param entries
   */
  public constructor(private readonly entries: Record<string, Uint8Array>) {}

  /**
   * Look up bundle bytes by downloadUrl and verify integrity (when
   * the Installable carries one).
   * @param installable - Resolved Installable.
   * @returns DownloadResult.
   */
  public async download(installable: Installable): Promise<DownloadResult> {
    const bytes = this.entries[installable.downloadUrl];
    if (bytes === undefined) {
      throw new Error(`MemoryBundleDownloader: no bytes registered for ${installable.downloadUrl}`);
    }
    const sha256 = await sha256Hex(bytes);
    if (installable.integrity !== undefined) {
      const expected = installable.integrity.replace(/^sha256-/, '');
      if (sha256 !== expected) {
        throw new Error(
          `integrity mismatch for ${installable.downloadUrl}: expected ${expected}, got ${sha256}`
        );
      }
    }
    return { bytes, sha256 };
  }
}

/**
 * Compute a SHA-256 hex digest of bytes. Uses Web Crypto when
 * available (Node ≥20), falls back to node:crypto.
 * @param bytes - Bytes to hash.
 * @returns Lowercase hex digest.
 */
export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  // Prefer global Web Crypto (Node 20+ exposes it as globalThis.crypto)
  // so this runs in any modern JS host without a dynamic import that
  // would defeat tree-shaking.
  const subtle = (globalThis as {
    crypto?: { subtle?: { digest(algo: string, data: Uint8Array): Promise<ArrayBuffer> } };
  }).crypto?.subtle;
  if (subtle !== undefined) {
    const buf = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback path; keeps the helper usable on older runtimes that
  // somehow shipped without Web Crypto.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- bounded fallback when globalThis.crypto is unavailable
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
};

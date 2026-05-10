/**
 * Phase 5 / Iter 13 — BundleExtractor interface + dictionary impl.
 *
 * `ExtractedFiles` and `BundleExtractor` are defined in `../ports/bundle-extractor`
 * and re-exported here for backward compatibility. Concrete implementations
 * (`DictBundleExtractor`, `filesFromRecord`) remain in this file.
 */
import type {
  BundleExtractor,
  ExtractedFiles,
} from '../ports/bundle-extractor';

export type {
  BundleExtractor,
  ExtractedFiles,
} from '../ports/bundle-extractor';

/**
 * Test-double extractor that returns a pre-supplied file map.
 * Ignores the input bytes. Used by the install-pipeline tests.
 */
export class DictBundleExtractor implements BundleExtractor {
  /**
   * Build the extractor with a fixed file map.
   * @param files Pre-supplied file map.
   */
  public constructor(private readonly files: ExtractedFiles) {}

  /**
   * Return the pre-supplied file map.
   * @param _bytes - Ignored.
   * @returns The supplied ExtractedFiles map.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Intentionally async for interface compatibility
  public async extract(_bytes: Uint8Array): Promise<ExtractedFiles> {
    return this.files;
  }
}

/**
 * Convert a {path: string|Uint8Array} record to an ExtractedFiles map.
 * @param input - Record where values are strings (encoded as UTF-8) or bytes.
 * @returns ExtractedFiles map.
 */
export const filesFromRecord = (
  input: Record<string, string | Uint8Array>
): ExtractedFiles => {
  const out = new Map<string, Uint8Array>();
  const enc = new TextEncoder();
  for (const [k, v] of Object.entries(input)) {
    out.set(k, typeof v === 'string' ? enc.encode(v) : v);
  }
  return out;
};

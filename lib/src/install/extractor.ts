/**
 * Phase 5 / Iter 13 — BundleExtractor interface + dictionary impl.
 *
 * Extractor = "given zip bytes, produce a map<relative-path, bytes>".
 * The real impl uses a zip-reader library (adm-zip is the candidate
 * for Phase 5 spillover); this iter ships the interface plus a
 * dictionary impl that takes already-extracted contents directly.
 *
 * The pipeline calls `extract(bytes)` and uses the returned map to
 * (a) read `deployment-manifest.yml`, (b) feed primitive files to
 * the target writers. Streaming isn't a concern because Copilot
 * bundles are small (<1 MB typical).
 */

export type ExtractedFiles = ReadonlyMap<string, Uint8Array>;

export interface BundleExtractor {
  /**
   * Decode bundle bytes into a path → bytes map.
   * @param bytes - Bytes (typically zip) from the downloader.
   * @returns ExtractedFiles map.
   */
  extract(bytes: Uint8Array): Promise<ExtractedFiles>;
}

/**
 * Test-double extractor that returns a pre-supplied file map and
 * ignores the input bytes. Used by the install-pipeline tests.
 */
export class DictBundleExtractor implements BundleExtractor {
  /**
   * Build the extractor with a fixed file map.
   * @param files
   */
  public constructor(private readonly files: ExtractedFiles) {}

  /**
   * Return the pre-supplied file map.
   * @param _bytes - Ignored.
   * @returns The supplied ExtractedFiles map.
   */
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

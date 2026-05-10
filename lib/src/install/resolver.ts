/**
 * Phase 5 / Iter 11 — BundleResolver interface + in-memory impl.
 *
 * `BundleResolver` is defined in `../ports/source-resolver` and
 * re-exported here for backward compatibility. `MapBundleResolver`
 * (the in-memory test double) remains in this file.
 */
import type {
  BundleResolver,
} from '../ports/source-resolver';
import type {
  BundleSpec,
  Installable,
} from '../domain/install';

export type {
  BundleResolver,
} from '../ports/source-resolver';

/**
 * Test-double resolver backed by an in-memory map.
 * Keys are either `<bundleId>` (when the spec had no sourceId) or
 * `<sourceId>:<bundleId>`. Latest-version resolution uses the entry
 * registered as the array's last element.
 */
export class MapBundleResolver implements BundleResolver {
  /**
   * Build the resolver.
   * @param entries Map of bundle IDs to installable entries.
   */
  public constructor(private readonly entries: Record<string, Installable[]>) {}

  /**
   * Resolve a spec to an Installable.
   * @param spec - Parsed install positional.
   * @returns Installable from the map, or null on miss.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Intentionally async for interface compatibility
  public async resolve(spec: BundleSpec): Promise<Installable | null> {
    const key = spec.sourceId === undefined
      ? spec.bundleId
      : `${spec.sourceId}:${spec.bundleId}`;
    const versions = this.entries[key];
    if (versions === undefined || versions.length === 0) {
      return null;
    }
    if (spec.bundleVersion === undefined || spec.bundleVersion === 'latest') {
      return versions.at(-1) ?? null;
    }
    const exact = versions.find((v) => v.ref.bundleVersion === spec.bundleVersion);
    return exact ?? null;
  }
}

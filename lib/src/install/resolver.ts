/**
 * Phase 5 / Iter 11 — BundleResolver interface + in-memory impl.
 *
 * Resolver = "given a parsed BundleSpec, where is the bundle and
 * what version are we installing?". Real resolvers (GitHub-API,
 * hub-catalog) talk to network; this iter ships only the interface
 * plus an in-memory implementation that's enough to drive the
 * install pipeline tests deterministically.
 *
 * The real GitHub-API resolver and hub-catalog resolver are
 * Phase-5-spillover deliverables; the install pipeline (iter 23)
 * is decoupled from them via this interface.
 */
import type {
  BundleSpec,
  Installable,
} from '../domain/install';

export interface BundleResolver {
  /**
   * Resolve a parsed BundleSpec to a downloadable Installable.
   * @param spec - Parsed install positional.
   * @returns Resolved Installable, or null when not found.
   */
  resolve(spec: BundleSpec): Promise<Installable | null>;
}

/**
 * Test-double resolver backed by an in-memory map. Keys are
 * either `<bundleId>` (when the spec had no sourceId) or
 * `<sourceId>:<bundleId>`. Latest-version resolution uses the entry
 * registered as the array's last element.
 */
export class MapBundleResolver implements BundleResolver {
  /**
   * Build the resolver.
   * @param entries
   */
  public constructor(private readonly entries: Record<string, Installable[]>) {}

  /**
   * Resolve a spec to an Installable.
   * @param spec - Parsed install positional.
   * @returns Installable from the map, or null on miss.
   */
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

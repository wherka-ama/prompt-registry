/**
 * Harvester — walks a BundleProvider and yields Primitives.
 *
 * Caller supplies the provider; the harvester stays adapter-agnostic so
 * identical code runs from the extension, the CLI, or a skill.
 */

import {
  extractFromFile,
  extractMcpPrimitives,
} from './extract';
import type {
  BundleProvider,
  BundleRef,
  Primitive,
} from './types';

export interface HarvestOptions {
  /** Hard cap to bound runaway providers (default 500). */
  maxFilesPerBundle?: number;
  /**
   * If the provider cannot enumerate files, we derive the candidate file
   * list from `manifest.items[].path`. Enabled by default.
   */
  useManifestItemPaths?: boolean;
  /** Optional per-bundle progress hook. */
  onBundle?: (ref: BundleRef, produced: number) => void;
  /** Optional error sink so a bad bundle does not abort the whole harvest. */
  onError?: (ref: BundleRef | null, err: unknown) => void;
}

/**
 * Harvest primitives from every bundle produced by a provider.
 * @param provider - Bundle source.
 * @param opts - Optional per-run caps and hooks.
 */
export async function harvest(
  provider: BundleProvider,
  opts: HarvestOptions = {}
): Promise<Primitive[]> {
  const out: Primitive[] = [];
  for await (const ref of provider.listBundles()) {
    try {
      const produced = await harvestBundle(provider, ref, opts);
      out.push(...produced);
      opts.onBundle?.(ref, produced.length);
    } catch (err) {
      opts.onError?.(ref, err);
    }
  }
  return out;
}

/**
 * Harvest primitives from a single bundle reference.
 * @param provider - Bundle source.
 * @param ref - Bundle to harvest.
 * @param opts - Optional per-run caps and hooks.
 */
export async function harvestBundle(
  provider: BundleProvider,
  ref: BundleRef,
  opts: HarvestOptions = {}
): Promise<Primitive[]> {
  const useItems = opts.useManifestItemPaths !== false;
  const maxFiles = opts.maxFilesPerBundle ?? 500;

  const manifest = await provider.readManifest(ref);
  const produced: Primitive[] = [];
  const seenPaths = new Set<string>();

  if (useItems && Array.isArray(manifest.items)) {
    const paths = manifest.items
      .map((i) => (i && typeof i.path === 'string' ? i.path : ''))
      .filter(Boolean)
      .slice(0, maxFiles);
    const dedupedPaths = paths.filter((p) => {
      if (seenPaths.has(p)) {
        return false;
      }
      seenPaths.add(p);
      return true;
    });
    // Fetch all blobs for this bundle in parallel. Bundles typically have
    // a handful of primitives each, so an unbounded Promise.all is
    // appropriate — larger bundles are already rare and the outer
    // harvester bounds the number of bundles in flight.
    const settled = await Promise.allSettled(
      dedupedPaths.map(async (relPath) => ({
        relPath,
        content: await provider.readFile(ref, relPath)
      }))
    );
    for (const [i, r] of settled.entries()) {
      const relPath = dedupedPaths[i];
      if (r.status === 'rejected') {
        opts.onError?.(ref, r.reason);
        continue;
      }
      const prim = extractFromFile({ ref, manifest }, { path: relPath, content: r.value.content });
      if (prim) {
        produced.push(prim);
      }
    }
  }

  // MCP servers are declared in the manifest itself; no file reads required.
  const mcpPrims = extractMcpPrimitives({ ref, manifest });
  for (const p of mcpPrims) {
    if (!seenPaths.has(p.path)) {
      produced.push(p);
      seenPaths.add(p.path);
    }
  }

  return produced;
}

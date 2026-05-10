/**
 * `registry` — the reusable layer for a generic `prompt-registry` CLI.
 *
 * Re-exports the building blocks a future CLI with subcommands like
 * `list`, `install`, `uninstall`, and `search` will consume:
 *
 *   - `core`  — shared data types (Primitive, BundleRef, BundleManifest,
 *               BundleProvider, PrimitiveKind).
 *   - `hub`   — GitHub transport, bundle providers, harvester, blob cache,
 *               progress log, integrity sidecar, token provider.
 *   - `paths` — XDG-style default paths for cache + index location.
 *
 * Usage from a new subcommand:
 *
 * ```ts
 * import {
 *   core,
 *   hub,
 *   paths,
 * } from '@prompt-registry/collection-scripts/registry';
 *
 * const provider: core.BundleProvider = new hub.GitHubSingleBundleProvider(...);
 * const harvester = new hub.HubHarvester({ ... });
 * const cacheDir = paths.defaultCacheDir();
 * ```
 * @module registry
 */

export * as core from '../core';
export * as hub from '../hub';
export * as paths from '../primitive-index/default-paths';

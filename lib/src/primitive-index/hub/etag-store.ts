/**
 * Re-export shim — the canonical EtagStore now lives at
 * `lib/src/github/etag-store.ts`. Kept here for one cycle so
 * downstream callers (and the harvester) don't need a flag-day
 * import update. New code should import from `../../github`.
 */
export { EtagStore, type EtagEntry } from '../../github/etag-store';

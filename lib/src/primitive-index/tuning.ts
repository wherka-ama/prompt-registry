/**
 * Tunable knobs for ranking. Kept in a single file so the eval harness can
 * reason about changes.
 */

export const FIELD_WEIGHTS = {
  title: 3,
  tags: 2,
  description: 1.5,
  bodyPreview: 1
} as const;

/** BM25 hyperparameters. k1 controls TF saturation, b controls length norm. */
export const BM25 = {
  k1: 1.2,
  b: 0.75
} as const;

/** Default mix for hybrid ranking (bm25 weight, embedding cosine weight). */
export const HYBRID_ALPHA = 0.6;

export type SearchableField = keyof typeof FIELD_WEIGHTS;
export const SEARCHABLE_FIELDS: SearchableField[] = ['title', 'tags', 'description', 'bodyPreview'];

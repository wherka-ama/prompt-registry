/**
 * Minimal BM25 engine over pre-tokenised documents with weighted fields.
 *
 * Determinism: stable tie-breaker ordering is the caller's responsibility;
 * this module only produces raw scores.
 */

import {
  BM25,
  FIELD_WEIGHTS,
  SEARCHABLE_FIELDS,
  type SearchableField,
} from './tuning';

export type FieldTokens = Record<SearchableField, string[]>;

export interface Bm25Doc {
  id: string;
  fields: FieldTokens;
}

interface PostingEntry {
  docIdx: number;
  tf: number;
}

export interface Bm25Stats {
  field: SearchableField;
  term: string;
  idf: number;
  /** Sum of BM25 contributions across matching docs (for debugging only). */
  total: number;
}

export class Bm25Engine {
  private readonly docs: Bm25Doc[];
  /** For each field: map term → postings. */
  private readonly postings: Record<SearchableField, Map<string, PostingEntry[]>>;
  /** For each field: per-doc length (token count). */
  private readonly docLens: Record<SearchableField, number[]>;
  private readonly avgLens: Record<SearchableField, number>;

  constructor(docs: Bm25Doc[]) {
    this.docs = docs;
    const postings = {} as Record<SearchableField, Map<string, PostingEntry[]>>;
    const docLens = {} as Record<SearchableField, number[]>;
    const avgLens = {} as Record<SearchableField, number>;

    for (const field of SEARCHABLE_FIELDS) {
      postings[field] = new Map();
      docLens[field] = Array.from<number>({ length: docs.length }).fill(0);
    }

    for (const [i, doc] of docs.entries()) {
      for (const field of SEARCHABLE_FIELDS) {
        const tokens = doc.fields[field] ?? [];
        docLens[field][i] = tokens.length;
        const tf = new Map<string, number>();
        for (const t of tokens) {
          tf.set(t, (tf.get(t) ?? 0) + 1);
        }
        for (const [term, count] of tf) {
          const list = postings[field].get(term);
          if (list) {
            list.push({ docIdx: i, tf: count });
          } else {
            postings[field].set(term, [{ docIdx: i, tf: count }]);
          }
        }
      }
    }

    for (const field of SEARCHABLE_FIELDS) {
      const lens = docLens[field];
      const total = lens.reduce((acc, n) => acc + n, 0);
      avgLens[field] = lens.length > 0 ? total / lens.length : 0;
    }

    this.postings = postings;
    this.docLens = docLens;
    this.avgLens = avgLens;
  }

  public get size(): number {
    return this.docs.length;
  }

  /**
   * IDF (Okapi variant, clamped to >=0).
   * @param field
   * @param term
   */
  private idf(field: SearchableField, term: string): number {
    const postings = this.postings[field].get(term);
    if (!postings) {
      return 0;
    }
    const n = this.docs.length;
    const df = postings.length;
    const raw = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    return Math.max(raw, 0);
  }

  /**
   * Score the corpus against the given query tokens, optionally restricted
   * to a set of candidate doc indices. Returns per-doc scores and (if
   * `explain`) the breakdown contributions.
   * @param queryTokens
   * @param candidates
   * @param explain
   */
  public score(
    queryTokens: string[],
    candidates?: Set<number>,
    explain = false
  ): {
    scores: Map<number, number>;
    explanations?: Map<number, { field: SearchableField; term: string; weight: number; contribution: number }[]>;
  } {
    const scores = new Map<number, number>();
    const explanations = explain ? new Map<number, { field: SearchableField; term: string; weight: number; contribution: number }[]>() : undefined;
    if (queryTokens.length === 0 || this.docs.length === 0) {
      return { scores, explanations };
    }

    const { k1, b } = BM25;
    const uniqueTerms = new Set(queryTokens);

    for (const field of SEARCHABLE_FIELDS) {
      const fieldWeight = FIELD_WEIGHTS[field];
      const postings = this.postings[field];
      const lens = this.docLens[field];
      const avg = this.avgLens[field] || 1;

      for (const term of uniqueTerms) {
        const list = postings.get(term);
        if (!list) {
          continue;
        }
        const idf = this.idf(field, term);
        if (idf === 0) {
          continue;
        }
        for (const { docIdx, tf } of list) {
          if (candidates && !candidates.has(docIdx)) {
            continue;
          }
          const dl = lens[docIdx];
          const norm = 1 - b + b * (dl / avg);
          const tfSat = (tf * (k1 + 1)) / (tf + k1 * norm);
          const contribution = fieldWeight * idf * tfSat;
          scores.set(docIdx, (scores.get(docIdx) ?? 0) + contribution);
          if (explanations) {
            const arr = explanations.get(docIdx) ?? [];
            arr.push({ field, term, weight: fieldWeight, contribution });
            explanations.set(docIdx, arr);
          }
        }
      }
    }

    return { scores, explanations };
  }
}

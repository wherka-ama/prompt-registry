/**
 * Evaluation harness for the primitive index.
 *
 * Runs a golden set of queries and reports recall@k, MRR, and nDCG@k.
 * Used by the eval unit test to gate ranking changes.
 */

import type {
  SearchQuery,
} from './types';
import type {
  PrimitiveIndex,
} from './index';

export interface GoldenCase {
  id: string;
  query: SearchQuery;
  /** Primitive IDs considered relevant (unordered). */
  relevant: string[];
  /** Optional expected-ordering hint — used for nDCG graded relevance. */
  gradedRelevance?: Record<string, number>;
}

export interface EvalReport {
  perCase: {
    id: string;
    recallAt5: number;
    recallAt10: number;
    recallAt20: number;
    mrr: number;
    ndcgAt10: number;
  }[];
  aggregate: {
    recallAt5: number;
    recallAt10: number;
    recallAt20: number;
    mrr: number;
    ndcgAt10: number;
  };
}

/**
 * Run the golden-set evaluation against an index and aggregate metrics.
 * @param index - The primitive index to query.
 * @param cases - Golden-set cases.
 */
export function runEval(index: PrimitiveIndex, cases: GoldenCase[]): EvalReport {
  const perCase: EvalReport['perCase'] = [];
  for (const c of cases) {
    const res = index.search({ ...c.query, limit: Math.max(20, c.query.limit ?? 20) });
    const hits = res.hits.map((h) => h.primitive.id);
    const relevant = new Set(c.relevant);

    const recall = (k: number): number => {
      if (relevant.size === 0) {
        return 1;
      }
      const top = hits.slice(0, k);
      let found = 0;
      for (const id of top) {
        if (relevant.has(id)) {
          found++;
        }
      }
      return found / relevant.size;
    };
    let mrr = 0;
    for (const [i, hit] of hits.entries()) {
      if (relevant.has(hit)) {
        mrr = 1 / (i + 1);
        break;
      }
    }
    const ndcgAt10 = ndcg(hits.slice(0, 10), c.gradedRelevance ?? defaultGrades(c.relevant));
    perCase.push({
      id: c.id,
      recallAt5: recall(5),
      recallAt10: recall(10),
      recallAt20: recall(20),
      mrr,
      ndcgAt10
    });
  }

  const avg = (key: keyof EvalReport['perCase'][number]) => {
    if (perCase.length === 0) {
      return 0;
    }
    let s = 0;
    for (const r of perCase) {
      s += r[key] as number;
    }
    return s / perCase.length;
  };

  return {
    perCase,
    aggregate: {
      recallAt5: avg('recallAt5'),
      recallAt10: avg('recallAt10'),
      recallAt20: avg('recallAt20'),
      mrr: avg('mrr'),
      ndcgAt10: avg('ndcgAt10')
    }
  };
}

function defaultGrades(relevant: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of relevant) {
    out[id] = 1;
  }
  return out;
}

function ndcg(rankedIds: string[], grades: Record<string, number>): number {
  const dcg = rankedIds.reduce((acc, id, i) => acc + (grades[id] ?? 0) / Math.log2(i + 2), 0);
  const ideal = Object.values(grades).toSorted((a, b) => b - a);
  const idcg = ideal.reduce((acc, g, i) => acc + g / Math.log2(i + 2), 0);
  return idcg === 0 ? 0 : dcg / idcg;
}

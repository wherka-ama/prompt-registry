import * as assert from 'node:assert';
import {
  type BenchCase,
  renderBenchReportMarkdown,
  runBench,
} from '../../src/primitive-index/bench';
import {
  PrimitiveIndex,
} from '../../src/primitive-index/index';
import type {
  BundleRef,
  Primitive,
} from '../../src/primitive-index/types';

function mkP(id: string, title: string, desc = ''): Primitive {
  const bundle: BundleRef = { sourceId: 's', sourceType: 'github', bundleId: 'b', bundleVersion: 'v', installed: false };
  return { id, bundle, kind: 'skill', path: '.', title, description: desc, tags: [], bodyPreview: '', contentHash: id };
}

describe('primitive-index / bench', () => {
  it('returns per-case + aggregate timing, with non-zero qps', () => {
    const idx = PrimitiveIndex.fromPrimitives([
      mkP('a', 'code-review', 'review code'),
      mkP('b', 'typescript-mcp', 'typescript mcp'),
      mkP('c', 'azure-pricing', 'azure price')
    ]);
    const cases: BenchCase[] = [
      { id: 'q1', query: { q: 'code' } },
      { id: 'q2', query: { q: 'azure' } }
    ];
    const r = runBench(idx, cases, 5);
    assert.strictEqual(r.perCase.length, 2);
    assert.strictEqual(r.perCase[0].iterations, 5);
    assert.ok(r.aggregate.totalQueries === 10);
    assert.ok(r.aggregate.qps > 0, 'qps should be positive');
    // median/p95/max should be in monotonic order.
    for (const c of r.perCase) {
      assert.ok(c.medianMs <= c.p95Ms + 1e-9, 'median <= p95');
      assert.ok(c.p95Ms <= c.maxMs + 1e-9, 'p95 <= max');
    }
  });

  it('renderBenchReportMarkdown emits a parseable table', () => {
    const idx = PrimitiveIndex.fromPrimitives([mkP('a', 'code-review')]);
    const r = runBench(idx, [{ id: 'q1', query: { q: 'code' } }], 3);
    const md = renderBenchReportMarkdown(r);
    assert.ok(md.includes('Search microbenchmark'));
    assert.ok(md.includes('Throughput:'));
    assert.ok(md.includes('| `q1` | 1 |'));
  });
});

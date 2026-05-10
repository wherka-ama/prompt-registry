import * as assert from 'node:assert';
import {
  matchPattern,
  type PatternCase,
  renderPatternReportMarkdown,
  runPatternEval,
} from '../../src/primitive-index/eval-pattern';
import {
  PrimitiveIndex,
} from '../../src/primitive-index/index';
import type {
  BundleRef,
  Primitive,
} from '../../src/primitive-index/types';

function mkBundle(sourceId: string, bundleId: string): BundleRef {
  return { sourceId, sourceType: 'github', bundleId, bundleVersion: 'x', installed: false };
}

function mkPrimitive(overrides: Partial<Primitive> & { id: string; title: string }): Primitive {
  return {
    id: overrides.id,
    bundle: overrides.bundle ?? mkBundle('src', 'bundle'),
    kind: overrides.kind ?? 'skill',
    path: overrides.path ?? 'somewhere',
    title: overrides.title,
    description: overrides.description ?? '',
    tags: overrides.tags ?? [],
    bodyPreview: overrides.bodyPreview ?? '',
    contentHash: overrides.contentHash ?? 'h'
  };
}

describe('primitive-index / eval-pattern', () => {
  it('matchPattern treats undefined pattern fields as wildcards', () => {
    const p = mkPrimitive({ id: 'a', title: 'code-review', bundle: mkBundle('src1', 'b1') });
    assert.strictEqual(matchPattern(p, { title: 'code-review' }), true);
    assert.strictEqual(matchPattern(p, { bundleId: 'b1' }), true);
    assert.strictEqual(matchPattern(p, { title: 'code-review', bundleId: 'b1' }), true);
    assert.strictEqual(matchPattern(p, { title: 'nope' }), false);
    assert.strictEqual(matchPattern(p, {}), true, 'empty pattern = wildcard');
  });

  it('matchPattern uses case-insensitive regex', () => {
    const p = mkPrimitive({ id: 'a', title: 'Code-Review' });
    assert.strictEqual(matchPattern(p, { title: 'code-review' }), true);
    assert.strictEqual(matchPattern(p, { title: 'CODE' }), true);
  });

  it('runPatternEval reports mustMatch/soft + passed flags', () => {
    const idx = PrimitiveIndex.fromPrimitives([
      mkPrimitive({ id: 'p1', title: 'code-review', kind: 'skill', bundle: mkBundle('rail', 'rail-context'), description: 'Review code changes' }),
      mkPrimitive({ id: 'p2', title: 'typescript-mcp-server-generator', kind: 'skill', bundle: mkBundle('ac', 'typescript-mcp-development'), description: 'Generate a typescript MCP server' }),
      mkPrimitive({ id: 'p3', title: 'unrelated-thing', kind: 'prompt', bundle: mkBundle('other', 'other'), description: 'totally different topic' })
    ]);
    const cases: PatternCase[] = [
      {
        id: 'code-review',
        query: { q: 'code review' },
        mustMatch: [{ title: 'code-review' }],
        shouldMatch: [{ kind: 'skill' }, { sourceId: 'rail' }]
      },
      {
        id: 'typescript-mcp',
        query: { q: 'typescript mcp' },
        mustMatch: [{ title: 'typescript-mcp-server-generator' }, { bundleId: 'typescript-mcp-development' }]
      },
      {
        id: 'impossible',
        query: { q: 'code review' },
        mustMatch: [{ title: 'does-not-exist' }]
      }
    ];
    const report = runPatternEval(idx, cases);
    assert.strictEqual(report.perCase.length, 3);
    assert.strictEqual(report.perCase[0].passed, true);
    assert.strictEqual(report.perCase[0].mustSatisfied, 1);
    assert.strictEqual(report.perCase[0].soft, 1, 'both shouldMatch satisfied');
    assert.strictEqual(report.perCase[1].passed, true);
    assert.strictEqual(report.perCase[1].mustSatisfied, 2);
    assert.strictEqual(report.perCase[2].passed, false);
    assert.strictEqual(report.aggregate.passed, 2);
    assert.strictEqual(report.aggregate.failed, 1);
    assert.ok(Math.abs(report.aggregate.passRate - 2 / 3) < 1e-9);
  });

  it('renderPatternReportMarkdown produces a parseable table with ✓/✗', () => {
    const idx = PrimitiveIndex.fromPrimitives([
      mkPrimitive({ id: 'p1', title: 'code-review', bundle: mkBundle('rail', 'rail-context'), description: 'review the code' })
    ]);
    const report = runPatternEval(idx, [
      { id: 'code-review', query: { q: 'code review' }, mustMatch: [{ title: 'code-review' }] }
    ]);
    const md = renderPatternReportMarkdown(report);
    assert.ok(md.includes('Pattern-based eval report'));
    assert.ok(md.includes('Passed: 1 / 1'));
    assert.ok(md.includes('100.0%'));
    assert.ok(md.includes('✓'));
  });
});

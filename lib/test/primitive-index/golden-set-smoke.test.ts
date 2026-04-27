import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type PatternCase,
  runPatternEval,
} from '../../src/primitive-index/eval-pattern';
import {
  PrimitiveIndex,
} from '../../src/primitive-index/index';
import type {
  BundleRef,
  Primitive,
} from '../../src/primitive-index/types';

function mkP(id: string, title: string, desc: string, bundleId = 'b', sourceId = 's', kind: Primitive['kind'] = 'skill'): Primitive {
  const bundle: BundleRef = { sourceId, sourceType: 'github', bundleId, bundleVersion: 'v', installed: false };
  return { id, bundle, kind, path: `${bundleId}/${id}`, title, description: desc, tags: [], bodyPreview: '', contentHash: id };
}

describe('primitive-index / golden-set schema', () => {
  // dist-test layout: dist-test/test/primitive-index/<file>.js → up 3 to lib/.
  // src layout (if run directly): test/primitive-index/<file>.ts → up 2 to lib/.
  // Try both, use whichever exists.
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'fixtures', 'golden-queries.json'),
    path.join(__dirname, '..', '..', 'fixtures', 'golden-queries.json')
  ];
  const goldenPath = candidates.find((p) => fs.existsSync(p)) ?? candidates[0];

  it('golden-queries.json parses and declares at least 15 cases', () => {
    const raw = fs.readFileSync(goldenPath, 'utf8');
    const parsed = JSON.parse(raw) as { description?: string; cases: PatternCase[] };
    assert.ok(parsed.cases.length >= 15, `expected >=15 cases, got ${parsed.cases.length}`);
    for (const c of parsed.cases) {
      assert.ok(c.id, 'case missing id');
      assert.ok(c.query, 'case missing query');
      assert.ok(Array.isArray(c.mustMatch), `case ${c.id} missing mustMatch`);
      assert.ok(c.mustMatch.length > 0, `case ${c.id} has zero mustMatch patterns`);
    }
  });

  it('every mustMatch pattern is a valid RegExp source', () => {
    const raw = fs.readFileSync(goldenPath, 'utf8');
    const parsed = JSON.parse(raw) as { cases: PatternCase[] };
    for (const c of parsed.cases) {
      for (const pat of c.mustMatch) {
        for (const [field, src] of Object.entries(pat)) {
          if (typeof src === 'string') {
            // Throws on invalid regex — surfaces gold-set authoring errors.
            assert.doesNotThrow(() => new RegExp(src, 'iu'), `case ${c.id} field ${field}: invalid regex ${src}`);
          }
        }
      }
    }
  });

  it('pattern-eval returns 100% pass on a synthetic in-memory index', () => {
    // Self-test: we build an index with synthetic primitives that
    // satisfy EVERY case in the gold set, so a regression in
    // runPatternEval (not in live data) is caught here.
    const synthetic = PrimitiveIndex.fromPrimitives([
      mkP('g1', 'code-review', 'review code changes', 'rail-context', 'rail-context'),
      mkP('g2', 'typescript-mcp-server-generator', 'generate typescript mcp server', 'typescript-mcp-development', 'upstream-ac'),
      mkP('g3', 'python-best-practices', 'python best practices guide', 'python', 'upstream-ac'),
      mkP('g4', 'az-cost-optimize', 'azure cost optimization', 'azure-cloud-development', 'upstream-ac'),
      mkP('g5', 'azure-pricing', 'azure retail pricing via api', 'azure-cloud-development', 'upstream-ac'),
      mkP('g6', 'swift-mcp-server-generator', 'swift mcp server scaffold', 'swift-mcp-development', 'upstream-ac'),
      mkP('g7', 'git-commit-prep', 'prepare git commit message', 'dsre-git-skillset', 'amadeus'),
      mkP('g8', 'unit-testing-guidelines', 'testing guidelines for modules', 'refx-customization', 'refx'),
      mkP('g9', 'arch-review', 'architecture review skill', 'clean-code-in-the-cloud', 'amadeus'),
      mkP('g10', 'openapi-to-application-code', 'openapi to rest api generator', 'openapi-to-application-csharp-dotnet', 'upstream-ac'),
      mkP('g11', 'import-infrastructure-as-code', 'terraform infrastructure discovery', 'azure-cloud-development', 'upstream-ac'),
      mkP('g12', 'dotnet-best-practices', 'dotnet security best practices', 'csharp-dotnet-development', 'upstream-ac'),
      mkP('g13', 'batch-elasticity', 'kubernetes helm batch elasticity', 'offer-agent-skills', 'amadeus'),
      mkP('g14', 'cna-docs-retrieval', 'documentation retrieval writer', 'clean-code-in-the-cloud', 'amadeus'),
      mkP('g15', 'context7-mcp', 'mcp server for context7', 'mcp-servers', 'amadeus', 'mcp-server'),
      mkP('g16', 'code-diff', 'code diff highlighter skill', 'tooling', 'amadeus'),
      mkP('g17', 'dotnet-upgrade', 'upgrade dotnet projects', 'csharp-dotnet-development', 'upstream-ac'),
      mkP('g18', 'reviewing-oracle-to-postgres-migration', 'oracle to postgres migration review', 'oracle-to-postgres-migration-expert', 'amadeus'),
      mkP('g19', 'sql-optimization', 'sql query optimization', 'database-data-management', 'amadeus'),
      mkP('g20', 'architecture-review', 'clean architecture assessment', 'clean-code-in-the-cloud', 'amadeus')
    ]);
    const raw = fs.readFileSync(goldenPath, 'utf8');
    const parsed = JSON.parse(raw) as { cases: PatternCase[] };
    const report = runPatternEval(synthetic, parsed.cases);
    if (report.aggregate.failed > 0) {
      // Fail with a descriptive list of the failing cases.
      const failing = report.perCase.filter((r) => !r.passed).map((r) => ({
        id: r.id,
        must: `${r.mustSatisfied}/${r.mustTotal}`,
        top1: r.topK[0] ? `${r.topK[0].title} (${r.topK[0].bundleId})` : '—'
      }));
      assert.fail(`Gold-set regressed on synthetic index:\n${JSON.stringify(failing, null, 2)}`);
    }
    assert.strictEqual(report.aggregate.passed, parsed.cases.length);
  });
});

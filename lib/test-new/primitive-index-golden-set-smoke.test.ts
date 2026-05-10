import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  type PatternCase,
  runPatternEval,
} from '../src/primitive-index/eval-pattern';
import {
  PrimitiveIndex,
} from '../src/primitive-index/index';
import type {
  BundleRef,
  Primitive,
} from '../src/primitive-index/types';

function mkP(id: string, title: string, desc: string, bundleId = 'b', sourceId = 's', kind: Primitive['kind'] = 'skill'): Primitive {
  const bundle: BundleRef = { sourceId, sourceType: 'github', bundleId, bundleVersion: 'v', installed: false };
  return { id, bundle, kind, path: `${bundleId}/${id}`, title, description: desc, tags: [], bodyPreview: '', contentHash: id };
}

describe('golden-set schema', () => {
  const goldenPath = path.join(__dirname, '..', 'fixtures', 'golden-queries.json');

  it('golden-queries.json parses and declares at least 15 cases', () => {
    const raw = fs.readFileSync(goldenPath, 'utf8');
    const parsed = JSON.parse(raw) as { description?: string; cases: PatternCase[] };
    expect(parsed.cases.length).toBeGreaterThanOrEqual(15);
    for (const c of parsed.cases) {
      expect(c.id).toBeTruthy();
      expect(c.query).toBeTruthy();
      expect(Array.isArray(c.mustMatch)).toBe(true);
      expect(c.mustMatch.length).toBeGreaterThan(0);
    }
  });

  it('every mustMatch pattern is a valid RegExp source', () => {
    const raw = fs.readFileSync(goldenPath, 'utf8');
    const parsed = JSON.parse(raw) as { cases: PatternCase[] };
    for (const c of parsed.cases) {
      for (const pat of c.mustMatch) {
        for (const src of Object.values(pat)) {
          if (typeof src === 'string') {
            expect(() => new RegExp(src, 'iu')).not.toThrow();
          }
        }
      }
    }
  });

  it('pattern-eval returns 100% pass on a synthetic in-memory index', () => {
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
      const failing = report.perCase.filter((r) => !r.passed).map((r) => ({
        id: r.id,
        must: `${r.mustSatisfied}/${r.mustTotal}`,
        top1: r.topK[0] ? `${r.topK[0].title} (${r.topK[0].bundleId})` : '—'
      }));
      expect.fail(`Gold-set regressed on synthetic index:\n${JSON.stringify(failing, null, 2)}`);
    }
    expect(report.aggregate.passed).toBe(parsed.cases.length);
  });
});

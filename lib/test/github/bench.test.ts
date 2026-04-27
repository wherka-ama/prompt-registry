/**
 * Microbenchmark for the github/ middleware.
 *
 * Gated behind `RUN_BENCH=1` so default `npm test` stays fast (the
 * bench runs N=200 iterations across 5 cases, ~few hundred ms total
 * but it's pure CPU and not part of the correctness gate).
 *
 * Asserts that p95 of every case stays under its threshold and
 * prints a markdown summary on stdout — useful for CI logs and PR
 * descriptions.
 */
import {
  strict as assert,
} from 'node:assert';
import {
  describe,
  it,
} from 'mocha';
import {
  standardBenchCases,
} from '../../src/github/bench/cases';
import {
  renderBenchReport,
  runBench,
} from '../../src/github/bench/harness';

const enabled = process.env.RUN_BENCH === '1';
const describeIfEnabled = enabled ? describe : describe.skip;

describeIfEnabled('github/bench', () => {
  it('all standard cases meet their thresholds', async function () {
    this.timeout(30_000);
    const report = await runBench(standardBenchCases(), 200);
    process.stdout.write('\n' + renderBenchReport(report));
    assert.equal(
      report.aggregate.allPassed,
      true,
      'one or more bench cases exceeded their threshold'
    );
  });
});

// Smoke test (always runs): ensures the harness + cases are
// structurally sound. N=2 to keep it cheap.
describe('github/bench smoke', () => {
  it('produces a renderable report at low iterations', async () => {
    const report = await runBench(standardBenchCases(), 2);
    assert.equal(report.perCase.length, 5);
    const md = renderBenchReport(report);
    assert.match(md, /github middleware microbenchmark/);
    assert.match(md, /\| `cold` \|/);
  });
});

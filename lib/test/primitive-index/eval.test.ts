import * as assert from 'node:assert';
import {
  type GoldenCase,
  runEval,
} from '../../src/primitive-index/eval';
import {
  computePrimitiveId,
} from '../../src/primitive-index/extract';
import {
  PrimitiveIndex,
} from '../../src/primitive-index/index';
import {
  createFixtureBundles,
  FakeBundleProvider,
} from './fixtures';

// DoD thresholds from PRIMITIVE_INDEX_DESIGN.md §11.
const RECALL_AT_10_MIN = 0.8;
const MRR_MIN = 0.55;

function primId(source: string, bundle: string, relPath: string): string {
  return computePrimitiveId(source, bundle, relPath);
}

const GOLDEN: GoldenCase[] = [
  {
    id: 'q1-terraform-module',
    query: { q: 'terraform module scaffold', limit: 10 },
    relevant: [
      primId('hub-a', 'terraform-helpers', 'prompts/terraform-module.prompt.md')
    ]
  },
  {
    id: 'q2-rust-onboarding',
    query: { q: 'rust ownership beginner', limit: 10 },
    relevant: [
      primId('hub-a', 'rust-onboarding', 'prompts/rust-intro.prompt.md')
    ]
  },
  {
    id: 'q3-code-review-kind-filter',
    query: { q: 'review pull request', kinds: ['prompt'], limit: 10 },
    relevant: [
      primId('hub-b', 'code-review-kit', 'prompts/code-review.prompt.md'),
      primId('hub-a', 'terraform-helpers', 'prompts/terraform-review.prompt.md')
    ]
  },
  {
    id: 'q4-chatmode-reviewer',
    query: { q: 'pair reviewer', kinds: ['chat-mode'], limit: 10 },
    relevant: [
      primId('hub-b', 'code-review-kit', 'chatmodes/pair-reviewer.chatmode.md'),
      primId('hub-a', 'terraform-helpers', 'chatmodes/terraform-reviewer.chatmode.md')
    ]
  },
  {
    id: 'q5-instruction-tag-filter',
    query: { tags: ['checklist'], limit: 10 },
    relevant: [
      primId('hub-b', 'code-review-kit', 'instructions/pr-checklist.instructions.md')
    ]
  },
  {
    id: 'q6-skill-cargo',
    query: { q: 'cargo build runner', limit: 10 },
    relevant: [
      primId('hub-a', 'rust-onboarding', 'skills/cargo-runner/SKILL.md')
    ]
  },
  {
    id: 'q7-mcp-linter',
    query: { q: 'terraform linter', limit: 10 },
    relevant: [
      primId('hub-a', 'terraform-helpers', 'mcp/tf-linter')
    ]
  },
  {
    id: 'q8-rust-mentor',
    query: { q: 'mentor helps onboard rust developer', limit: 10 },
    relevant: [
      primId('hub-a', 'rust-onboarding', 'agents/rust-mentor.agent.md')
    ]
  },
  // --- harder cases against the distractor corpus ------------------------
  {
    id: 'q9-python-pandas',
    query: { q: 'pandas dataframe analysis', limit: 10 },
    relevant: [primId('hub-a', 'python-data', 'prompts/pandas-intro.prompt.md')]
  },
  {
    id: 'q10-ml-pipeline-sklearn',
    query: { q: 'scikit-learn training pipeline', limit: 10 },
    relevant: [primId('hub-a', 'python-data', 'prompts/ml-pipeline.prompt.md')]
  },
  {
    id: 'q11-release-notes',
    query: { q: 'write release notes from changelog', limit: 10 },
    relevant: [primId('hub-a', 'docs-writers', 'prompts/release-notes.prompt.md')]
  },
  {
    id: 'q12-tech-writer-chatmode',
    query: { q: 'technical documentation editor', kinds: ['chat-mode'], limit: 10 },
    relevant: [primId('hub-a', 'docs-writers', 'chatmodes/tech-writer.chatmode.md')]
  },
  {
    id: 'q13-threat-modelling-agent',
    query: { q: 'stride threat model', kinds: ['agent'], limit: 10 },
    relevant: [primId('hub-b', 'security-review', 'agents/threat-modeler.agent.md')]
  },
  {
    id: 'q14-owasp-review',
    query: { q: 'owasp top 10 web security', limit: 10 },
    relevant: [primId('hub-b', 'security-review', 'prompts/owasp-review.prompt.md')]
  },
  {
    id: 'q15-kubernetes-manifest',
    query: { q: 'kubernetes deployment manifest web app', limit: 10 },
    relevant: [primId('hub-b', 'devops-kit', 'prompts/k8s-manifest.prompt.md')]
  },
  {
    id: 'q16-github-actions-ci',
    query: { q: 'github actions workflow build test', limit: 10 },
    relevant: [primId('hub-b', 'devops-kit', 'prompts/ci-pipeline.prompt.md')]
  },
  {
    id: 'q17-sre-oncall-chatmode',
    query: { q: 'incident triage oncall', kinds: ['chat-mode'], limit: 10 },
    relevant: [primId('hub-b', 'devops-kit', 'chatmodes/sre-on-call.chatmode.md')]
  },
  {
    id: 'q18-python-style-instruction',
    query: { q: 'python type annotations mypy', kinds: ['instruction'], limit: 10 },
    relevant: [primId('hub-a', 'python-data', 'instructions/type-hints.instructions.md')]
  },
  {
    id: 'q19-secrets-instruction',
    query: { q: 'avoid committing secrets keys', kinds: ['instruction'], limit: 10 },
    relevant: [primId('hub-b', 'security-review', 'instructions/secret-scanning.instructions.md')]
  },
  {
    id: 'q20-api-docs',
    query: { q: 'rest api reference documentation', limit: 10 },
    relevant: [primId('hub-a', 'docs-writers', 'prompts/api-docs.prompt.md')]
  },
  // --- purely facet-only query (deterministic path) ---------------------
  {
    id: 'q21-tag-security',
    query: { tags: ['security'], limit: 20 },
    relevant: [
      primId('hub-b', 'security-review', 'agents/threat-modeler.agent.md'),
      primId('hub-b', 'security-review', 'prompts/owasp-review.prompt.md'),
      primId('hub-b', 'security-review', 'instructions/secret-scanning.instructions.md')
    ]
  }
];

describe('primitive-index eval harness', () => {
  it('meets recall@10 and MRR thresholds on the golden set', async () => {
    const idx = await PrimitiveIndex.buildFrom(new FakeBundleProvider(createFixtureBundles()));
    const report = runEval(idx, GOLDEN);
    // Surface a human-readable breakdown if it fails.
    const summary = JSON.stringify(report.aggregate);
    if (process.env.PRIMITIVE_INDEX_EVAL_REPORT === '1') {
      process.stdout.write('\n=== primitive-index eval ===\n');
      process.stdout.write(JSON.stringify(report.aggregate, null, 2) + '\n');
      for (const c of report.perCase) {
        process.stdout.write(
          `  ${c.id}  r@10=${c.recallAt10.toFixed(2)}  mrr=${c.mrr.toFixed(2)}  ndcg=${c.ndcgAt10.toFixed(2)}\n`
        );
      }
    }
    assert.ok(
      report.aggregate.recallAt10 >= RECALL_AT_10_MIN,
      `recall@10 ${report.aggregate.recallAt10.toFixed(3)} < ${RECALL_AT_10_MIN} — ${summary}`
    );
    assert.ok(
      report.aggregate.mrr >= MRR_MIN,
      `MRR ${report.aggregate.mrr.toFixed(3)} < ${MRR_MIN} — ${summary}`
    );
  });

  it('is stable: running the eval twice yields identical metrics', async () => {
    const idx = await PrimitiveIndex.buildFrom(new FakeBundleProvider(createFixtureBundles()));
    const a = runEval(idx, GOLDEN);
    const b = runEval(idx, GOLDEN);
    assert.deepStrictEqual(a.aggregate, b.aggregate);
  });
});

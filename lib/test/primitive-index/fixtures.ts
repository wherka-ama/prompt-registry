/**
 * In-memory fixtures and a tiny BundleProvider to drive the tests.
 */

import type {
  BundleManifest,
  BundleProvider,
  BundleRef,
} from '../../src/primitive-index/types';

export interface FakeBundle {
  ref: BundleRef;
  manifest: BundleManifest;
  files: Record<string, string>;
}

export class FakeBundleProvider implements BundleProvider {
  public constructor(private readonly bundles: FakeBundle[]) {}

  private find(ref: BundleRef): FakeBundle {
    const b = this.bundles.find(
      (x) => x.ref.sourceId === ref.sourceId && x.ref.bundleId === ref.bundleId
    );
    if (!b) {
      throw new Error(`Unknown bundle ${ref.sourceId}/${ref.bundleId}`);
    }
    return b;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async generator required by BundleProvider interface; fixture is in-memory.
  public async* listBundles(): AsyncIterable<BundleRef> {
    for (const b of this.bundles) {
      yield b.ref;
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async required by BundleProvider interface; fixture is in-memory.
  public async readManifest(ref: BundleRef): Promise<BundleManifest> {
    return this.find(ref).manifest;
  }

  public readFile(ref: BundleRef, relPath: string): Promise<string> {
    const b = this.find(ref);
    const content = b.files[relPath];
    if (content === undefined) {
      return Promise.reject(new Error(`Missing file ${relPath} in ${ref.bundleId}`));
    }
    return Promise.resolve(content);
  }
}

function promptFile(title: string, description: string, body: string, tags: string[] = []): string {
  const tagsLine = tags.length > 0 ? `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]` : '';
  return `---
title: ${JSON.stringify(title)}
description: ${JSON.stringify(description)}
${tagsLine}
---

${body}
`;
}

/**
 * Build the canonical fixture set used across primitive-index tests.
 */
export function createFixtureBundles(): FakeBundle[] {
  return [
    {
      ref: {
        sourceId: 'hub-a',
        sourceType: 'awesome-copilot',
        bundleId: 'terraform-helpers',
        bundleVersion: '1.2.0',
        installed: true
      },
      manifest: {
        id: 'terraform-helpers',
        version: '1.2.0',
        name: 'Terraform Helpers',
        description: 'Prompts and chat modes for Terraform',
        tags: ['terraform', 'iac', 'cloud'],
        items: [
          { path: 'prompts/terraform-module.prompt.md', kind: 'prompt', tags: ['terraform', 'module'] },
          { path: 'prompts/terraform-review.prompt.md', kind: 'prompt', tags: ['terraform', 'review'] },
          { path: 'chatmodes/terraform-reviewer.chatmode.md', kind: 'chat-mode', tags: ['review'] }
        ],
        mcp: {
          items: {
            'tf-linter': { type: 'stdio', command: 'tflint', description: 'Terraform static analyser' }
          }
        }
      },
      files: {
        'prompts/terraform-module.prompt.md': promptFile(
          'Write a Terraform module',
          'Scaffold a reusable Terraform module with variables, outputs and providers.',
          '# Write a Terraform module\n\nCreate a module under modules/ with variables.tf outputs.tf and main.tf.',
          ['terraform', 'module', 'infrastructure']
        ),
        'prompts/terraform-review.prompt.md': promptFile(
          'Review Terraform code',
          'Review Terraform HCL code for best practices and security.',
          '# Review Terraform\n\nCheck for hardcoded credentials, resource naming, and state management.',
          ['terraform', 'review', 'security']
        ),
        'chatmodes/terraform-reviewer.chatmode.md': promptFile(
          'Terraform Reviewer',
          'Chat mode that behaves like a Terraform code reviewer.',
          '# Terraform Reviewer\n\nYou are a senior SRE reviewing Terraform code.',
          ['terraform', 'review']
        )
      }
    },
    {
      ref: {
        sourceId: 'hub-a',
        sourceType: 'awesome-copilot',
        bundleId: 'rust-onboarding',
        bundleVersion: '0.3.1',
        installed: false
      },
      manifest: {
        id: 'rust-onboarding',
        version: '0.3.1',
        name: 'Rust Onboarding',
        description: 'Prompts, instructions and chat modes that help new Rust developers.',
        tags: ['rust', 'onboarding'],
        items: [
          { path: 'prompts/rust-intro.prompt.md', kind: 'prompt', tags: ['rust', 'intro'] },
          { path: 'instructions/rust-style.instructions.md', kind: 'instruction', tags: ['rust', 'style'] },
          { path: 'agents/rust-mentor.agent.md', kind: 'agent', tags: ['rust', 'mentor'] },
          { path: 'skills/cargo-runner/SKILL.md', kind: 'skill', tags: ['rust', 'cargo'] }
        ]
      },
      files: {
        'prompts/rust-intro.prompt.md': promptFile(
          'Rust crash course',
          'Explain ownership, borrowing, and lifetimes with a worked example.',
          '# Rust crash course\n\nOwnership keeps memory safe without GC.',
          ['rust', 'ownership', 'beginner']
        ),
        'instructions/rust-style.instructions.md': `---
title: "Rust style"
description: "Project-wide style rules for Rust code."
applyTo: "**/*.rs"
tags: [rust, style, lint]
---

# Rust style

Use rustfmt default, prefer iterator chains, avoid unwrap in production code.
`,
        'agents/rust-mentor.agent.md': promptFile(
          'Rust Mentor',
          'Agent that pair-programs Rust code with the user and explains errors.',
          '# Rust Mentor\n\nYou help onboard a developer new to Rust.',
          ['rust', 'mentor']
        ),
        'skills/cargo-runner/SKILL.md': `---
name: cargo-runner
description: "Runs cargo commands and summarises compiler errors for the user."
---

# cargo-runner

Run \`cargo build\`, \`cargo test\`, parse diagnostics.
`
      }
    },
    {
      ref: {
        sourceId: 'hub-b',
        sourceType: 'github',
        bundleId: 'code-review-kit',
        bundleVersion: '2.0.0',
        installed: false
      },
      manifest: {
        id: 'code-review-kit',
        version: '2.0.0',
        name: 'Code Review Kit',
        description: 'Generic code review prompts and chat modes across languages.',
        tags: ['review', 'quality'],
        items: [
          { path: 'prompts/code-review.prompt.md', kind: 'prompt', tags: ['review'] },
          { path: 'chatmodes/pair-reviewer.chatmode.md', kind: 'chat-mode', tags: ['review', 'pair'] },
          { path: 'instructions/pr-checklist.instructions.md', kind: 'instruction', tags: ['pr', 'checklist'] }
        ]
      },
      files: {
        'prompts/code-review.prompt.md': promptFile(
          'Code review',
          'Review a code diff for readability, tests, and security issues.',
          '# Code review\n\nSummarise the change, call out risky areas.',
          ['review', 'diff']
        ),
        'chatmodes/pair-reviewer.chatmode.md': promptFile(
          'Pair Reviewer',
          'Chat mode that acts as a reviewer pairing on a PR.',
          '# Pair Reviewer\n\nYou are an experienced reviewer helping the author improve.',
          ['review', 'pair']
        ),
        'instructions/pr-checklist.instructions.md': promptFile(
          'PR checklist',
          'Repository-wide checklist to apply on every pull request.',
          '# PR checklist\n\n- tests\n- docs\n- changelog',
          ['pr', 'checklist']
        )
      }
    },
    // --- distractor bundles (realistic noise to stress BM25) -------------
    {
      ref: {
        sourceId: 'hub-a',
        sourceType: 'awesome-copilot',
        bundleId: 'python-data',
        bundleVersion: '1.0.0',
        installed: false
      },
      manifest: {
        id: 'python-data', version: '1.0.0', name: 'Python Data Science',
        description: 'Prompts for Python data analysis and ML.',
        tags: ['python', 'data', 'ml'],
        items: [
          { path: 'prompts/pandas-intro.prompt.md', kind: 'prompt', tags: ['python', 'pandas'] },
          { path: 'prompts/ml-pipeline.prompt.md', kind: 'prompt', tags: ['python', 'ml', 'pipeline'] },
          { path: 'instructions/type-hints.instructions.md', kind: 'instruction', tags: ['python', 'style'] }
        ]
      },
      files: {
        'prompts/pandas-intro.prompt.md': promptFile(
          'Pandas intro',
          'Load, filter and aggregate tabular data with pandas.',
          '# Pandas intro\n\nDataFrames, Series, indexing, groupby aggregations.',
          ['python', 'pandas', 'dataframe']
        ),
        'prompts/ml-pipeline.prompt.md': promptFile(
          'ML pipeline',
          'Design a scikit-learn training pipeline with cross validation.',
          '# ML pipeline\n\nPipeline, ColumnTransformer, GridSearchCV.',
          ['python', 'ml', 'sklearn', 'pipeline']
        ),
        'instructions/type-hints.instructions.md': promptFile(
          'Python type hints',
          'Apply strict type hints across the Python codebase.',
          '# Type hints\n\nAdd annotations, use mypy, prefer protocols.',
          ['python', 'types', 'mypy']
        )
      }
    },
    {
      ref: {
        sourceId: 'hub-a',
        sourceType: 'awesome-copilot',
        bundleId: 'docs-writers',
        bundleVersion: '1.4.2',
        installed: true
      },
      manifest: {
        id: 'docs-writers', version: '1.4.2', name: 'Docs writing toolkit',
        description: 'Chat modes and prompts for technical writers.',
        tags: ['docs', 'writing'],
        items: [
          { path: 'chatmodes/tech-writer.chatmode.md', kind: 'chat-mode', tags: ['docs', 'writing'] },
          { path: 'prompts/release-notes.prompt.md', kind: 'prompt', tags: ['docs', 'release'] },
          { path: 'prompts/api-docs.prompt.md', kind: 'prompt', tags: ['docs', 'api'] }
        ]
      },
      files: {
        'chatmodes/tech-writer.chatmode.md': promptFile(
          'Technical writer',
          'Chat mode that rewrites engineering content for clarity and brevity.',
          '# Technical writer\n\nYou help engineers polish documentation.',
          ['docs', 'writing', 'editor']
        ),
        'prompts/release-notes.prompt.md': promptFile(
          'Release notes',
          'Compose concise user-facing release notes from a changelog.',
          '# Release notes\n\nHighlight user impact, group by theme.',
          ['docs', 'release', 'changelog']
        ),
        'prompts/api-docs.prompt.md': promptFile(
          'API docs',
          'Write REST API reference pages with examples.',
          '# API docs\n\nEndpoint, parameters, response, errors.',
          ['docs', 'api', 'openapi']
        )
      }
    },
    {
      ref: {
        sourceId: 'hub-b',
        sourceType: 'github',
        bundleId: 'security-review',
        bundleVersion: '3.1.0',
        installed: false
      },
      manifest: {
        id: 'security-review', version: '3.1.0', name: 'Security review kit',
        description: 'Agents and prompts for threat modelling and security review.',
        tags: ['security', 'review', 'threat-model'],
        items: [
          { path: 'agents/threat-modeler.agent.md', kind: 'agent', tags: ['security', 'threat'] },
          { path: 'prompts/owasp-review.prompt.md', kind: 'prompt', tags: ['security', 'owasp'] },
          { path: 'instructions/secret-scanning.instructions.md', kind: 'instruction', tags: ['security', 'secrets'] }
        ]
      },
      files: {
        'agents/threat-modeler.agent.md': promptFile(
          'Threat modeler',
          'Agent that guides a STRIDE threat modelling session for a system design.',
          '# Threat modeler\n\nSTRIDE: Spoofing, Tampering, Repudiation, Information disclosure, DoS, Elevation.',
          ['security', 'threat', 'stride']
        ),
        'prompts/owasp-review.prompt.md': promptFile(
          'OWASP code review',
          'Review source code against the OWASP Top 10 web vulnerabilities.',
          '# OWASP review\n\nInjection, broken auth, XSS, SSRF.',
          ['security', 'owasp', 'review']
        ),
        'instructions/secret-scanning.instructions.md': promptFile(
          'Secret scanning',
          'Repo-wide instruction: never commit secrets; use env vars.',
          '# Secret scanning\n\nNo AWS keys, tokens or private keys in source.',
          ['security', 'secrets']
        )
      }
    },
    {
      ref: {
        sourceId: 'hub-b',
        sourceType: 'github',
        bundleId: 'devops-kit',
        bundleVersion: '0.9.0',
        installed: false
      },
      manifest: {
        id: 'devops-kit', version: '0.9.0', name: 'DevOps kit',
        description: 'Kubernetes and CI/CD prompts.',
        tags: ['devops', 'kubernetes', 'ci'],
        items: [
          { path: 'prompts/k8s-manifest.prompt.md', kind: 'prompt', tags: ['kubernetes', 'manifest'] },
          { path: 'prompts/ci-pipeline.prompt.md', kind: 'prompt', tags: ['ci', 'github-actions'] },
          { path: 'chatmodes/sre-on-call.chatmode.md', kind: 'chat-mode', tags: ['sre', 'oncall'] }
        ]
      },
      files: {
        'prompts/k8s-manifest.prompt.md': promptFile(
          'Kubernetes manifest',
          'Produce a Deployment, Service and Ingress manifest for a web app.',
          '# Kubernetes manifest\n\napiVersion apps/v1, Deployment, rollingUpdate.',
          ['kubernetes', 'manifest', 'deployment']
        ),
        'prompts/ci-pipeline.prompt.md': promptFile(
          'CI pipeline',
          'Design a GitHub Actions workflow for build, test and release.',
          '# CI pipeline\n\njobs, matrix strategy, caching, artifacts.',
          ['ci', 'github-actions', 'workflow']
        ),
        'chatmodes/sre-on-call.chatmode.md': promptFile(
          'SRE on-call',
          'Chat mode that mimics an on-call SRE triaging incidents.',
          '# SRE on-call\n\nTriage alerts, check runbooks, post mortem.',
          ['sre', 'oncall', 'incident']
        )
      }
    }
  ];
}

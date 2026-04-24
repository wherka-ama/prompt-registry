---
name: primitive-finder
description: "Finds Copilot agentic primitives (prompts, instructions, chat modes, agents, skills, MCP servers) reachable through the user's active hub. Use it when the user asks whether a primitive exists for a task/domain, wants to build a shortlist, or wants to turn that shortlist into a reusable profile."
---

# primitive-finder

This skill wraps the deterministic `primitive-index` CLI exposed by
`@prompt-registry/collection-scripts`. It lets the model answer questions like:

- "Is there a prompt for writing Terraform modules?"
- "Find me chat modes about code review."
- "Assemble a profile for Rust onboarding."

## When to use

Use this skill **instead of searching the workspace** whenever the user
is asking about Copilot prompts / agents / skills / MCP servers that might
exist in their active hub. The CLI returns JSON, so parse it directly.

## How to use

1. Ensure there is a built index on disk (default path:
   `~/.prompt-registry/primitive-index.json`). If not, tell the user to run
   `primitive-index build --root <hub-cache>` or invoke the
   extension's "Primitive Index: Build" command.
2. Call the CLI with `--json` for stable output:

   ```bash
   primitive-index search --index <file> --q "<user task>" --limit 10 --json
   ```

   Useful flags: `--kinds prompt,agent`, `--sources <id>`, `--tags <t1,t2>`,
   `--installed-only`, `--explain`.

3. Summarise the top 3–5 hits by `title`, `kind`, and `bundle`. Always surface
   the `primitive.id` values so follow-up commands can reference them.

4. If the user wants to keep a set:
   ```bash
   primitive-index shortlist new --index <file> --name "<name>"
   primitive-index shortlist add --index <file> --id <slId> --primitive <pId>
   ```

5. When ready to publish a profile:
   ```bash
   primitive-index export --index <file> --shortlist <slId> --profile-id <id> \
     --out-dir ./out --suggest-collection
   ```

## Guarantees

- The search is deterministic (BM25 + facets) — same inputs always yield
  the same ranking. Safe to chain.
- Ranks are stable across runs; ties broken by `(rating, bundleId, path)`.
- `--explain` shows per-field term contributions; use it when the user
  wonders why a hit ranked where it did.

## Evaluation

The CLI contract is covered by a golden-set evaluation
(`lib/test/primitive-index/eval.test.ts`) with thresholds:

- `recall@10 ≥ 0.80`
- `MRR ≥ 0.55`

If these slip, this skill's behaviour may degrade; check the eval report
before shipping ranking changes.

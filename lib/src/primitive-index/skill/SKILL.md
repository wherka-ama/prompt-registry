---
name: primitive-finder
description: "Finds Copilot agentic primitives (prompts, instructions, chat modes, agents, skills, MCP servers) reachable through the user's active hub. Use it when the user asks whether a primitive exists for a task/domain, wants to build a shortlist, or wants to turn that shortlist into a reusable profile."
---

# primitive-finder

This skill wraps the deterministic primitive-index search exposed by
the unified `prompt-registry index <verb>` CLI of
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
   `~/.cache/prompt-registry/primitive-index.json`). If not, tell the user
   to run `prompt-registry index harvest --hub-repo <owner/repo>` (or
   `index build --root <local-folder>` for a local-only set), or invoke
   the extension's "Primitive Index: Build" command.
2. Call the CLI with `-o json` for the canonical envelope:

   ```bash
   prompt-registry index search --q "<user task>" --limit 10 -o json
   ```

   Parse `data.hits` and `data.total` from the envelope.
   Useful flags: `--kinds prompt,agent`, `--sources <id>`, `--tags <t1,t2>`,
   `--installed-only`, `--explain`. Override the index location with
   `--index <file>` if the user has multiple.

3. Summarise the top 3–5 hits by `title`, `kind`, and `bundle`. Always surface
   the `primitive.id` values so follow-up commands can reference them.

4. If the user wants to keep a set:

   ```bash
   prompt-registry index shortlist new --name "<name>" -o json
   prompt-registry index shortlist add --id <slId> --primitive <pId> -o json
   ```

5. When ready to publish a profile:

   ```bash
   prompt-registry index export --shortlist <slId> --profile-id <id> \
     --out-dir ./out --suggest-collection
   ```

## Guarantees

- The search is deterministic (BM25 + facets) — same inputs always yield
  the same ranking. Safe to chain.
- Ranks are stable across runs; ties broken by `(rating, bundleId, path)`.
- `--explain` shows per-field term contributions; use it when the user
  wonders why a hit ranked where it did.

## Evaluation

Ranking quality is gated by a pattern-based golden-set
(`lib/fixtures/golden-queries.json`) run through
`prompt-registry index eval`. Every PR that touches the search /
ranking path must pass with no failed cases. Run locally:

```bash
prompt-registry index eval --gold lib/fixtures/golden-queries.json -o json
```

If cases fail, this skill's behaviour may degrade; check the eval report
before shipping ranking changes.

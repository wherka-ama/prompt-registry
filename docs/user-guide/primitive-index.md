# Primitive Index — user guide

The primitive index is a **local, BM25-backed search engine** for agentic
primitives (agents, chat-modes, instructions, MCP servers, prompts, and
skills) across every Copilot-style bundle published under a registry
hub. One command harvests a hub, another searches it.

## Who should use this?

- **Prompt-pack shoppers** who want to discover a skill/agent/prompt that
  already does what they need, before writing their own.
- **Hub maintainers** reviewing what is (and isn't) covered across their
  federated sources.
- **Extension users** who rely on the VS Code command *"Primitive Index:
  Harvest from hub…"* and the QuickPick search.
- **CI gatekeepers** validating ranking quality via a golden-set.

## Install

From the repository root:

```bash
# One-off build of the library (also needed for contributors).
cd lib
npm install
npm run build
```

The CLI lives at `lib/bin/primitive-index.js`. Add it to PATH or alias:

```bash
alias primitive-index='node /path/to/prompt-registry/lib/bin/primitive-index.js'
```

## Authenticate with GitHub

Hub harvesting requires a GitHub token. The CLI resolves one from, in
order:

1. `GITHUB_TOKEN` env var
2. `GH_TOKEN` env var
3. The `gh` CLI (`gh auth status`)

For public repositories a fine-grained PAT with "Public Repositories
(read-only)" is enough.

## Default paths

The CLI writes to an XDG-style cache so **you rarely need flags**:

| What | Default path | Overrides |
|------|--------------|-----------|
| Cache root | `$PROMPT_REGISTRY_CACHE` → `$XDG_CACHE_HOME/prompt-registry` → `~/.cache/prompt-registry` | env var, then `--cache-dir` |
| Index file | `<cache>/primitive-index.json` | `--index` or `--out` |
| Hub cache | `<cache>/hubs/<owner>_<repo>/` | `--cache-dir` |
| Progress log | `<hub-cache>/progress.jsonl` | `--progress` |

On Linux with no overrides: `~/.cache/prompt-registry/primitive-index.json`.

## Lifecycle

```mermaid
flowchart LR
  u[User] -->|1. harvest| cli[primitive-index<br/>hub-harvest]
  cli -->|2. GET trees/blobs| gh[(GitHub<br/>API)]
  cli -->|3. writes| idx[(primitive-index.json)]
  cli -->|4. writes| cache[(hubs/&lt;hub&gt;/<br/>blobs + progress + etag)]
  u2[User] -->|5. search| cli2[primitive-index<br/>search]
  cli2 -->|6. reads| idx
  cli2 -->|7. hits| u2
```

**Step 1** hits every source in `hub-config.yml` (plus any
`--extra-source`). **Step 2–4** populate the content-addressed blob
cache and write the searchable index. **Step 5–7** are offline: the
index is a self-contained JSON file you can copy between machines.

Warm re-harvests are near-free because:

- Each source is skipped when its `/commits/` SHA is unchanged (1 HTTP
  round-trip total, answered by a conditional 304).
- Blobs are keyed by git SHA and reused across sources.

## First harvest (validated walkthrough)

```bash
# 1. Harvest the Amadeus hub.
primitive-index hub-harvest --hub-repo Amadeus-xDLC/genai.prompt-registry-config

# Expected output (numbers vary with hub content):
#   [hub-harvest] parsed 19 sources from hub-config.yml
#   harvested 210 primitives from 19 bundles (7.2s cold)
#   index written to ~/.cache/prompt-registry/primitive-index.json
```

That single command:

1. Downloads + parses the hub's `hub-config.yml`.
2. Harvests every source in parallel (default concurrency: 4).
3. Writes the searchable index to the default path (no flags needed).

### Add the upstream `github/awesome-copilot` plugins

The `awesome-copilot` repo uses the new **plugin layout** (one
`plugin.json` per `plugins/<id>/.github/plugin/` directory). Inject
it without editing `hub-config.yml`:

```bash
primitive-index hub-harvest \
  --hub-repo Amadeus-xDLC/genai.prompt-registry-config \
  --extra-source 'id=upstream-ac,type=awesome-copilot-plugin,url=https://github.com/github/awesome-copilot,branch=main,pluginsPath=plugins'
```

Live result (combined 20 sources): **343 primitives / 74 bundles /
7.3s cold / 1.3s warm / 0 errors.**

## Search

```bash
# Plain keyword search (defaults to the default index).
primitive-index search -q "code review"

# Filter by kind + source, JSON output.
primitive-index search -q "kubernetes" -k skill -s offer-agent-skills --json

# Explain top hits (show per-field BM25 contributions).
primitive-index search -q "typescript mcp" --explain --limit 3
```

**Short flags** (same everywhere): `-q`, `-k`, `-s`, `-b`, `-t`, `-l`,
`-o`, `-h`.

### Sample output

```text
$ primitive-index search -q "azure pricing"
total: 15  took: 2ms
1.000  [skill] azure-pricing  (upstream-ac/azure-cloud-development)
      Fetches real-time Azure retail pricing using the Azure Retail Prices API…
0.963  [skill] az-cost-optimize  (upstream-ac/azure-cloud-development)
      Analyze Azure resources used in the app and optimize costs…
0.841  [skill] azure-resource-health-diagnose  (upstream-ac/azure-cloud-development)
      Analyze Azure resource health, diagnose issues from logs and telemetry…
```

## Relevance + speed metrics

The project ships with a 20-query **golden set** under
`lib/fixtures/golden-queries.json`. Gate ranking quality in CI:

```bash
primitive-index eval-pattern
# Cases: 20
# Passed: 20 / 20 (100.0%)
```

And benchmark the search loop:

```bash
primitive-index bench --iterations 100
# Throughput: 19,410 queries/sec
# Global median: 0.038 ms / p95: 0.115 ms
```

These numbers are from a 343-primitive live combined index on a
developer laptop. The QuickPick search in the extension easily fits in
the 16ms frame budget even for very broad queries.

## Shortlist + export

The CLI ships with a shortlist workflow so you can curate a personal or
team-wide "favourite" set of primitives and emit a hub-schema-valid
profile YAML. See `primitive-index shortlist --help`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Missing required --index` (or cache errors) | Ran `search` before harvesting | `primitive-index hub-harvest --hub-repo …` first |
| `No GitHub token available` | No env var + no gh CLI | `export GITHUB_TOKEN=...` or `gh auth login` |
| `total: 343, all score 0.000` | **Fixed in sprint 3.** Was caused by `-q` being dropped by the short-flag parser | Pull latest; short flags now work |
| Harvest fetches everything every run | Missing ETag store | Pass the same `--cache-dir` / default path every time |

## See also

- [`docs/contributor-guide/spec-primitive-index.md`](../contributor-guide/spec-primitive-index.md) — authoritative design spec.
- [`lib/PRIMITIVE_INDEX_DESIGN.md`](../../lib/PRIMITIVE_INDEX_DESIGN.md) — engine-level design.
- [`docs/contributor-guide/primitive-index-reusable-layers.md`](../contributor-guide/primitive-index-reusable-layers.md) — reusable barrels for future CLI subcommands.
- [`docs/reference/commands.md`](../reference/commands.md) — VS Code commands reference.

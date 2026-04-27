# Primitive Index — contributor spec

This doc summarises the Primitive Index feature for contributors. It is the
canonical counterpart of [`lib/PRIMITIVE_INDEX_DESIGN.md`](../../lib/PRIMITIVE_INDEX_DESIGN.md) —
the latter captures the design rationale; this one lists concrete entry
points, test surfaces and the definition of done.

## What the feature does

Builds a searchable index of **agentic primitives** (prompts, instructions,
chat modes, agents, skills, MCP servers) reachable to the user and offers:

- **Deterministic search** with BM25 + facet filtering (no LLM required).
- **Shortlist** workflow to collect primitives across bundles.
- **Profile / collection export** conformant to the existing hub profile
  and collection schemas.

Scope (v1):

- Harvests **installed bundles** (on-disk). Not-yet-installed bundles
  advertised by the active hub are a follow-up because they require
  per-adapter raw-file fetching.
- Embeddings are a **pluggable hook** (`EmbeddingProvider`). No model is
  shipped; consumers wire their own (VS Code LM API, OpenAI, local).

## Module map

| Layer | File | Responsibility |
|-------|------|----------------|
| lib / types | `lib/src/primitive-index/types.ts` | Shared types (Primitive, BundleProvider, SearchQuery, …) |
| lib / tokenizer | `lib/src/primitive-index/tokenizer.ts` | Deterministic tokenisation (Unicode + light stemmer) |
| lib / extractor | `lib/src/primitive-index/extract.ts` | Frontmatter parse + kind detection + MCP synthesis |
| lib / harvester | `lib/src/primitive-index/harvester.ts` | Walks a BundleProvider and yields Primitives |
| lib / BM25 | `lib/src/primitive-index/bm25.ts` | Pure BM25 engine over weighted fields |
| lib / index | `lib/src/primitive-index/index.ts` | `PrimitiveIndex` — public API, facets, shortlists, refresh |
| lib / export | `lib/src/primitive-index/export-profile.ts` | Shortlist → hub profile + collection YAML |
| lib / store | `lib/src/primitive-index/store.ts` | JSON persistence |
| lib / cli | `lib/src/primitive-index/cli.ts` + `lib/bin/primitive-index.js` | Standalone CLI |
| lib / skill | `lib/src/primitive-index/skill/SKILL.md` | Reference skill wrapping the CLI |
| lib / eval | `lib/src/primitive-index/eval.ts` | Golden-set eval (recall@k, MRR, nDCG) |
| extension / service | `src/services/primitive-index-manager.ts` | Bridges installed bundles to the lib |
| extension / commands | `src/commands/primitive-index-commands.ts` | 5 command-palette entries |

## Public API (lib)

```ts
import {
  PrimitiveIndex,
  LocalFolderBundleProvider,
  exportShortlistAsProfile,
  saveIndex, loadIndex,
  runEval, type GoldenCase,
} from '@prompt-registry/collection-scripts';
```

`PrimitiveIndex` lifecycle:

```ts
const idx = await PrimitiveIndex.buildFrom(provider);  // harvest + index
idx.search({ q: 'terraform', kinds: ['prompt'], limit: 10 });
idx.createShortlist('my-list');
idx.addToShortlist(slId, primitiveId);
const profile = exportShortlistAsProfile(idx, shortlist, { profileId: 'x' });
saveIndex(idx, '/path/to/primitive-index.json');
```

## CLI

```bash
npx --package @prompt-registry/collection-scripts primitive-index build \
  --root ./some-hub-cache --out primitive-index.json

npx … primitive-index search --index primitive-index.json \
  --q "terraform module" --kinds prompt --json
```

The CLI `--json` output is stable and is the contract used by the
`primitive-finder` skill.

## Extension integration

- Command palette:
  - `Primitive Index: Build from installed bundles`
  - `Primitive Index: Search`
  - `Primitive Index: New shortlist`
  - `Primitive Index: Add primitive to shortlist`
  - `Primitive Index: Export shortlist as profile`
- Persistence: `<globalStorage>/primitive-index.json`.
- The manager emits `onIndexChanged` snapshots after each build/refresh.

## Evaluation & ranking

- Golden set: 21 queries across 7 fixture bundles
  (`lib/test/primitive-index/eval.test.ts` + `fixtures.ts`).
- Thresholds (gating):
  - `recall@10 ≥ 0.80`
  - `MRR ≥ 0.55`
- Current results: `recall@10 = 1.0`, `MRR = 1.0`, `nDCG@10 = 1.0`.
- Tune via `lib/src/primitive-index/tuning.ts`; re-run the eval; never
  commit weight changes that regress any query.

Run the eval verbose:

```bash
cd lib
PRIMITIVE_INDEX_EVAL_REPORT=1 npm test
```

## Tests

| Layer | File | Count |
|-------|------|-------|
| lib unit | `lib/test/primitive-index/*.test.ts` | 38 |
| extension unit | `test/services/primitive-index-manager.test.ts` | 5 |

All gated by existing `npm test` (lib) and `npm run test:unit` (root).

## Definition of done (achieved)

- [x] Design doc committed (`lib/PRIMITIVE_INDEX_DESIGN.md`).
- [x] Deterministic search implemented with BM25 + facets.
- [x] Pluggable embedding hook (`EmbeddingProvider` interface only).
- [x] JSON persistence with `schemaVersion`.
- [x] Shortlist CRUD + refresh/diff.
- [x] Profile + collection export (schema-compatible).
- [x] CLI with `--json` contract.
- [x] Reference `primitive-finder` SKILL.md.
- [x] Eval harness + thresholds enforced; 21 golden cases passing.
- [x] Extension wiring + 5 palette commands.
- [x] 0 new runtime dependencies beyond `js-yaml` (already present).
- [x] Lib + extension lint/compile clean.

## Hub harvester (added after the v1 baseline)

End-to-end pipeline that ingests every source configured in a
`hub-config.yml` directly from GitHub. Same BM25 engine, same persisted
index shape — the harvester only adds the "where do the bytes come
from" layer.

Pieces:

| File | Purpose |
|------|---------|
| `lib/src/primitive-index/hub/token-provider.ts` | Explicit > GITHUB_TOKEN > GH_TOKEN > `gh auth token`; `redactToken` for log safety |
| `lib/src/primitive-index/hub/github-api-client.ts` | Auth + User-Agent + retries (5xx + 429), primary & secondary rate-limit handling, ETag/If-None-Match, live `lastRateLimit` |
| `lib/src/primitive-index/hub/hub-config.ts` | Parses hub-config.yml into normalized `HubSourceSpec[]` |
| `lib/src/primitive-index/hub/progress-log.ts` | Append-only JSONL log of start/done/error/skip; crash-safe resume |
| `lib/src/primitive-index/hub/blob-cache.ts` | Content-addressed cache keyed by git blob SHA; tamper guard (put() verifies sha) |
| `lib/src/primitive-index/hub/blob-fetcher.ts` | Glue between the API client and the cache |
| `lib/src/primitive-index/hub/etag-store.ts` | Persistent `{etag, value}` per URL so warm runs replay 304s |
| `lib/src/primitive-index/hub/tree-enumerator.ts` | One `/git/trees?recursive=1` per source; conservative primitive-candidate filter; max-file-size guard |
| `lib/src/primitive-index/hub/github-bundle-provider.ts` | Wraps the above as a `BundleProvider` for PrimitiveIndex |
| `lib/src/primitive-index/hub/integrity.ts` | Optional HMAC-SHA256 envelope for tamper detection on the saved index |
| `lib/src/primitive-index/hub/hub-harvester.ts` | Orchestrator: bounded concurrency, smart rebuild via commit sha, snapshot-reuse on skip |

Entry points:

- CLI: `primitive-index hub-harvest --hub-repo owner/repo [...]` and
  `primitive-index hub-report --progress FILE [...]`.
- Extension: `promptregistry.primitiveIndex.harvestHub` command;
  `PrimitiveIndexManager.buildFromHub({ hubOwner, hubRepo, ... })`.

### Real-hub benchmarks

Against `Amadeus-xDLC/genai.prompt-registry-config` (19 enabled sources,
210 primitives, private/internal GitHub org):

| Iter | Optimisation | Cold | Warm |
|------|-------------|------|------|
| 12 | serial baseline | 86.2s | 17.6s |
| 13 | concurrency=8 | 16.1s | 2.7s |
| 14 | + ETag 304 on `/commits/` | 17.3s | 1.6s |
| 15 | + awesome-copilot sources | 20.9s (19 sources, 210 primitives) | 1.7s |
| 29 | + parallel intra-bundle fetches | **7.2s** (12× vs baseline) | **1.7s** (10×) |

### Concurrency sweep (iter 47)

After the iter 29 optimisations, concurrency settings produce the following
cold-run wall-clock times on the same 19-source hub (210 primitives each):

| concurrency | cold ms | speedup vs c=1 |
|-------------|--------:|---------------:|
| 1 | 45 443 | 1.0× |
| 2 | 21 661 | 2.1× |
| 4 | 10 934 | 4.2× |
| 8 |  8 104 | 5.6× |
| 16 |  6 973 | 6.5× |

Diminishing returns kick in above 8: the bottleneck shifts from HTTP
round-trips to per-bundle tree parsing. Default concurrency = 4 (iter 12)
keeps us well-behaved w.r.t. GitHub's secondary rate limits while
delivering ~4× of the maximum attainable speedup.

Quality guard: golden-set `recall@10 = 1.0 / MRR = 1.0` still holds
(21 queries, 24 fixture primitives).

### Plugin source type (awesome-copilot-plugin, PR #245, sprint 2)

A second source type handles the new awesome-copilot plugin layout
(one `plugin.json` per `plugins/<id>/.github/plugin/` directory).
Design differences from the standard github source:

- **1 repo → N bundles** (one per plugin). `bundleId = plugin folder name`.
- Shared `commitSha` across all plugins in a repo means source-level
  smart-rebuild fully short-circuits unchanged repos on warm runs.
- Candidate filter is manifest-driven (not the generic extension
  regex): item paths resolve to `SKILL.md` / `AGENT.md` for folder
  kinds, or directly to the named `*.prompt.md` / etc. for file kinds.
- Supports both manifest shapes: explicit `items[]` (our format) and
  upstream `agents[] + skills[]` arrays.
- Dedicated `AwesomeCopilotPluginBundleProvider` + `plugin-tree-enumerator`
  + pure `plugin-manifest` parser (86 lines of tests alone).

### Live combined bench (Amadeus hub + upstream awesome-copilot plugins)

Run against `Amadeus-xDLC/genai.prompt-registry-config` (19 sources, 210
primitives) **plus** `github/awesome-copilot@main` via `--extra-source`
(1 source, 55 plugins, 133 skill primitives):

| Configuration | Cold | Warm | Primitives | Bundles |
|---------------|-----:|-----:|-----------:|--------:|
| Combined harvest (iter 22 baseline) | 44.3s | 1.7s | 343 | 74 |
| + parallel plugins + manifests (iter 28-29) | **7.3s** | **1.3s** | **343** | **74** |

Plugin source alone (55 plugins, 133 skills) compared across
optimisations:

| Config | Cold |
|--------|-----:|
| iter 20 (serial plugins + serial manifests) | 44.8s |
| iter 28 (parallel plugins, serial manifests) | 28.4s |
| iter 29 (parallel plugins + parallel manifests) | **7.1s** |

Warm-run API budget: ~92 conditional requests (all 304) — zero blob
fetches. Search quality: queries like "azure cloud" surface top hits
from `upstream-ac`; "code review" stays rooted in the Amadeus hub.

### Live smoke-test recipes

```bash
# One source, warm path: <2s, 0 errors.
node lib/bin/primitive-index.js hub-harvest \
  --hub-repo Amadeus-xDLC/genai.prompt-registry-config \
  --cache-dir .primitive-index/cache \
  --sources-include dsre-git-skillset

# Dry run: resolve shas + skip all sources, leave the blob cache empty.
node lib/bin/primitive-index.js hub-harvest \
  --hub-repo Amadeus-xDLC/genai.prompt-registry-config \
  --cache-dir .primitive-index/cache --dry-run --json | jq '.totals'

# Signed sidecar: creates primitive-index.sig.json with an HMAC-SHA256.
PRIMITIVE_INDEX_SIGN_KEY=my-secret PRIMITIVE_INDEX_SIGN_KEY_ID=team \
  node lib/bin/primitive-index.js hub-harvest \
    --hub-repo owner/repo --cache-dir .primitive-index/cache
```

## Future work (out of v1 scope)

- Per-adapter awesome-copilot sub-bundling (currently treated as one
  bundle per repo).
- Cross-hub federation.
- Embedding provider implementations (VS Code LM API, OpenAI, local).
- Auto-publish profile PRs to the hub repository.

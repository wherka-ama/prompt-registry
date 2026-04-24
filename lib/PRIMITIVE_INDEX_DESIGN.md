# Primitive Index — High-Level Design

Status: DRAFT v0.1 — authored on `feature/primitive-index`

## 1. Problem & Goals

The Prompt Registry extension already lets users browse bundles, install them, and group them into profiles.
But users cannot answer **"what agentic primitive in my reach solves X?"** without installing bundles first.

The **Primitive Index** is an efficient, LLM-optional lookup layer over every agentic primitive reachable through:

1. Locally installed bundles (already on disk).
2. Every bundle exposed by the **currently active hub**, even if not installed.

Goals:

- **Fast lookup** by domain / task / persona / kind / tag — deterministic and LLM-free by default.
- **Agent-friendly** — the same query API is usable by a skill, with stable JSON output and optional `explain` mode.
- **Shortlist workflow** — build a candidate set of primitives and export it as a profile (installable locally or publishable to a hub).
- **Reusable** — core lives in `lib/` (no VS Code dependency) so a CLI can consume it.

Non-goals (v1):

- Replacing the marketplace UI.
- Shipping an embedding model. Embeddings are a pluggable hook.
- Cross-hub federation. Single active hub is the unit of work.

## 2. What is a "Primitive"?

A primitive is the smallest independently addressable agentic unit. Concretely:

| Kind          | Source file(s)                                 | Identifier frontmatter |
|---------------|------------------------------------------------|------------------------|
| `prompt`      | `*.prompt.md`                                   | `title`, `description`, `tags` |
| `instruction` | `*.instructions.md`                             | `title`, `applyTo`, `tags` |
| `chat-mode`   | `*.chatmode.md`                                 | `title`, `description`, `tools` |
| `agent`       | `*.agent.md`                                    | `title`, `description`, `model` |
| `skill`       | `skills/<id>/SKILL.md`                          | `name`, `description` |
| `mcp-server`  | `deployment-manifest.yml` `mcp.items[key]`      | key, `command`, `url` |

Identity: `primitiveId = sha1(sourceId + '|' + bundleId + '|' + relativePath)[0:16]`.

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Consumers                                                       │
│  ┌──────────────┐   ┌──────────┐   ┌──────────────────────────┐  │
│  │ VS Code Ext. │   │   CLI    │   │ primitive-finder skill   │  │
│  └──────┬───────┘   └────┬─────┘   └──────────────┬───────────┘  │
│         │                │                        │              │
│         ▼                ▼                        ▼              │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  PrimitiveIndex (public API)                              │   │
│  │   search / facet / shortlist / exportProfile              │   │
│  └────────────┬─────────────────────────────────┬────────────┘   │
│               │                                 │                │
│        ┌──────▼───────┐                  ┌──────▼──────┐         │
│        │   Indexer    │                  │   Store     │         │
│        │ BM25 + facet │◄─────────────────┤ JSON + lock │         │
│        └──────▲───────┘                  └─────────────┘         │
│               │                                                  │
│        ┌──────┴───────┐                                          │
│        │   Harvester  │                                          │
│        │  (adapter-   │                                          │
│        │   agnostic)  │                                          │
│        └──────▲───────┘                                          │
│               │                                                  │
│        ┌──────┴───────────────────┐                              │
│        │ BundleProvider (pluggable)│  <- extension feeds via     │
│        │  - InstalledBundles        │     existing adapters;     │
│        │  - HubBundles (lazy)       │     CLI feeds from FS/zip.  │
│        └────────────────────────────┘                             │
└──────────────────────────────────────────────────────────────────┘
```

Key separation: **Harvester** and **Indexer** know nothing about VS Code. They consume a narrow `BundleProvider` interface.

## 4. Technology Choices & Feasibility

| Concern          | Choice                                      | Why |
|------------------|---------------------------------------------|-----|
| Lang / runtime   | TypeScript, Node ≥18                        | Matches `lib/` constraints |
| Lexical search   | Hand-rolled BM25 over tokenised fields      | Zero runtime deps, <300 lines, deterministic, inspectable. MiniSearch was considered but adds a dep for <2× benefit at our corpus sizes (≤10k primitives). |
| Tokeniser        | Lowercase, unicode word split, stop-words, porter-like light stemmer | Good recall for English + domain terms; no native deps |
| Facets           | Inverted maps `kind → Set<id>`, `tag → Set<id>`, `sourceId → Set<id>`, `bundleId → Set<id>` | O(1) filter intersection |
| Frontmatter parse| `js-yaml` (already a dep)                   | No new dep |
| Persistence      | JSON file with `schemaVersion`              | Diff-able, portable across platforms |
| Embeddings (opt) | `EmbeddingProvider` interface; cosine on Float32 | Lib ships interface only. Consumers inject provider (OpenAI, VS Code LM API, local). |
| Hybrid ranking   | `score = α·bm25_normalised + (1-α)·cosine`  | α default 0.6; α=1 when no embedding |
| Concurrency      | p-limit-like inline helper, default 5       | Matches existing awesome-copilot-adapter style |

Feasibility notes:

- **Scale**: An active hub typically exposes 10–50 sources × O(50) bundles × O(10) primitives → ≤25k records. BM25 over that in-memory fits in <20 MB and queries are sub-10ms.
- **Network cost for hub harvest**: manifests + frontmatter only. No bundle ZIP download required — we reuse adapter `fetchBundles()` which already returns metadata; when frontmatter isn't in the manifest, we fetch the raw `.md` file via the adapter's URL helpers. Lazy and cached.
- **Freshness**: index is timestamped; consumers decide TTL. Extension reuses existing "sync hub" triggers.

## 5. Core Types (lib)

```ts
export interface BundleRef {
  sourceId: string;
  sourceType: string;
  bundleId: string;
  bundleVersion: string;
  installed: boolean;
}

export interface Primitive {
  id: string;                 // stable sha1
  bundle: BundleRef;
  kind: 'prompt'|'instruction'|'chat-mode'|'agent'|'skill'|'mcp-server';
  path: string;               // relative to bundle root
  title: string;
  description: string;
  tags: string[];
  authors?: string[];
  applyTo?: string;           // instruction scope glob
  tools?: string[];           // chat-mode / agent tools
  model?: string;
  bodyPreview: string;        // first ~400 chars, normalised
  contentHash: string;        // sha1 of full body
  rating?: number;            // 0..5 if available
  updatedAt?: string;
}

export interface IndexRecord extends Primitive {
  // Tokenised fields
  _terms: { title: string[]; desc: string[]; body: string[]; tags: string[] };
  embedding?: Float32Array;
}

export interface SearchQuery {
  q?: string;
  kinds?: Primitive['kind'][];
  sources?: string[];
  bundles?: string[];
  tags?: string[];              // AND across tags
  installedOnly?: boolean;
  limit?: number;               // default 20
  offset?: number;              // default 0
  explain?: boolean;
  ranking?: 'bm25'|'hybrid';    // hybrid requires embedding provider + query vector
}

export interface SearchHit {
  primitive: Primitive;
  score: number;
  matches?: { field: string; term: string; weight: number }[]; // if explain
}

export interface SearchResult {
  total: number;
  hits: SearchHit[];
  facets: {
    kinds: Record<string, number>;
    sources: Record<string, number>;
    tags: Record<string, number>;
  };
  tookMs: number;
}
```

## 6. Public API (lib)

```ts
export class PrimitiveIndex {
  static load(path: string): Promise<PrimitiveIndex>;
  static buildFrom(provider: BundleProvider, opts?: BuildOptions): Promise<PrimitiveIndex>;

  save(path: string): Promise<void>;
  refresh(provider: BundleProvider, opts?: RefreshOptions): Promise<RefreshReport>;

  search(q: SearchQuery): SearchResult;
  get(primitiveId: string): Primitive | undefined;

  // Shortlists
  createShortlist(name: string, description?: string): Shortlist;
  listShortlists(): Shortlist[];
  addToShortlist(shortlistId: string, primitiveId: string): void;
  removeFromShortlist(shortlistId: string, primitiveId: string): void;

  // Export
  exportAsProfile(shortlistId: string, opts: ExportProfileOptions): ProfileExport;

  // Stats
  stats(): IndexStats;
}
```

`BundleProvider` (adapter-agnostic):

```ts
export interface BundleProvider {
  listBundles(): AsyncIterable<BundleRef>;
  readManifest(ref: BundleRef): Promise<BundleManifest>;
  readFile(ref: BundleRef, relPath: string): Promise<string>;   // utf8
}
```

`EmbeddingProvider` (optional):

```ts
export interface EmbeddingProvider {
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

## 7. Search Semantics

Deterministic path (no LLM):

1. Filter by facets (intersect inverted sets).
2. If `q` present, score remaining set with BM25 over weighted fields:
   `title ×3, tags ×2, description ×1.5, bodyPreview ×1`.
3. Sort by score desc, tie-break on `(rating desc, bundleId asc, path asc)` for stability.
4. Apply `limit`/`offset`; compute facet counts on the *filtered* (pre-query) set.

Hybrid path: same as above, but final score is `α·bm25norm + (1-α)·cosine(queryEmbed, record.embedding)` and records without embedding fall back to `bm25norm` only.

`explain: true` attaches `matches[]` with field/term/weight contributions.

## 8. Shortlist → Profile Export

- Shortlist is a named list of `primitiveId`s (persisted alongside the index).
- Export groups primitives by their owning bundle and produces:
  - A **profile** document (`hub-config` profile schema) referencing bundles with versions pinned to what was indexed.
  - A **collection** document (`collection.schema.json`) when the shortlist crosses bundle boundaries and needs a new curated unit. The collection lists primitives by their bundle-local paths; publishing it requires a target repo (out of scope for v1 — we emit the YAML for the author).
- Output type:

```ts
interface ProfileExport {
  profile: HubProfile;               // conformant to hub-config.schema.json
  suggestedCollection?: Collection;  // conformant to collection.schema.json
  warnings: string[];                // e.g., "primitive X missing bundle version"
}
```

## 9. Persistence Format

File: `primitive-index.json` (single file, pretty JSON). Layout:

```jsonc
{
  "schemaVersion": 1,
  "builtAt": "2026-04-22T…",
  "hubId": "…",
  "primitives": [ /* IndexRecord minus _terms (recomputed on load) */ ],
  "shortlists": [ { "id", "name", "description", "primitiveIds": [] } ],
  "embeddingsMeta": null | { "provider": "…", "dim": 384 }
}
```

`_terms` is rebuilt deterministically on load so the file stays small and greppable.

## 10. Agentic Skill Sketch (`primitive-finder`)

`lib/skills/primitive-finder/SKILL.md` (shipped with lib as a reference skill):

```
---
name: primitive-finder
description: Find Copilot agentic primitives (prompts, instructions, chat modes, agents, skills) that match a user's task, domain or persona by querying a locally cached Primitive Index.
---

Use this skill when the user asks "is there a prompt/agent/skill for X?"
or wants to assemble a profile for a task.

Call `primitive-index search --json '{ "q": "...", "kinds": [...], "limit": 10 }'`
and summarise the top hits. Explain filters used. If the user wants to save
them, call `primitive-index shortlist add ...` then `primitive-index export-profile ...`.
```

The skill calls the CLI (Phase 2) or a local HTTP shim. The lib itself ships the JSON
contract so LLMs can reason about output shape.

## 11. Evaluation Harness

- Golden set: `lib/test/fixtures/primitive-index/golden.json` — array of `{query, relevantPrimitiveIds[]}`.
- Metrics: `recall@{5,10,20}`, `MRR`, `nDCG@10`.
- Harness: `lib/test/primitive-index.eval.test.ts` runs the golden set against a fixture-built index. Thresholds:
  - `recall@10 ≥ 0.80`
  - `MRR ≥ 0.55`
- A checkpoint (weights, tokeniser settings) is tuned by re-running the harness; we commit weights in `src/primitive-index/tuning.ts` only when they improve metrics without regressing recall on any query.

## 12. Milestones & Definition of Done

- **M1** — Types + Harvester + Extractor; fixture tests pass. ✅ committable.
- **M2** — Indexer (BM25 + facets) + search API; eval harness runs, meets thresholds. ✅ committable.
- **M3** — Persistence + refresh/diff + shortlist CRUD. ✅ committable.
- **M4** — Profile export + collection suggestion; schema-validated output. ✅ committable.
- **M5** — Reference skill + CLI binary (`primitive-index`). ✅ committable.
- **M6** — Extension integration: `PrimitiveIndexManager` bridging adapters → `BundleProvider`; surfaces `search` + shortlist command palette entries. ✅ committable.

Global DoD:

- `npm run lint && npm test` green in `lib/` and root.
- Eval thresholds held or improved.
- No new runtime deps beyond `js-yaml` (already present).
- Public API documented in [PRIMITIVE_INDEX_DESIGN.md](./PRIMITIVE_INDEX_DESIGN.md) + `docs/contributor-guide/spec-primitive-index.md`.
- AGENTS.md guidance updated where relevant.

## 12b. Hub harvester (post-M6 addendum)

A second milestone added a full GitHub-API harvester that feeds the
same `PrimitiveIndex` engine directly from a hub-config.yml, without
requiring local installation. The harvester lives entirely under
`src/primitive-index/hub/` and is exposed via:

- CLI: `primitive-index hub-harvest`, `primitive-index hub-report`.
- Programmatic: see the re-exports in `src/index.ts`.
- Extension: `PrimitiveIndexManager.buildFromHub()` and the
  `promptregistry.primitiveIndex.harvestHub` command.

Engineering principles baked in:

1. **Resumability** — append-only JSONL progress log; any failure mode
   resumes from the last successful bundle.
2. **Smart rebuild** — `/commits/:ref` with `If-None-Match`; 304 replay
   means warm runs do zero tree/blob work.
3. **Integrity** — content-addressed blob cache keyed by git blob SHA
   with put-side tamper check; optional HMAC-SHA256 envelope on the
   saved index (`PRIMITIVE_INDEX_SIGN_KEY`).
4. **Concurrency** — bounded at the source level (default 4) plus an
   unbounded inner parallel fetch per bundle, behind `Promise.allSettled`
   so one bad file doesn't take a whole bundle down.
5. **Observability** — live `lastRateLimit` snapshot + per-source
   `onEvent` hook. The CLI reports both and `hub-report` renders a
   markdown table from the progress log.

Real-hub bench (`Amadeus-xDLC/genai.prompt-registry-config`, 19 enabled
sources, 210 primitives, 0 errors):

| Configuration | Cold | Warm |
|---------------|------|------|
| Serial baseline | 86.2s | 17.6s |
| + concurrency=8 | 16.1s | 2.7s |
| + ETag 304 on `/commits/` | 17.3s | 1.6s |
| + parallel intra-bundle fetches | **7.8s** | **1.7s** |

API budget: ~232 requests per cold harvest of 19 sources — well below
the 5000/hour limit. Warm harvests consume ~20 requests (conditional
`/commits/` per source).

## 12c. Plugin source type (post-merge addendum, PR #245)

Second dispatch path for the harvester: `awesome-copilot-plugin` sources
implement the plugin layout added in
[AmadeusITGroup/prompt-registry#245](https://github.com/AmadeusITGroup/prompt-registry/pull/245).

Key differences vs the standard github source:

1. **1 repo → N bundles** (one per plugin directory). `bundleId` =
   plugin folder name; `bundleVersion` = repo commit sha (shared). This
   keeps source-level smart-rebuild working: unchanged sha short-circuits
   the whole enumeration via a single conditional `/commits/` 304.
2. **Manifest-driven candidate filter.** Each plugin's `plugin.json`
   declares its items explicitly (either `items[]` or upstream-style
   `agents[] + skills[]`). Non-manifest files are ignored unless
   referenced — this is tighter than the generic repo-walking filter.
3. **Dual manifest shape.** `derivePluginItems()` prefers our `items[]`
   if present, otherwise folds `agents[]`/`skills[]` into items.
4. **Entry path resolution:** `skill`/`agent` paths point to
   directories; the resolver appends `SKILL.md` / `AGENT.md`.
   Single-file kinds (`prompt`, `instruction`, `chat-mode`) use the
   manifest path verbatim.
5. **MCP integration:** `plugin.json` may declare MCP servers under
   `mcp.items` or top-level `mcpServers`; both are merged and surfaced
   to the existing `extractMcpPrimitives()` pipeline.
6. **External plugins skipped:** `manifest.external === true` plugins
   are skipped (they reference another repo via `manifest.source`; we
   don't follow transitively).

Modules:

| File | Purpose |
|------|---------|
| `hub/plugin-manifest.ts` | Pure parser + item derivation + MCP extraction + path resolution |
| `hub/plugin-tree-enumerator.ts` | Parallel manifest discovery + candidate expansion per plugin |
| `hub/plugin-bundle-provider.ts` | BundleProvider over the above; yields one bundle per plugin |
| `hub/extra-source.ts` | CLI `--extra-source` parser (inject sources without mutating hub-config) |

Real-hub bench (`github/awesome-copilot`, 55 plugins, 133 skills):

| Optimisation | Cold | Notes |
|---|---:|---|
| iter 20 serial | 44.8s | Sequential plugins + sequential manifest fetches |
| iter 28 parallel plugins | 28.4s | 55 plugins in batches of --concurrency |
| iter 29 + parallel manifests | **7.1s** | 55 manifests in one Promise.all |

Combined with the Amadeus hub (19 sources + 1 plugin source, 343
primitives, 74 bundles): **7.3s cold / 1.3s warm / 0 errors**.

## 13. Risks & Open Questions

- **Frontmatter variability**: authors omit `description`/`tags`. Mitigation: fallback to file path heuristics + first heading; flag low-quality records in eval.
- **Awesome-Copilot manifests**: bundles are dynamically assembled; harvesting requires reading raw `.md` files per source. We reuse existing adapter URL helpers; cache per `(sourceId, bundleId, contentHash)`.
- **MCP primitives** carry no natural body text; we synthesise `bodyPreview = "MCP server: <command> <args>"` to keep BM25 meaningful.
- **Profile export naming collisions** when two shortlisted primitives come from bundles with the same id on different sources — export disambiguates by `sourceId`.
- **Embedding staleness** when content hash changes — `refresh()` invalidates embeddings on hash drift.

## 14. Out of Scope (v1)

- Cross-hub search.
- Semantic clustering / auto-domains.
- Write-back to remote hubs (PR automation).
- Rating-weighted ranking beyond a simple tie-break.

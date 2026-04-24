# Primitive Index — hub harvester iteration log

Condensed changelog of the 50-iteration sprint that took the primitive
index from "installed bundles only" to a full GitHub-hub harvester.
Each row summarises a committed iteration; see `git log
feature/primitive-index` for the underlying commit messages.

## Foundation (iter 1–10)

| # | Theme | Outcome |
|---|-------|---------|
| 1 | Token resolver | explicit > GITHUB_TOKEN > GH_TOKEN > `gh auth token`; `redactToken` |
| 2 | `GitHubApiClient` | retries, rate-limit, ETag, User-Agent, `lastRateLimit` |
| 3 | `hub-config.yml` parser | `HubSourceSpec[]` with forward-compat `rawConfig` |
| 4 | Progress log | append-only JSONL + `shouldResume(sourceId, bundleId, sha)` |
| 5 | Blob cache | content-addressed by git blob SHA, tamper guard, atomic writes |
| 6 | Tree enumerator | one `/git/trees?recursive=1`; conservative candidate filter |
| 7 | `BlobFetcher` | API client + cache glue; base64 decode |
| 8 | `GitHubSingleBundleProvider` | BundleProvider interface over the above |
| 9 | `HubHarvester` | orchestrator, bounded concurrency, smart rebuild, snapshot reuse |
| 10 | CLI `hub-harvest` | first end-to-end run against the real hub |

## Performance (iter 11–15)

| # | Change | Benchmark (cold / warm) |
|---|-------|------------------------:|
| 11 | Carry snapshot through warm runs | 5.9s / 2.0s (2 sources) |
| 12 | Default concurrency 1→4 | — |
| 13 | Persistent ETag store | — |
| 14 | Conditional `/commits/` via ETag | 17.3s / **1.6s** |
| 15 | Harvest awesome-copilot sources | 20.9s / 1.7s (all 19 sources, 210 primitives) |

## Hardening (iter 16–25)

| # | Change |
|---|-------|
| 16 | HMAC-SHA256 integrity envelope (`verifyIndexIntegrity`) |
| 17 | Opt-in signed sidecar via `PRIMITIVE_INDEX_SIGN_KEY` |
| 18 | `--force` + `--dry-run` CLI flags |
| 19 | Rate-limit budget observability (`lastRateLimit` in JSON summary) |
| 20 | `hub-report` CLI subcommand (markdown + JSON) |
| 21 | SIGINT/SIGTERM graceful shutdown (flush etag store) |
| 22 | `maxFileSize` guard (default 256 KiB) |
| 23 | Export hub harvester module from `@prompt-registry/collection-scripts` |
| 24 | Tighter candidate filter (skip `.github/`, `dist/`, `build/`) |
| 25+26 | `hub-report --cache-dir` surfaces blob-cache size |

## Further perf + extension (iter 27–38)

| # | Change | Benchmark (cold / warm) |
|---|-------|------------------------:|
| 27–29 | Parallel intra-bundle blob fetches | **7.2s** / 1.7s (12× / 10× vs serial baseline) |
| 30 | CLI usage help covers hub-* + env vars | — |
| 31–32 | Extension `PrimitiveIndexManager.buildFromHub` + `harvestHub` command | — |
| 33–35 | `docs/reference/commands.md` + contributor spec updates | — |
| 36–38 | `lib/README.md` section + lint cleanup | 239 tests green |

## Polish + measurement (iter 39–50)

| # | Change |
|---|-------|
| 39–42 | `PRIMITIVE_INDEX_DESIGN.md` post-M6 addendum with benchmarks |
| 43 | `--dry-run` validated live (3.0s, no blobs written) |
| 44 | Signed sidecar validated live (`HMAC-SHA256` with custom `keyId`) |
| 45 | Smoke-test recipes checked in |
| 46 | Live full-hub re-bench: cold 7.8s / 232 API reqs, warm 1.7s |
| 47 | Concurrency sweep (c=1→16) recorded in spec |
| 48 | Final lint/tsc/test sanity checkpoint |
| 49 | This iteration log |
| 50 | Final summary commit |

## Sprint 2: plugin source type (iter 1–50, follow-up sprint)

Adds the `awesome-copilot-plugin` source type anticipated by
[PR #245](https://github.com/AmadeusITGroup/prompt-registry/pull/245)
without waiting for that PR to merge. Rebased on `upstream/main` first.

### Foundation (sprint-2 iter 1–10)

| # | Change |
|---|---|
| 1 | Rebase `feature/primitive-index` on `upstream/main` (ff, 2 commits) |
| 2 | PR #245 analysis: plugin layout, dual manifest shape, MCP integration |
| 3–4 | Pure `parsePluginManifest` + `derivePluginItems` + `resolvePluginItemEntryPath` (TDD) |
| 5–6 | `extractPluginMcpServers` merges `mcp.items` + `mcpServers` |
| 7–8 | Extend `HubSourceSpec` with `awesome-copilot-plugin` + `pluginsPath` |
| 9–10 | `plugin-tree-enumerator.enumeratePluginRepo()` (one repo → many plugins) |

### Provider + harvester routing (sprint-2 iter 11–25)

| # | Change |
|---|---|
| 11–12 | `AwesomeCopilotPluginBundleProvider` (1 repo → N BundleRefs) |
| 13–15 | `HubHarvester.processSource()` dispatches on `spec.type`; new end-to-end test |
| 16–18 | CLI `--extra-source` flag + `parseExtraSource` helper |
| 19–20 | CLI `--no-hub-config` / `--hub-config-file`; first live run against `github/awesome-copilot` |
| 21 | Fix `totals.primitives` double-count (source-level done records `primitives=0`) |
| 22–23 | Live combined bench + contributor-guide section |
| 24 | Extension `buildFromHub` accepts `extraSources`; QuickPick toggle for upstream-ac |
| 25 | Plugin MCP servers surfaced via `manifest.mcp.items` in `readManifest()` |

### Hardening + perf (sprint-2 iter 26–50)

| # | Change | Effect |
|---|---|---|
| 26–27 | Skip `external: true` plugins | Correctness |
| 28 | Parallel plugin harvesting | 44.8s → 28.4s cold |
| 29 | Parallel manifest fetches | 28.4s → **7.1s cold** (6.3× vs iter 20 baseline) |
| 30 | Bench doc update | — |
| 31–34 | hub-report validation, lib/README, public API exports | — |
| 35–38 | Commands doc, empty-items edge case | — |
| 39–42 | Design doc addendum `12c. Plugin source type` + this log | — |
| 43–50 | Final lint/tsc/test sanity, real-hub bench, iteration log |

## Sprint 3: search fix + UX polish + reusable layers + evals (iter 1–50)

Follow-up sprint triggered by the user's session report that
"search results lack relevance (all scores 0.000)". Scope expanded
to cover default paths, reusable CLI layers, realistic evals, and
end-user docs.

### Findings (sprint-3 iter 1–3)

| # | Change |
|---|---|
| 1 | Capture full session context in a persistent memory for UI-integration work |
| 2 | Diagnose: CLI parser silently dropped single-dash short flags. `-q review` → `flags.q = undefined` → BM25 fell through to "empty query" path → all 343 docs returned with score 0 |
| 3 | Fix + TDD regression: SHORT_FLAG_ALIASES map in `cli.ts parseArgs()`. Two tests: "-q identical to --q" + "non-matching query returns zero hits" |

### UX (sprint-3 iter 4–8)

| # | Change |
|---|---|
| 4 | New `default-paths.ts` pure helper (PROMPT_REGISTRY_CACHE → XDG_CACHE_HOME → ~/.cache/prompt-registry) |
| 5 | Wire defaults into `search`, `stats`, `shortlist`, `export` (no `--index` required) |
| 6 | Wire defaults into `hub-harvest` (per-hub cache dir derived from `--hub-repo`) and `hub-report` |
| 7 | Usage help: new "Default paths" + "Short flags" sections |
| 8 | 8 unit tests + 1 end-to-end CLI test ("search defaults --index to $PROMPT_REGISTRY_CACHE/primitive-index.json") |

### Refactor: reusable barrels (sprint-3 iter 9–15)

| # | Change |
|---|---|
| 9 | `lib/src/hub/index.ts` — barrel for generic hub modules (transport, blob cache, etag, providers, harvester, progress log, integrity, plugin parsers) |
| 10 | `lib/src/core/index.ts` — barrel for generic core types (Primitive, BundleRef, BundleManifest, BundleProvider) |
| 11 | `lib/src/registry/index.ts` — umbrella re-export: core + hub + paths |
| 12 | Top-level package index re-exports `registry`, `hub`, `core` namespaces |
| 13 | 4 new tests in `test/registry/registry-barrel.test.ts` pin the contract (object identity preserved across paths) |
| 14 | `docs/contributor-guide/primitive-index-reusable-layers.md` with Mermaid namespace map + class diagram + sketch examples for `list` / `install` subcommands |
| 15 | Full sanity checkpoint |

### Evals + benchmarks (sprint-3 iter 16–26)

| # | Change |
|---|---|
| 16–18 | Pattern-based relevance eval (`eval-pattern.ts`) with regex over title/bundleId/sourceId/kind — resilient to content drift |
| 19 | `lib/fixtures/golden-queries.json` — 20 realistic live queries curated from the combined 343-primitive index |
| 20 | New `eval-pattern` CLI subcommand (non-zero exit on fail → CI-ready). Live result: **20/20 pass** |
| 21–23 | `bench.ts` microbenchmark harness. CLI `bench` subcommand. Live result: **19,410 QPS**, p50 **0.038 ms**, p95 **0.115 ms** on 343 primitives |
| 24–26 | Public-API exports (runPatternEval, runBench, rendering helpers); usage help updated |

### End-user + developer docs (sprint-3 iter 27–33)

| # | Change |
|---|---|
| 27 | `docs/user-guide/primitive-index.md` — full end-user guide: install, auth, default paths, Mermaid lifecycle, walkthrough, search examples, relevance+bench numbers, troubleshooting |
| 28 | `docs/README.md` navigation: 3 new links (user guide, architecture, reusable layers) |
| 29–31 | `docs/contributor-guide/primitive-index-architecture.md` — engine-room view with 5 Mermaid diagrams (sequence, layer map, class diagram, ranking flowchart, warm-path cost) + extension-points matrix + testing strategy |
| 32 | Link architecture doc from nav |
| 33 | Commit + live validation of every example (default-path search / eval-pattern / bench) |

### Sprint-3 final scorecard

| Metric | Pre-sprint-3 | Post-sprint-3 | Delta |
|---|---:|---:|---:|
| `search -q review` relevance | all 0.000 | correct BM25 | **fixed** |
| CLI flags needed for search | `--index` required | **zero** (XDG defaults) | UX ↑ |
| Realistic eval gold set | 0 live cases | **20** | +20 cases |
| Golden-set pass rate | — | **20/20 (100%)** | — |
| Search QPS on 343 primitives | unknown | **19,410** (median 0.038ms) | measured |
| Reusable-CLI-ready barrels | none | `core` / `hub` / `registry` | +3 namespaces |
| lib tests | 264 | **285** | +21 tests |
| lib lint errors | 0 | 0 | — |

## Sprint-2 final scorecard

| Metric | iter 20 baseline | After iter 29 | Speedup |
|--------|---------------:|--------------:|--------:|
| Combined cold (20 sources, 343 primitives) | 44.3s | **7.3s** | **6.1×** |
| Combined warm | 1.7s | **1.3s** | 1.3× |
| Plugin source only, cold | 44.8s | **7.1s** | 6.3× |
| Plugin source only, warm | 1.7s | 1.7s | 1× (already optimal) |
| Test count | 253 | 263 | +10 tests |
| Errors | 0 | 0 | — |

## Final scorecard

| Metric | Serial baseline (iter 12) | After iter 29 | Speedup |
|--------|--------------------------:|--------------:|--------:|
| Cold (19 sources) | 86.2s | 7.2s | **12×** |
| Warm (19 sources) | 17.6s | 1.7s | **10×** |
| API reqs per cold | ~245 | ~232 | — |
| API reqs per warm | 19 | ~19 (all 304) | — |
| Errors | 0 | 0 | — |
| Primitives harvested | — | **210** | — |

All 239 lib tests + 5 extension services tests green; lib lint clean;
extension tsc --noEmit clean. Zero new runtime dependencies beyond what
was already in the project.

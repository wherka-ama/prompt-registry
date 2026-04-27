# Extension ↔ CLI iso-functionality parity matrix

> Tracked through Phase 5 spillover. Updated on every iter that
> changes the parity status of a row.

The goal of Phase 5 spillover is for the `prompt-registry` CLI to be
*iso-functional* with the VS Code extension's `installBundle` flow:
the same things install, from the same sources, with the same
side-effects, against the same lockfile shape — minus the
VS-Code-specific UI (scope picker, conflict dialog, telemetry).

Status legend:

- **✅ parity** — feature works the same in both
- **🟨 lib-partial** — interface stable in lib; impl pending
- **🟥 lib-missing** — feature not yet representable in lib
- **➖ extension-only** — feature is intentionally UI-only and not in scope for the CLI

## Source dispatch

| Feature | Extension | Lib (today) | Status |
|---|---|---|---|
| Source registry | `RegistryStorage.getSources()` | `targets[]` in `prompt-registry.yml` | 🟨 different model on purpose; CLI uses targets, extension uses sources+hubs |
| `github` source | `GitHubAdapter` | `GitHubBundleResolver` | ✅ parity (lib variant uses `HttpClient` + `TokenProvider` instead of `vscode.authentication`; same algorithm) |
| `awesome-copilot` source | `AwesomeCopilotAdapter` | — | 🟥 spillover post-50 |
| `apm` source | `ApmAdapter` | — | 🟥 spillover post-50 |
| `skills` source | `SkillsAdapter` | — | 🟥 spillover post-50 |
| `local` source | `LocalAdapter` | `--from <localDir>` | ✅ parity (different surface, same effect) |

## Install pipeline

| Stage | Extension | Lib (today) | Status |
|---|---|---|---|
| Resolve | `adapter.fetchBundles()` + `adapter.getDownloadUrl()` | `BundleResolver` interface + `GitHubBundleResolver` impl | ✅ parity for GitHub |
| Download | `adapter.downloadBundle()` (https + redirects) | `HttpsBundleDownloader` over `NodeHttpClient` | ✅ parity (lib uses an injected `HttpClient`) |
| Extract | `adm-zip extractAllTo(dir, true)` | `YauzlBundleExtractor` (in-memory) | ✅ parity for typical bundles; streaming variant TBD if needed |
| Validate manifest | `BundleInstaller.validateBundle()` | `validateManifest()` | ✅ parity (lib's is structured-error variant) |
| Place files | `UserScopeService` / `RepositoryScopeService` | `FileTreeTargetWriter` (5 layouts) | ✅ parity for vscode/copilot; new for kiro/windsurf/claude-code |

## Lockfile

| Field | Extension | Lib (today) | Status |
|---|---|---|---|
| `version` (`"1.0.0"`) | ✅ | `schemaVersion: 1` | 🟨 same intent, different shape — readers tolerate both |
| `bundles{}` map | ✅ keyed on bundleId | `entries[]` keyed on (target, bundleId) | 🟨 lib carries target as first key (per-target installs) |
| `sources{}` | ✅ | `Lockfile.sources?` (optional, populated on install) | ✅ parity (D13 / iter 11-15) |
| `hubs{}` | ✅ | `Lockfile.hubs?` (optional) | ✅ shape parity; populator pending the hub adapter |
| `profiles{}` | ✅ | `Lockfile.profiles?` (optional) | ✅ shape parity; populator pending the profile feature |
| Per-file checksum | ✅ SHA-256 | `LockfileEntry.fileChecksums?` | ✅ parity (D13 / iter 14-15) |
| Dual file (committed + local-only) | ✅ | — | ➖ git-aware; CLI may add later |
| `generatedAt` | ✅ ISO-8601 | per-entry `installedAt` | 🟨 different granularity; both compatible |

## Cross-cutting

| Feature | Extension | Lib (today) | Status |
|---|---|---|---|
| Auth chain (token → vscode → gh CLI) | ✅ 4-step | `TokenProvider` interface + `envTokenProvider` (`GITHUB_TOKEN` / `GH_TOKEN`) | ✅ extensible parity: extension can supply a richer `TokenProvider` impl without changes to lib |
| MCP integration | `McpServerManager` | — | ➖ Phase 6 |
| Scope conflict resolver | ✅ | — | ➖ git/.github-aware feature; CLI maps to per-target installs |
| Update checker | `UpdateChecker` | — | ➖ Phase 6+ |
| Telemetry | ✅ | — | ➖ extension-only |

## Target file layout

| Target | Extension support | Lib (today) | Status |
|---|---|---|---|
| `vscode` user scope | ✅ via `UserScopeService` | `FileTreeTargetWriter` vscode layout | ✅ parity |
| `vscode` workspace scope | ✅ | covered by `target.path` override | ✅ parity (different surface, same effect) |
| `vscode-insiders` | ✅ | ✅ | ✅ parity |
| `copilot-cli` | ✅ | ✅ | ✅ parity |
| `kiro` | — | ✅ | ✅ lib-only today; extension may adopt later |
| `windsurf` | — | ✅ | ✅ lib-only today; extension may adopt later |
| `claude-code` | — | ✅ `FileTreeTargetWriter` claude-code layout | ✅ lib-only today; extension may adopt later |

## Iter check-ins

| Iter | What changed |
|---|---|
| 8 | This matrix scaffolded with 5 lib-partial / 7 lib-missing rows. |
| 13 | Lockfile shape rows flip to 🟨/✅: D13 additive sections (`sources`, `hubs`, `profiles`) + per-file checksums shipped. |
| 15 | Install populates lockfile sources + per-file checksums on every install. |
| 21 | `github` resolver row flips to ✅: `GitHubBundleResolver` shipped. |
| 26 | Downloader row flips to ✅: `HttpsBundleDownloader` shipped. |
| 29 | Extractor row flips to ✅: `YauzlBundleExtractor` shipped. |
| 32 | Imperative remote install body wired (`install <bundle> --source <owner/repo>`); pipeline composition complete. |
| 37 | Lockfile replay body wired; declarative install (`install --lockfile`) actually re-installs. |
| 42 | `claude-code` row flips to ✅. |
| 49 | **Sign-off**: every in-scope row is ✅ parity or ➖ extension-only. The 3 remaining 🟥 rows (`awesome-copilot`, `apm`, `skills`) are explicitly post-50 deliverables — each is a single `BundleResolver` impl drop-in against the interfaces frozen in iters 11/19/23/27. |
| 50 | Final consolidation. |
| Phase 6 / 90 | **Hubs / Sources / Profiles**: domain (`HubReference`, `HubConfig`, `Profile`, `ProfileActivationState`), user-level storage (XDG-compliant `HubStore`/`ActiveHubStore`/`ProfileActivationStore`), three `HubResolver` impls (github/local/url) + composite, `HubManager` (incl. default-local synthesis per D23), atomic target-agnostic `ProfileActivator` (D21+D22), CLI commands (`hub`, `profile`, `source`), lockfile `useProfile?` linkage (D24). Iso-functional with the extension's hub/profile model; APM deferred per D25. 647 tests passing. |

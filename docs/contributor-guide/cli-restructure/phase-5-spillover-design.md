# Phase 5 spillover — design notes

> Authored at iter 6 of 50 (discovery summary). Captures the
> findings from iters 1-5 (codemap survey + extension flow study)
> and the design constraints they impose on the spillover work.

## Goal

Make the `prompt-registry` CLI **iso-functional with the VS Code
extension** for installing bundles from real remote sources, while
keeping the lib package **target-agnostic** (vscode, vscode-insiders,
copilot-cli, kiro, windsurf, claude-code, …) and **importable by the
extension** so duplication can be retired in a later phase.

## Existing extension stack (do not disturb)

| Concern | Extension | Source-of-truth path |
|---|---|---|
| Source dispatch | `RepositoryAdapterFactory` | `src/adapters/repository-adapter.ts` |
| Adapters (`IRepositoryAdapter`) | 6 types: `github`, `local`, `awesome-copilot`, `local-awesome-copilot`, `apm`, `local-apm`, `skills`, `local-skills` | `src/adapters/*-adapter.ts` |
| Auth chain | explicit token → vscode session → `gh` CLI → none | `src/adapters/github-adapter.ts` |
| Download | `https.get` with manual redirects | `GitHubAdapter.downloadFile` |
| Extraction | `adm-zip` `extractAllTo(dir, true)` | `BundleInstaller.extractBundle` |
| Manifest validation | `BundleInstaller.validateBundle` | `src/services/bundle-installer.ts` |
| File placement | `UserScopeService` (Copilot User dir), `RepositoryScopeService` (`.github/`) | `src/services/*-scope-service.ts` |
| Lockfile | `LockfileManager` — dual file (committed / local-only), checksum every file, sources + hubs + profiles | `src/services/lockfile-manager.ts` + `src/types/lockfile.ts` |
| SourceId generation | `generateHubSourceId(type, url, {branch, collectionsPath})` → `{type}-{12hex}` | `src/utils/source-id-utils.ts` |

## Lib's Phase 5 (today)

Lib delivers an install pipeline with **target-agnostic** writers and
five-stage decoupled interfaces (resolver, downloader, extractor,
validator, writer). Local-dir install path works end-to-end. Remote
stack is the **spillover**: adapter-equivalent resolvers, real HTTPS
downloader, real zip extractor, lockfile replay body.

## Key alignment decisions for spillover

### D13 — Lib lockfile schema upgrade *(iter ~15)*

Today `prompt-registry.lock.json` (lib) is a flat list keyed on
(target, bundleId). The extension's lockfile is keyed on bundleId
with `sources{}`, `hubs{}`, `profiles{}` siblings. Spillover **does
not break** the lib's flat shape, but **adds** sibling sections
(`sources`, optional `hubs`, optional `profiles`) so a single file
can satisfy both consumers when that consolidation happens. New
fields are emitted only when populated; readers tolerate missing
sections.

### D14 — Resolver = adapter slice *(iter ~10)*

Lib's `BundleResolver` interface is the *non-VS-Code* slice of
extension's `IRepositoryAdapter.fetchBundles + getDownloadUrl`. To
keep the extension importable later, every resolver impl in lib
will:

1. Consume only Node + a dependency-injected `HttpClient` (no
   `vscode.*` imports).
2. Use the same `generateHubSourceId(type, url, …)` algorithm.
3. Return `Installable` objects whose `downloadUrl` is suitable for
   feeding to the extension's `BundleInstaller.installFromBuffer`
   *or* to lib's `BundleDownloader`.

### D15 — Downloader: hand-rolled https *(iter ~12)*

`node:https` with a small redirect helper, mirroring
`GitHubAdapter.downloadFile`. Avoids `axios` dependency. Adds
`HttpClient` interface so a test double can replace it.

### D16 — Extractor: adm-zip *(iter ~14)*

`adm-zip` is already a dependency of the root package (extension)
and lib can adopt the same. We **do not** vendor a pure-TS unzip;
adm-zip is the existing battle-tested choice. License is MIT.

### D17 — Auth: pluggable TokenProvider *(iter ~16)*

Lib defines `TokenProvider` (single method `getToken(host) →
Promise<string|null>`). CLI default impl reads `GITHUB_TOKEN` /
`GH_TOKEN` from env + `~/.config/prompt-registry/token`. Extension
can later supply its own impl that wraps the 4-strategy chain.

### D18 — Adding `claude-code` target *(iter ~40)*

Sixth reserved target type. Default base dir
`${HOME}/.claude` (or `${HOME}/.config/claude-code`, TBD by checking
the actual claude-code CLI distribution conventions). Routes:
`prompts/` → `prompts/`, `agents/` → `agents/`, `instructions/` →
`instructions/`. Mirrors kiro's permissive routing.

## Iteration plan (50 iter, post-discovery)

| Iter | Block | Output |
|---|---|---|
| 7-8 | discovery wrap-up | this design note + decisions D13-D18 |
| 9-15 | lockfile evolution + sourceId helper | D13 implementation + tests |
| 16-22 | HttpClient + GitHubBundleResolver | D14 + tests |
| 23-26 | HttpsBundleDownloader + redirects | D15 + tests |
| 27-30 | AdmZipBundleExtractor | D16 + tests |
| 31-35 | install w/o `--from`: full remote pipeline | wire + e2e |
| 36-38 | lockfile replay body | D11 closure |
| 39-43 | claude-code target + writer layout | D18 + tests |
| 44-46 | iso-functionality verification | parity matrix doc |
| 47-50 | docs, checkpoint, completion | `phase-5-spillover-checkpoint.md` |

## Risks accepted

- **adm-zip on lib side** adds a transitive dep to the published
  package; mitigated by it being a single-file package and already a
  dep transitively.
- **Hand-rolled https** repeats logic the extension already has;
  mitigated by D17 making the resolver/downloader DI-friendly so the
  extension can pass its own client.
- **Lockfile schema drift** between lib (today) and extension
  (existing); mitigated by D13's *additive* extension and dual-read
  on both sides during the migration window.

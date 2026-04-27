# Phase 5 spillover — checkpoint

> **Status as of 2026-04-26, iter 48 of 50.** Phase 5 spillover is
> functionally complete; iters 49-50 deliver the closing docs.

## Recap of intent

Phase 5 (50 iter) shipped a target-agnostic install pipeline + the
local-dir install path (`--from <localDir>`). Phase 5 spillover (50
iter) extends the pipeline with the **remote stack** so the CLI is
**iso-functional with the VS Code extension's `installBundle` flow
for GitHub sources**, while keeping the lib package importable by
the extension (no `vscode.*` imports) — the explicit user
constraint at session start.

## What spillover delivered

### Domain layer

| Type | Where | Notes |
|---|---|---|
| `Target` | `lib/src/domain/install/target.ts` | 6th variant added: `claude-code` (D18) |
| `BundleSpec` | `lib/src/domain/install/installable.ts` | unchanged from Phase 5 |
| `Installable` | same | unchanged from Phase 5 |

### Install module additions (`lib/src/install/`)

| File | Purpose |
|---|---|
| `source-id.ts` | `generateSourceId` + `generateHubKey` (extension-parity hash) |
| `checksum.ts` | `checksumFile` + `checksumFiles` (SHA-256, used by lockfile) |
| `http.ts` | `HttpClient` + `TokenProvider` interfaces; `envTokenProvider`; `NULL_TOKEN_PROVIDER` |
| `node-http-client.ts` | Real `node:https` impl with redirect chain |
| `github-resolver.ts` | `GitHubBundleResolver` (mirrors `GitHubAdapter.fetchBundles + getDownloadUrl`) |
| `https-downloader.ts` | `HttpsBundleDownloader` (mirrors `GitHubAdapter.downloadBundle`) |
| `yauzl-extractor.ts` | `YauzlBundleExtractor` + `isUnsafeZipPath` (zip-slip protection) |

### Install module evolutions

- `lockfile.ts` — additive `sources?` / `hubs?` / `profiles?` /
  `LockfileEntry.fileChecksums?`; new `upsertSource` /
  `upsertHub` / `upsertProfile`. Iso-functional with the extension's
  `LockfileManager` shape.

### CLI surface

| Command shape | Status pre-spillover | Status post-spillover |
|---|---|---|
| `install <bundle> --from <dir> --target <name>` | ✅ Phase 5 | ✅ unchanged |
| `install <bundle> --source <owner/repo> --target <name>` | 🟥 stub (`INTERNAL.UNEXPECTED`) | ✅ end-to-end remote |
| `install owner/repo:bundle@1.0.0 --target <name>` | 🟥 stub | ✅ end-to-end remote |
| `install --lockfile <path> --target <name>` | 🟨 read+validate only | ✅ true replay (refetch + re-write) |
| `target add ... --type claude-code` | 🟥 unknown type | ✅ accepted (D18) |

### Quality gates

- **Tests**: 566 passing (Phase 5 baseline 519 → +47 in spillover)
- **Lint**: 0 errors across `src/install` + `test/install`
  (2 unrelated warnings outside scope)
- **TSC**: clean
- **End-to-end**: real install command spawned in a temp project,
  with a synthetic GitHub release served by `RecordingHttpClient`,
  ends with files on disk + a complete lockfile (sha256 + per-file
  checksums + sources entry).

## Iso-functionality with the extension

Tracked row-by-row in
[`extension-cli-parity.md`](./extension-cli-parity.md). All
in-scope rows are **✅ parity** at iter 48.

Out-of-scope (intentionally deferred or extension-only) rows are
documented as such with a one-line rationale. The remaining
adapters (`awesome-copilot`, `apm`, `skills`) compose against the
exact same `BundleResolver` / `BundleDownloader` / `BundleExtractor`
interfaces shipped in spillover; each is a single-impl drop-in.

## Constraint compliance audit

| Constraint (user, session start) | How we met it |
|---|---|
| Lib-centric and target-agnostic | New code lives in `lib/src/install`; the writer is one impl with a per-type layout map. |
| Reuse existing extension logic | `generateSourceId` mirrors `generateHubSourceId`; lockfile shape additively converges; resolver ↔ adapter parity is documented row-by-row. |
| Don't disturb existing extension flows | Zero edits in `src/` (extension code) since iter 1 of spillover. The extension's `BundleInstaller` continues to use `adm-zip`, its own auth chain, its own lockfile writer. |
| Iso-functional CLI | `install <bundle> --source <owner/repo>` writes the same files the extension writes for the same release; lockfile is shape-compatible. |
| Lib must be reusable by the extension | All resolvers / downloaders / extractors take `HttpClient` + `TokenProvider` via DI. The extension can plug its own (vscode auth + adm-zip + …) without changing lib. |
| Consult codemaps and flows first | iters 1-8 are pure discovery + design. |

## Decisions locked in spillover

| ID | Title | Iter |
|---|---|---|
| **D13** | Lib lockfile evolves additively toward extension shape | 7 |
| **D14** | `BundleResolver` is the non-VS-Code slice of `IRepositoryAdapter` | 7 |
| **D15** | Downloader uses hand-rolled `node:https` | 7 |
| **D16** | Extractor uses `yauzl` (revised iter 30 from adm-zip) | 7 / 30 |
| **D17** | Pluggable `TokenProvider` | 7 |
| **D18** | `claude-code` joins reserved Target types | 7 |

## Iters 49-50 (remaining)

- 49: Phase 5 spillover completion document.
- 50: Final consolidation (parity matrix sign-off, summary).

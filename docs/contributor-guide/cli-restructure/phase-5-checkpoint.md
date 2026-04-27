# Phase 5 — Environment-agnostic install · checkpoint

> Status as of **2026-04-26**, iter 42 of 50.

## What Phase 5 set out to do

> **Phase 5** (50 iter): Environment-agnostic install + targets +
> doctor extensions. Move install out of the VS Code extension and
> into a host-agnostic library/CLI; ship five reserved target types
> (vscode, vscode-insiders, copilot-cli, kiro, windsurf) per spec
> §5.6 / §14.1.

## What Phase 5 has shipped (iter 1-42)

### Domain layer

| Type | Iter | Notes |
|---|---|---|
| `Target` (tagged union) | 1 | 5 reserved variants |
| `BundleSpec` | 8 | parsed install positional |
| `Installable` | 8 | resolved + ready-to-download |

### Install module (`lib/src/install/`)

| File | Iter | Purpose |
|---|---|---|
| `target-store.ts` | 2 | read/write `targets[]` in project config |
| `spec-parser.ts` | 9 | parse install positional |
| `resolver.ts` | 11 | BundleResolver interface + MapBundleResolver |
| `downloader.ts` | 12 | BundleDownloader + MemoryBundleDownloader + sha256 |
| `extractor.ts` | 13 | BundleExtractor + DictBundleExtractor |
| `manifest-validator.ts` | 14 | manifest validation with structured codes |
| `target-writer.ts` | 16-17 | TargetWriter + FileTreeTargetWriter (5 layouts) |
| `pipeline.ts` | 20 | 5-stage orchestrator + PipelineEvent emit |
| `local-dir-source.ts` | 22 | readLocalBundle (bypass download/extract) |
| `lockfile.ts` | 25 | schema + read/write/upsertEntry |

### CLI commands (real bodies)

| Command | Iter | Status |
|---|---|---|
| `target list` | 7 | NAME/TYPE/SCOPE/PATH/ALLOWED-KINDS table |
| `target add <name> --type <T>` | 3 | persists into project config |
| `target remove <name>` | 4 | filters from project config |
| `install <bundle> --target <name> --from <dir>` | 23 | local-dir end-to-end |
| `install --lockfile <path> --target <name>` | 28 | read + validate (replay → spillover) |

### Cross-cutting

| Feature | Iter |
|---|---|
| `--allow-target a,b,c` (CI gate) | 29 |
| `--dry-run` (validate + plan, write nothing) | 23 |
| `doctor` adds `project-config` + `install-targets` checks | 31 |
| `explain` catalog +8 install codes | 32 |

### Tests / Docs

| Iter | Output |
|---|---|
| 5, 10, 11, 12, 15, 18, 19, 21, 24, 26, 30 | unit + integration suites (~50 tests) |
| 33 | `docs/user-guide/install.md` |
| 34, 35, 36, 39 | e2e smoke (4 spawn-based tests) |
| 37 | `docs/reference/commands.md` |
| 38 | decisions D10 + D11 |
| 40, 41 | progress.txt + iterations.md |
| 42 | this document |

## Quality measures (iter 42)

- **Tests**: 516 passing (448 baseline at start of Phase 5 + 68 new)
- **Lint**: clean across `src/cli`, `src/install`, `src/domain`, `test/cli`, `test/install`
- **TSC**: clean
- **End-to-end**: full install workflow verified through built binary
  ```bash
  prompt-registry target add my-vscode --type vscode --path /tmp/v
  prompt-registry install foo --target my-vscode --from /tmp/bundle
  # → Installed foo@1.0.0 into target "my-vscode" (2 written, 0 skipped).
  #   Updated /tmp/proj/prompt-registry.lock.json.
  ```

## Phase 5 spillover (deliberately deferred)

The following interfaces ship today; their implementations are
**Phase 5 spillover**:

1. **Remote bundle resolution** — real `GitHubBundleResolver` /
   `HubCatalogBundleResolver` impls. Plug into the existing
   `BundleResolver` interface.
2. **Remote bundle download** — real HTTPS `BundleDownloader`. Plug
   into the existing `BundleDownloader` interface.
3. **Zip extraction** — real `BundleExtractor` (likely adm-zip). Plug
   into the existing `BundleExtractor` interface.
4. **Lockfile replay body** — read + validate ships in iter 28; the
   per-entry replay loop lands in spillover.

Phase 5 spillover is scoped to the remote network/zip stack
(security review of adm-zip, GitHub-API rate-limit handling, auth,
retries). The local-dir install path delivered today is a complete
dev workflow.

## Iters 43-50 (remaining)

- 43-46: lint sweep, README updates, polish
- 47-49: phase-5-checkpoint final + any spilling tests
- 50: Phase 5 completion document

## What is NOT done in Phase 5

- **No remote install path** (see spillover above).
- **No `target update`** verb (Phase 6 if needed).
- **No declarative replay body** (read+validate ships today).
- **No `--scope=workspace` writer specialization** (relies on
  `target.path` override today; per-host workspace-scope semantics
  are a Phase 6 polish).

## Phase 6 entry conditions

Phase 6 (primitive→runtime translation) can begin once:

1. ✅ Install pipeline interfaces stable
2. ✅ Manifest validation in place
3. ✅ Per-target writer model proven
4. ✅ Lockfile schema locked
5. ✅ Migration guide updated

All five entry conditions are met. Phase 6 can proceed.

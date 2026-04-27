# Phase 4 — `bin/*.js` → unified `prompt-registry` CLI · checkpoint

> Status as of **2026-04-25**, iter 48 of 50.

## What Phase 4 set out to do

> **Phase 4** (50 iter): Fold all 11 `lib/bin/*.js` scripts into
> subcommands of a single `prompt-registry` binary; ship deprecation
> shims; document the migration.

## What Phase 4 has shipped (iter 1-48)

### Native subcommands (8)

| Command | Replaces | Iter |
|---|---|---|
| `collection list` | `list-collections` | 1 |
| `collection validate` | `validate-collections` | 2 |
| `collection affected` | `detect-affected-collections` | 3 |
| `version compute` | `compute-collection-version` | 4 |
| `skill new` | `create-skill` (non-interactive) | 5 |
| `skill validate` | `validate-skills` | 6 |
| `bundle manifest` | `generate-manifest` | 7 |
| `bundle build` | `build-collection-bundle` | 10 |

### Proxy subcommands (3, per decision D8)

| Command | Replaces | Mechanism | Iter |
|---|---|---|---|
| `index <verb>` | `primitive-index <verb>` | in-process import | 12 |
| `hub analyze` | `hub-release-analyzer` | spawn + inherit stdio | 13 |
| `collection publish` | `publish-collections` | spawn + inherit stdio | 13 |

### Net-new commands (5)

| Command | Iter | Status |
|---|---|---|
| `doctor` | Phase 2 | native, full |
| `explain <CODE>` | 19 | native, catalog has 10 entries |
| `config get/list` | 22-23 | native |
| `plugins list` | 24 | PATH-discovery (no invocation yet) |
| `target list/add/remove` | 28-30 | stubs (Phase 5 fills persist) |
| `install <bundle>` | 31 | stub (Phase 5 fills body) |

### Cross-cutting flags

| Flag | Iter |
|---|---|
| `-o / --output <fmt>` | inherited from Phase 2 iter 5 |
| `--json` (deprecated alias) | 16 |
| `--cwd <path>` | 18 |
| `--quiet / -q` | 39 |
| `--no-color` | 40 |
| `--version` reads `lib/package.json` | 21 |

### Deprecation shims

Every legacy `lib/bin/*.js` either:
- Shrinks to a 17-line shim that warns + delegates (iters 9, 11), or
- Adds an in-place deprecation warning at the top (iter 13), preserving body for proxy mode.

Shim mode auto-injects `-o json` for callers parsing stdout
(`list-collections`, `detect-affected-collections`,
`compute-collection-version`, `build-collection-bundle`) so legacy
CI workflows keep working. `publish-collections.js` patched to
unwrap both legacy `{affected}` and new envelope `{data: {affected}}`
shapes.

### Tests / Docs

| Iter | Output |
|---|---|
| 14 | end-to-end smoke (6 spawns of the built binary) |
| 15 | `phase-4-migration-guide.md` |
| 17, 41 | `progress.txt` and `iterations.md` updates |
| 20, 25, 26, 32, 33, 35, 43, 44, 45 | unit + e2e tests for new commands and flags |
| 36, 37 | `docs/reference/commands.md` + `lib/README.md` updates |
| 38 | `bin/prompt-registry.js` + `package.json` `bin` entry |
| 47 | decisions D8 (proxy strategy) + D9 (hand-rolled parser) |
| 48 | this document |

## Quality measures (iter 48)

- **Tests**: 448 passing (374 baseline at start of Phase 4 + 74 new)
- **Lint**: clean across `src/cli`, `test/cli`, `src/domain`, `test/domain`
- **TSC**: `npx tsc -p tsconfig.json --noEmit` clean
- **End-to-end**: `npm run build && node lib/dist/cli/index.js <noun> <verb>` works for all 13 paths

## Iters 49-50 (remaining)

- 49: cross-session handoff progress note + `iterations.md` Phase 4
  log update for iters 17-48.
- 50: Phase 4 completion document (mirrors Phase 3 checkpoint).

## What is NOT done in Phase 4

- **Per-verb migration of `index`**. The 8 verbs (search/harvest/
  stats/shortlist {new,add,remove,list}/export/eval-pattern/bench)
  remain proxied. Each is an iter-sized rewrite for Phase 4.5 or 5.
- **Native `hub analyze`** (771 LOC) and **native `collection
  publish`** (~350 LOC). Same proxy → native trajectory.
- **Clipanion-native option wiring** (decision D9 placeholder).
  Phase 4's hand-rolled parser supports every flag; native option
  declarations would replace the intercepts and provide better
  validation.
- **Markdown / table output formats**. Per spec §11.4, deferred
  alongside their command-specific renderers.
- **`--explain` legacy alias**. Spec mentions it; iter 19 ships
  the explicit `explain <CODE>` command. A `--explain CODE`
  global flag would be additive in a follow-up iter.

## Phase 5 entry conditions

Phase 5 (environment-agnostic install + targets + doctor extensions)
can begin once:

1. ✅ All 11 legacy bins reachable through `prompt-registry`
2. ✅ Stable JSON envelope used by every native command
3. ✅ `RegistryError` namespace + `explain` lookup in place
4. ✅ Layered config loader available
5. ✅ Migration guide published

All five entry conditions are met. Phase 5 can proceed with
`install`'s actual body (the iter-31 stub already declares the
shape).

# Phase 3 — Domain extraction · mid-phase checkpoint (iter 10 / 20)

> Status as of **2026-04-25**, iter 10 of 20.

## What Phase 3 set out to do

Per spec §14.4 (phase boundaries):

> **Phase 3** (20 iter): Extract `bundle`/`primitive`/`hub` domain from `primitive-index`.

Per spec §14.2 invariant #1:

> Domain layer separation. `bundle`, `primitive`, `hub` types live in `lib/src/domain/`. Feature layers (indexing/search, validation, publishing, install, runtime translation) depend on domain — never the reverse.

## What Phase 3 has shipped (iters 1-9)

| Iter | Outcome |
|---|---|
| 1 | Created `lib/src/domain/{bundle,primitive,hub}/` skeleton; promoted bundle/primitive types. |
| 2 | Added `domain-shape.test.ts` regression test + `no-feature-imports-in-domain` ESLint rule. |
| 3 | Removed dead aspirational hub types; created `lib/src/domain/README.md` cut-line audit. |
| 4 | Added `domain/layering.test.ts` runtime defense-in-depth (reverse-dep + orphan checks). |
| 5 | Promoted real `HubSourceSpec` (9-field shape) into `domain/hub/`. |
| 6 | Promoted `PluginItemKind` / `PluginItem` / `PluginManifest` into `domain/hub/`. |
| 7 | Routed public package barrels (`lib/src/index.ts`, `lib/src/hub/index.ts`) through domain. |
| 8 | Removed back-compat re-exports + leftover duplicate type declarations. |
| 9 | Audited remaining feature-layer types; cleaned multi-hop re-exports in package barrel. |

## Concrete deliverables on disk

```
lib/src/domain/
  README.md                # cut-line audit table + promotion rules
  index.ts                 # public barrel
  bundle/
    types.ts
    index.ts
  primitive/
    types.ts
    index.ts
  hub/
    types.ts               # HubSourceSpec, PluginItem, PluginItemKind, PluginManifest
    index.ts
lib/test/domain/
  domain-shape.test.ts     # 14 structural-conformance tests
  layering.test.ts         # 2 runtime layering checks
lib/eslint-rules/
  no-feature-imports-in-domain.js  # invariant-1 enforcement
```

## Quality measures

- **TDD**: every iter wrote tests first or alongside the change. Net delta from iters 1-9 = +16 tests (374 baseline → 386).
- **Lint**: clean across `src/cli`, `test/cli`, `src/domain`, `test/domain`, and the touched `primitive-index/hub/` files.
- **TSC**: `npx tsc -p tsconfig.json --noEmit` clean.
- **Mechanical enforcement**: spec invariant #1 is enforced *both* by an ESLint rule (iter 2) *and* a runtime mocha test (iter 4). Defense-in-depth.

## What is left in Phase 3 (iter 10 onwards)

The audit in iter 9 confirmed every remaining type in `lib/src/primitive-index/hub/` is genuinely feature-local. The structural goal of "extract bundle/primitive/hub from primitive-index" is **structurally achieved**. The remaining 10 iters of Phase 3's budget are reserved for:

1. **Phase 4 spillover** — when commands are folded into the new CLI, they may surface types that weren't visible during the static audit (e.g., shapes touched only via dynamic imports). Phase 3's ESLint rule + runtime test will fail-fast on any such omissions and that's the right time to do additional promotions.
2. **`BundleProvider` abstraction documentation** — a deeper reflection on the `BundleProvider` interface as the seam between hub-fetch and harvest. Currently a 3-method interface; usage patterns from Phase 4 commands may suggest extensions.
3. **Integrity / progress-log promotion** — if Phase 5's `install` command needs to consume `IntegrityEnvelope` (currently in `primitive-index/hub/integrity.ts`), iter 11+ promotes it.

These are *responsive* iters — driven by Phase 4 needs — rather than speculative promotions. The minimal-code principle from `AGENTS.md` says: do not promote types ahead of consumers.

## Cross-phase status

| Phase | Iter budget | Iter complete | Status |
|---|---|---|---|
| 1 — Design spec | 30 | 30 | **COMPLETE & SIGNED OFF** |
| 2 — Framework | 10 | 10 | **COMPLETE** |
| 3 — Domain extraction | 20 | 9 (structural goal achieved at 9) | **STRUCTURAL COMPLETE; 11 reserved** |
| 4 — Fold 11 binaries → subcommands | 50 | 0 | NOT STARTED |
| 5 — Environment-agnostic install | 50 | 0 | NOT STARTED |
| 6 — Primitive→runtime translation | 60+30 | 0 | NOT STARTED |

## Phase 4 entry conditions (proposed)

Phase 4 — folding the 11 `lib/bin/*.js` scripts into a single `prompt-registry` CLI — can begin once:

1. Phase 3 structural extraction is done. ✅ (iter 9)
2. The framework adapter is hardened. ✅ (Phase 2 iter 3)
3. The doctor command provides a working "first-leaf-command" reference. ✅ (Phase 2 iter 8)
4. The golden-test runner is available for new commands. ✅ (Phase 2 iter 7)

All four entry conditions are met. Phase 4 can begin in a fresh session with the iter-1 task: pick the first binary to fold (recommend `validate-collections` — smallest surface) and write the failing TDD test.

## Notes for the next session

- The IDE `edit` tool occasionally fails silently on `lib/src/primitive-index/hub/plugin-manifest.ts` (returns synthetic preview without persisting). If symptoms recur, fall back immediately to `python` heredoc / `cat <<EOF` rewrites. See iter 8 reflections.
- Test count baseline at end of iter 9: **386 passing**.
- Domain barrel exports (canonical surface):
  - **Runtime**: `PRIMITIVE_KINDS`.
  - **Types**: `BundleRef`, `BundleManifest`, `HarvestedFile`, `BundleProvider`, `Primitive`, `PrimitiveKind`, `HubSourceSpec`, `PluginItem`, `PluginItemKind`, `PluginManifest`.
- Next concrete step: open `decisions.md` and lock the migration order for Phase 4 (which binary first, which deprecation cadence).

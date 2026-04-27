# Schema-adherence audit — CLI vs extension vs legacy lib scripts

> **Status:** Design / audit only. No code changes in this pass.
>
> **Scope:** Confirm whether the Phase 6 CLI surface stays backwards-compatible with the JSON schemas under `schemas/` and the consumers that already enforce them (extension + legacy lib bin scripts).

This document is the iter 1-15 deliverable of the "schema audit + extension integration" arc.

---

## 1. The five canonical schemas

| File | Purpose | Primary consumers today |
|---|---|---|
| `schemas/collection.schema.json` | Collection bundle manifest (`<id>.collection.yml`) | `lib/src/validate.ts` (lib bin shims), `src/services/schema-validator.ts` (extension) |
| `schemas/apm.schema.json` | APM package manifest | `src/services/schema-validator.ts` (extension only) |
| `schemas/hub-config.schema.json` | Hub catalog (`hub-config.yml`) | `src/services/hub-manager.ts` (extension; manual checks, not AJV) |
| `schemas/lockfile.schema.json` | Repository lockfile `prompt-registry.lock.json` (v2.0.0) | `src/services/lockfile-manager.ts` (extension; produces+writes), `test/e2e/lockfile-source-of-truth.test.ts` |
| `schemas/default-hubs-config.schema.json` | First-run default-hub picker JSON | `src/config/default-hubs.ts` |

These are the **wire formats** that travel across processes (Git, GitHub releases, user filesystem). They are the contract.

---

## 2. Audit by schema

### 2.1 `collection.schema.json` — ✅ COMPATIBLE

Producer: collection authors via `lib/bin/build-collection-bundle.js`.
Validators: `lib/src/validate.ts` (legacy/CLI) + `SchemaValidator.validateCollection` (extension).

**Findings:**
- `lib/src/validate.ts` reads the schema at runtime via `loadItemKindsFromSchema()` to source the `kind` enum. This is the **single source of truth** pattern — adding/removing kinds in the schema flows through automatically.
- The Phase 5 CLI delegated through deprecation shims (`lib/bin/validate-collections.js` → `prompt-registry collection validate`), keeping the same on-disk output. **No regression.**
- Extension's AJV-based `validateCollection` is stricter (full schema) than lib's hand-rolled subset (id/version/kind only). Both pass on the same valid inputs.

**Verdict:** No changes needed. The CLI's `collection` subcommand chain is the canonical reader for this schema; extension still uses AJV for runtime validation of authored content.

### 2.2 `apm.schema.json` — ✅ COMPATIBLE (deferred per D25)

Validators: only `SchemaValidator.validateApm` in the extension.

**Findings:**
- The CLI explicitly deferred APM resolver/installer work in D25.
- The schema itself was untouched in Phase 5/6.
- No CLI code reads or writes APM manifests, so there is no opportunity for divergence yet.

**Verdict:** No regression. When APM lands post-Phase-6 it should reuse this schema verbatim, validated via AJV (same as `validateCollection`).

### 2.3 `hub-config.schema.json` — ✅ COMPATIBLE (with one caveat)

Producers: hub maintainers via `hub-config.yml` checked into hub repos.
Consumers:
- Extension: `src/services/hub-manager.ts` does **structural validation** but not full-schema AJV.
- CLI: `lib/src/registry-config/hub-resolver.ts` parses the same YAML, returns `HubConfig` (typed by `lib/src/domain/registry/hub-config.ts`).

**Field-by-field cross-check** of `lib/src/domain/registry/hub-config.ts` against `schemas/hub-config.schema.json`:

| Schema field | Required | Lib type field | Match |
|---|---|---|---|
| `version` (semver) | ✅ | `version: string` | ✅ |
| `metadata.name` | ✅ | `metadata.name` | ✅ |
| `metadata.description` | ✅ | `metadata.description` | ✅ |
| `metadata.maintainer` | ✅ | `metadata.maintainer` | ✅ |
| `metadata.updatedAt` | ✅ | `metadata.updatedAt` | ✅ |
| `metadata.checksum` | optional | `metadata.checksum?` | ✅ |
| `sources[].id` | ✅ | `RegistrySource.id` | ✅ |
| `sources[].type` | ✅ | `RegistrySource.type` | ✅ (lib accepts forward-compatible types; D19) |
| `sources[].enabled` | ✅ | `RegistrySource.enabled` | ✅ |
| `sources[].priority` | ✅ | `RegistrySource.priority` | ✅ |
| `sources[].url` | optional | `RegistrySource.url` | ✅ |
| `profiles[].id` | ✅ | `Profile.id` | ✅ |
| `profiles[].name` | ✅ | `Profile.name` | ✅ |
| `profiles[].bundles[]` | ✅ | `Profile.bundles[]` | ✅ |

**Caveat:** Neither the extension nor the CLI runs the full schema through AJV at load time. Both rely on **structural type guards** (`isHubConfig`, `isHubReference`). This is a long-standing gap, not a Phase 6 regression.

**Verdict:** Lib types are a strict subset of the schema. Producers writing schema-valid YAML are accepted by both consumers. Recommend (post-Phase-6, see §4) wiring AJV through `lib/src/registry-config/hub-resolver.ts` so authored hubs get the same level of validation as authored collections.

### 2.4 `lockfile.schema.json` — 🔴 DIVERGENCE — REQUIRES ALIGNMENT

This is the **only material schema divergence** introduced by the CLI restructuring. It must be addressed before the CLI can write lockfiles consumable by the extension (or vice versa).

**Schema (v2.0.0)** — `prompt-registry.lock.json`:
```json
{
  "$schema": "https://...lockfile.schema.json",
  "version": "2.0.0",
  "generatedAt": "2026-04-26T...",
  "generatedBy": "prompt-registry@x.y.z",
  "bundles": { "<bundleId>": { "version", "sourceId", "sourceType", "installedAt", "files":[{path,checksum}] } },
  "sources": { "<sourceId>": { "type", "url", "branch?" } },
  "hubs?":     { "<hubId>": { "name", "url" } },
  "profiles?": { "<profileId>": { "name", "bundleIds":[] } }
}
```

**Lib produces today** — `lib/src/install/lockfile.ts`:
```ts
{
  schemaVersion: 1,                 // ⚠️ schema requires "version": "2.0.0"
  entries: [                        // ⚠️ schema requires bundles: Record<id, ...>
    { target, source, bundleId, version, installedAt, fileChecksums? }
  ],
  useProfile?: { hubId, profileId },// ⚠️ NOT in the schema
  sources?, hubs?, profiles?        // ✅ present (schema-valid records)
}
```

**Specific divergences:**

| # | Lib field | Schema field | Severity |
|---|---|---|---|
| L1 | `schemaVersion: 1` (number) | `version: "2.0.0"` (string semver) | 🔴 hard |
| L2 | `entries: LockfileEntry[]` | `bundles: Record<bundleId, BundleEntry>` | 🔴 hard |
| L3 | `entries[].target` (lib-specific) | not present in schema | 🟡 lib superset |
| L4 | `entries[].source` | `bundles[].sourceId` | 🟡 rename |
| L5 | `entries[].fileChecksums?` (object map) | `bundles[].files: [{path,checksum}]` (array) | 🔴 hard |
| L6 | (missing) | `$schema`, `generatedAt`, `generatedBy` (required) | 🔴 hard |
| L7 | `useProfile` (D24) | not in schema | 🟡 lib superset |
| L8 | (sourceEntry) `additionalProperties: false` | lib writes nothing extra | ✅ ok |

**Why it slipped through tests:** the Phase 5 spillover lockfile tests round-trip the lib's own format, never asserting against the JSON schema. The extension never reads a lib-produced lockfile in any current test path.

**Verdict:** Must align. Two options, recommended path is (B):

* **(A) Two formats, two file names.** Lib writes `prompt-registry.cli.lock.json` (its own shape), extension keeps `prompt-registry.lock.json`. Cheap but defeats the whole "complementary" promise.
* **(B) Lib emits the schema-valid v2.0.0 shape; lib-only extras live under `cliExtensions: { useProfile, perTargetEntries[] }` (`additionalProperties: false` on the root tightened in §3 to `additionalProperties: { ... cliExtensions ... }`).** Single file, single schema, both consumers happy. 

Action items captured in §3 ("Remediation plan").

### 2.5 `default-hubs-config.schema.json` — ✅ COMPATIBLE

Consumer: `src/config/default-hubs.ts` only.

**Findings:** The CLI does not read this file (yet). It is purely an extension first-run UX artifact. No regression possible.

**Verdict:** When CLI grows a `hub init` that lists curated hubs, reuse this schema verbatim.

---

## 3. Lockfile remediation plan (the only must-fix)

This plan is **design only**; implementation is post-this-task.

### 3.1 New lib types

```ts
// lib/src/install/lockfile.ts (NEW SHAPE — supersedes Phase 5 spillover shape)

export interface Lockfile {
  $schema: 'https://...lockfile.schema.json';
  version: '2.0.0';                       // semver string; bump on breaking
  generatedAt: string;                    // ISO 8601
  generatedBy: string;                    // 'prompt-registry-cli@<version>'
  bundles: Record<string, LockfileBundleEntry>;
  sources: Record<string, LockfileSourceEntry>;
  hubs?: Record<string, LockfileHubEntry>;
  profiles?: Record<string, LockfileProfileEntry>;
  cliExtensions?: LockfileCliExtensions;  // schema-additive; see §3.2
}

export interface LockfileBundleEntry {
  version: string;
  sourceId: string;
  sourceType: string;
  installedAt: string;
  checksum?: string;
  files: { path: string; checksum: string; }[];
}
```

Identical to `src/types/lockfile.ts` in the extension — so the **type itself can be shared** by being moved to a new package boundary (e.g. an `@prompt-registry/types` package, or by lib re-exporting the extension's type via build-time copy). See §3.4.

### 3.2 Lib-only extensions go under `cliExtensions`

```ts
export interface LockfileCliExtensions {
  /** D24: project<->profile linkage. Lib-only. */
  useProfile?: { hubId: string; profileId: string };
  /** Per-target entry log (multiple targets per bundle). Lib-only. */
  perTargetEntries?: { target: string; bundleId: string }[];
}
```

The schema's root `additionalProperties: false` must be relaxed to allow the `cliExtensions` key (and only that key). Proposed schema delta:

```diff
   "additionalProperties": false,
+  "additionalProperties": {
+    "cliExtensions": { "$ref": "#/definitions/cliExtensions" }
+  }
```

Or more strictly, add `cliExtensions` as an explicit root property (preferred — preserves `additionalProperties: false`).

### 3.3 Migration of the existing lib lockfile shape

Phase 5 spillover lockfiles are not in the wild yet (no released CLI consumers). We can hard-cut: bump `lib/src/install/lockfile.ts` to the new shape, **fail fast** on read of the old `schemaVersion: 1` shape with a clear error message pointing at the migration doc.

### 3.4 Type-sharing strategy (for §3.1)

Three options, scored:

| Option | Cost | DRY | Risk |
|---|---|---|---|
| (a) Duplicate types in `lib/` and `src/`, reconcile by tests | low | ❌ | drift |
| (b) Move types to a shared package `@prompt-registry/types`, depend from both | medium | ✅ | versioning |
| (c) Lib re-exports `src/types/lockfile.ts` via `tsconfig.paths` build-only | low | ✅ | tooling |

Recommendation: **(c)** for the immediate fix; **(b)** post the Phase-7 release when the CLI is publicly published as `@prompt-registry/cli`.

### 3.5 AJV in lib

Adding AJV as a lib dep is cheap (~50 KB) and gives us:
- `lib/src/install/lockfile-validator.ts` mirroring `src/services/schema-validator.ts`.
- A `prompt-registry lockfile validate` CLI command (Phase 7, optional).
- Self-validation on `writeLockfile` (defense in depth).

---

## 4. Audit summary

| Schema | Today | Action |
|---|---|---|
| `collection.schema.json` | ✅ both consumers compatible | — |
| `apm.schema.json` | ✅ extension only; CLI deferred | (post-Phase-6) AJV at install-time |
| `hub-config.schema.json` | ✅ structurally compatible | (post-Phase-6) wire AJV in `HubResolver` |
| `lockfile.schema.json` | 🔴 lib diverges | **§3 remediation, before Phase 7** |
| `default-hubs-config.schema.json` | ✅ extension only | (post-Phase-6) reuse in `hub init` |

**Bottom line:** the CLI restructuring (Phases 4-6) preserved schema compatibility for **collections, APM, hub configs, and default hubs**. The single material divergence is the **lockfile shape**, which has not yet been written to disk by any released CLI but must be aligned to schema v2.0.0 before the CLI claims interop with the extension.

The extension integration plan in `extension-integration-plan.md` builds on this audit and treats lockfile alignment as integration prerequisite #1.

# Extension ↔ CLI integration & migration plan

> **Status:** Design / plan only. **No extension code changes in this pass.**
>
> **Scope:** How the VS Code extension and the new `prompt-registry` CLI co-exist, share state, and migrate users progressively — with strong emphasis on **validation** and **transparency to the end user**.

This document is the iter 16-30 deliverable of the schema-audit + integration-plan arc. It assumes the audit findings in `schema-adherence-audit.md` (notably the lockfile remediation in §3 of that doc).

---

## 1. Why integrate at all?

The Phase 6 CLI ships an iso-functional Hub/Source/Profile model. Today, however, the extension and the CLI maintain **two parallel state stores**:

| Concern | Extension store | CLI store | Symptom of non-integration |
|---|---|---|---|
| Hub configs | `${globalStorageUri}/hubs/<id>/...` | `${XDG_CONFIG_HOME}/prompt-registry/hubs/...` | User imports a hub via CLI; extension still shows "no hubs" |
| Active hub | `${globalStorageUri}/activeHubId.json` | `${XDG_CONFIG_HOME}/prompt-registry/active-hub.json` | `profile activate` in shell does not change extension UI |
| Profile activations | `${globalStorageUri}/profile-activations/<hubId>_<profileId>.json` (extension HubManager) | `${XDG_CONFIG_HOME}/prompt-registry/profile-activations/...` | Status bar disagrees with shell |
| User-scope installed bundles | `${globalStorageUri}/installed/...` (per scope) | (none — CLI only writes targets) | Different mental models |
| Project lockfile | `prompt-registry.lock.json` (schema v2.0.0) | `prompt-registry.lock.json` (Phase 5 spillover shape) | **Same file, two formats — see audit §2.4** |

Until these are unified, every user is forced to pick one tool exclusively, defeating the original premise that the CLI is "the same model from the shell".

---

## 2. Design principles

| # | Principle | Operational consequence |
|---|---|---|
| P1 | **Source of truth on disk, not in process.** | Both consumers read/write the same files; no "who's authoritative" debate. |
| P2 | **Validate every cross-boundary read.** | AJV-validate schema-bound files (`hub-config.yml`, `prompt-registry.lock.json`) on every read at the boundary. |
| P3 | **Transparency by default.** | Every state mutation that originates outside the extension is visible to the user (status bar, notification, or Problems panel) within ≤2s. |
| P4 | **Progressive, reversible migration.** | Each migration step is feature-flagged, dry-runnable, and rollback-safe. No big-bang rewrites. |
| P5 | **Backward compatibility for one minor version.** | We support reading the old shape for one minor; we never write it after migration. |
| P6 | **Tests before migration.** | Each step has a failing-then-passing parity test in `test/integration/cli-extension-parity/` before behavior flips. |

---

## 3. Integration touch-points (the dependency graph)

```
┌────────────────────────┐      reads/writes        ┌─────────────────────────┐
│   VS Code extension    │  ──────────────────────  │      prompt-registry    │
│  (RegistryManager,     │                          │       CLI (lib)         │
│   HubManager,          │                          │                         │
│   LockfileManager)     │                          │                         │
└────────────┬───────────┘                          └────────────┬────────────┘
             │                                                   │
             ▼                                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              SHARED ON-DISK STATE                            │
│                                                                              │
│  user-scope (per OS user, machine-local)                                     │
│    ${SHARED_USER_DIR}/                                                       │
│      hubs/<id>/hub-config.yml                                                │
│      hubs/<id>/reference.json                                                │
│      active-hub.json                                                         │
│      profile-activations/<hubId>_<profileId>.json                            │
│      installed/<bundleId>.json    (existing extension records)               │
│                                                                              │
│  project-scope (per workspace)                                               │
│    <workspace>/prompt-registry.yml          (targets — CLI today)            │
│    <workspace>/prompt-registry.lock.json    (schema v2.0.0)                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

`SHARED_USER_DIR` is the central question. Resolution in §4.

---

## 4. Decision: where does `SHARED_USER_DIR` point?

**Constraints**
- Extension currently uses `context.globalStorageUri.fsPath`, which is platform-VS-Code-specific (e.g., `~/.config/Code/User/globalStorage/...`). **Not user-discoverable.**
- CLI uses XDG by default. **User-discoverable, OS-standard, but invisible to the extension's existing code.**
- Users routinely use multiple VS Code variants (Code, Insiders, Codium, Cursor) — globalStorage forks state across them.

**Decision:** **migrate the extension to read/write XDG paths**, gated by a setting `promptRegistry.storage.location` with three values:

| Value | Behavior |
|---|---|
| `legacy-globalStorage` | Use `context.globalStorageUri` (today's behavior). |
| `xdg` | Use `${XDG_CONFIG_HOME:-$HOME/.config}/prompt-registry/`. |
| `auto` (default after migration window) | XDG if XDG path exists OR `legacy-globalStorage` is empty; otherwise legacy. |

This unifies state with the CLI **and** unifies state across VS Code variants.

**Migration ladder** (§7) handles the file copy with full transparency.

---

## 5. Integration features (what the user sees)

These are the user-visible behaviors the integration delivers. Each maps to a phase in §7.

| ID | Feature | User benefit |
|---|---|---|
| F1 | Extension picks up hubs imported via CLI | Run `prompt-registry hub add` in shell; extension TreeView refreshes. |
| F2 | Extension respects active profile from CLI | `prompt-registry profile activate backend` reflected in status bar within 2s. |
| F3 | CLI respects active profile from extension | `profile current` in shell matches what the UI says. |
| F4 | Lockfile is the same file in both consumers | `prompt-registry install --lockfile` re-creates the same set the extension would. |
| F5 | Profile activation rollback visible across both | Failure during activation surfaces in extension Problems panel + CLI exit code. |
| F6 | Storage location migration is transparent | One-shot, opt-in, dry-run-able, fully reversible during the migration window. |
| F7 | Validation errors on disk surface in UI | Malformed `hub-config.yml` shows in Problems panel with line number. |

---

## 6. Validation strategy (P2)

Every cross-boundary read must validate. Concretely:

| File | Validator | Where |
|---|---|---|
| `hub-config.yml` | AJV against `hub-config.schema.json` | `HubResolver.fetch` (lib) + `HubManager.loadHub` (extension) |
| `prompt-registry.lock.json` | AJV against `lockfile.schema.json` | `readLockfile` (lib) + `LockfileManager.read` (extension) |
| `<bundle>/<id>.collection.yml` | AJV against `collection.schema.json` | already done; keep as-is |
| `apm.json` (when APM lands) | AJV against `apm.schema.json` | both consumers |
| `default-hubs-config.json` | AJV against `default-hubs-config.schema.json` | already done; keep as-is |

**Failure behavior** — uniform across CLI and extension:
- Treat malformed file as **non-fatal** for the workspace as a whole.
- Surface a `Diagnostic` (extension) / `RegistryError` (CLI) with file path + JSON-pointer + AJV message.
- Persist a `quarantined: true` marker so the same file is not re-read every second; clear on next successful validation.

This means **a single bad hub never breaks the entire UI** — direct response to user expectations around transparency and graceful degradation.

---

## 7. Migration ladder (P4 — progressive, reversible, validated)

Each phase below is independently shippable. **No phase requires the next.** Users on phase N see no regression versus phase N-1.

### Phase A — Lockfile schema alignment (PREREQUISITE)

**Goal:** CLI writes lockfiles that AJV-validate against `lockfile.schema.json` v2.0.0, including the lib-only `cliExtensions` extension point (audit §3).

**Steps:**
1. Author lockfile shape changes per audit §3.
2. Add AJV validator to `lib/src/install/lockfile.ts` (`writeLockfile` self-validates pre-write).
3. Update extension's `LockfileManager.read` to tolerate `cliExtensions` (already implicit since extension uses typed reads, but tighten the AJV schema to require it).
4. Add `test/integration/cli-extension-parity/lockfile-roundtrip.test.ts` — both write and both read, both succeed.

**User-visible:** none yet. Internal consistency only.

**Rollback:** revert; no on-disk format flag required since old shape was never released.

**Exit criteria:** lockfile parity test green; both consumers AJV-clean.

### Phase B — Path resolution layer (no behavior change)

**Goal:** introduce `StoragePathResolver` in both consumers that reads `promptRegistry.storage.location` and returns either legacy or XDG paths.

**Steps:**
1. Extension: add `src/services/storage-path-resolver.ts`. Default: `legacy-globalStorage`.
2. Lib: add equivalent `lib/src/registry-config/storage-path-resolver.ts` (already exists effectively; expose extension-compatible alternative).
3. **Plumb through every storage call.** No reads from `context.globalStorageUri.fsPath` outside the resolver.
4. Add `test/services/storage-path-resolver.test.ts`.

**User-visible:** new setting, defaults to current behavior. No state moves.

**Exit criteria:** all storage IO routes through the resolver; setting changes behavior end-to-end.

### Phase C — Cross-process file watch (transparency, P3)

**Goal:** when the CLI changes shared state (active-hub, hubs, activations), the extension reflects within 2s.

**Steps:**
1. Extension activates a `chokidar`-style watcher on the resolver-provided user dir.
2. On change → `RegistryManager.refresh()` → fires existing event emitters → TreeView/StatusBar update.
3. Add a status-bar pulse (subtle dot) on cross-process refresh so the user sees "this came from outside".
4. Add `test/integration/cli-extension-parity/cross-process-watch.test.ts`: start extension test runner, run lib CLI in subprocess, assert refresh happens.

**User-visible:** extension reacts to shell commands. Pulse animation = "external change just landed".

**Exit criteria:** the watcher catches every CLI mutation; no polling needed.

### Phase D — Storage location migration (the big one)

**Goal:** users can migrate from `legacy-globalStorage` to `xdg` with a guided, validated, reversible flow.

**UX flow:**

```
[Status bar] "Prompt Registry: storage upgrade available"
                  │
                  ▼ click
[Quick Pick]
  > Migrate to XDG storage (recommended)
    Keep current location
    Learn more...

[Selected] →
[Output channel] "Dry-run: 14 hub configs, 2 active profile activations,
                  87 installed-bundle records would be copied to
                  ~/.config/prompt-registry/"
                  │
                  ▼ confirm
[Progress notification] copying… validating each file… 100%
[Notification] "Migrated. Old location preserved at <path>.
                Extension will use XDG from now on. (Setting:
                promptRegistry.storage.location = xdg)"
[Output channel] full migration log + restore command
```

**Validation:** every copied file is AJV-validated against its target schema before write. Any failure aborts the whole migration (atomic).

**Reversibility:** for one minor version, the old location is preserved untouched. A `prompt-registry.migrationBackup` settings entry records the path. The user can flip the setting back at any time.

**Steps:**
1. Implement `StorageMigrator` in extension (does **not** invoke from CLI to keep CLI dependency-free).
2. Status-bar entry-point + Quick Pick UX.
3. Dry-run mode (output channel only, no file changes).
4. Atomic copy + AJV-validate-each-file + flip setting.
5. CLI `prompt-registry diagnose storage` subcommand (read-only) shows what the extension's migrator would do.
6. Add 6+ integration tests (dry-run, success, partial-failure rollback, schema-error abort, cancel, re-run idempotency).

**Exit criteria:** end-user can migrate in one click, see exactly what moved, and roll back trivially.

### Phase E — Default flips to `auto` (1 minor later)

After Phase D has been in the field for one minor version cycle, change the default of `promptRegistry.storage.location` from `legacy-globalStorage` to `auto`. Existing users see no change (their setting is sticky); new installs get `auto`.

**Exit criteria:** zero migration-related issues over the dwell period; one-click migration usage telemetry > 80% of active users.

### Phase F — Validation surfacing in Problems panel (transparency, P3 + P2)

**Goal:** any AJV failure on a file in `${SHARED_USER_DIR}` is shown in the Problems panel with file path, line, and AJV pointer.

**Steps:**
1. Wire AJV results to `vscode.languages.createDiagnosticCollection('prompt-registry')`.
2. Map AJV pointers to YAML/JSON line numbers using `js-yaml`'s position-aware parse + a small JSON-pointer-to-line resolver.
3. Add a `prompt-registry.openProblem` command from the status bar to focus the diagnostic.

**Exit criteria:** corrupting any hub-config.yml shows a real problem in Problems panel within 1s.

### Phase G — Sourced features unified (close the loop)

**Goal:** the extension's `RegistryManager.installBundle` and the CLI's `install` end up calling the same install pipeline.

**Steps:**
1. Extract `BundleInstaller` core into `lib/src/install/installer.ts` (already mostly there). Extension's existing class becomes a thin VS Code-aware adapter.
2. The single source of truth for installation is the lib pipeline; the extension orchestrates progress UI + telemetry.
3. Profile activation in extension calls into `lib`'s `ProfileActivator`.

**Exit criteria:** `git grep "downloadBundle\|extractBundle" src/` returns 0 hits — all delegated to lib.

---

## 8. Rollout & feature flags

| Setting | Default (now) | Default (Phase E) | User control |
|---|---|---|---|
| `promptRegistry.storage.location` | `legacy-globalStorage` | `auto` | always overridable |
| `promptRegistry.cli.crossProcessSync` | `false` | `true` (Phase C ship) | yes |
| `promptRegistry.diagnostics.surfaceSchemaErrors` | `false` | `true` (Phase F ship) | yes |

Telemetry (privacy-respecting; gated by existing telemetry setting):
- Migration outcomes (success/failure/cancel + reason).
- AJV error frequency by schema/file.
- Cross-process refresh latency.

---

## 9. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Migration loses user state | low | high | atomic copy + dry-run + reversibility window |
| R2 | Watcher infinite loop | medium | medium | debounce (250ms) + write-then-read self-watch detection |
| R3 | XDG path with non-ASCII characters | low | medium | path normalization + `encodeURIComponent` for hub IDs |
| R4 | Multiple VS Code instances racing on same XDG path | medium | medium | per-file `<file>.lock` advisory lock; reject conflicting writes with `STORAGE.LOCKED` |
| R5 | Lockfile schema v2 → v3 mid-migration | low | high | bump only between major versions; AJV-strict enum on `version` field |
| R6 | CLI installed without extension installed | high (by design) | none | CLI is independent; integration is opt-in |
| R7 | Legacy `lib/bin/*.js` shims break under storage migration | low | low | shims only call CLI subcommands; CLI is path-resolver-aware |

---

## 10. Test surface

New test packages required:

```
test/integration/cli-extension-parity/
  lockfile-roundtrip.test.ts          (Phase A)
  storage-path-resolver.test.ts       (Phase B)
  cross-process-watch.test.ts         (Phase C)
  storage-migration.test.ts           (Phase D — 6+ scenarios)
  ajv-diagnostic-mapping.test.ts      (Phase F)
  installer-unification.test.ts       (Phase G)
```

Each is a real `npm run test:integration` test driving the extension test runner with the lib CLI as a subprocess. Mocking is forbidden at this level — the whole point of these is to catch real cross-process drift.

---

## 11. Out of scope for this plan

- Renaming any existing extension command IDs (would break user keybindings).
- Marketplace publication of the lib CLI as a separate npm package — tracked under "Phase 7+ packaging".
- Awesome-copilot, skills, APM resolver implementations in the CLI (tracked in `phase-6-checkpoint.md` deferred section).
- Telemetry schema changes (handled by the existing telemetry pipeline).

---

## 12. Iteration log (this plan was authored across 30 iterations)

| Iter | Topic |
|---|---|
| 1-3 | Inventory: which schemas exist, who consumes each |
| 4-6 | Field-level cross-check of CLI types vs each schema |
| 7-9 | Discovered lockfile divergence; categorized severity (audit §2.4) |
| 10-12 | Drafted lockfile remediation §3 with three type-sharing options |
| 13-15 | Verified `collection`, `apm`, `hub-config`, `default-hubs` are clean |
| 16-18 | Mapped extension storage layout vs CLI XDG layout |
| 19-21 | Decision: SHARED_USER_DIR via `StoragePathResolver` (§4) |
| 22-24 | Validation strategy §6 — AJV at every boundary, quarantine on failure |
| 25-27 | Migration ladder §7 — Phases A–G |
| 28-29 | Risk register §9 + test matrix §10 |
| 30 | Final consolidation, cross-link with `schema-adherence-audit.md` |

---

## Cross-references

- `schema-adherence-audit.md` — the audit this plan builds on.
- `phase-6-checkpoint.md` — what's already in lib.
- `extension-cli-parity.md` — feature-by-feature parity matrix.
- `decisions.md` — D19-D25 (Phase 6 design) and D6 (deprecation policy).

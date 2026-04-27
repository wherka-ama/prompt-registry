# Locked architectural decisions

Decisions below are locked by the user and should not be re-opened inside Phase 1. Later phases may revisit only if a concrete implementation blocker forces it (in which case we open a new decision entry here, not silently change).

## D1 — Single binary, consolidated

- One entry point: `prompt-registry`.
- All current `lib/bin/*.js` (11 scripts) become subcommands.
- Thin shims for the original binary names may remain during a deprecation window.

## D2 — Framework foundation *(locked iter 13)*

- **Primary: `clipanion`** (zero runtime deps, FSM parser, class-based with `Option.*`, `Command.Paths` matches our noun-verb taxonomy, in-process `cli.run` test harness, used by Yarn Berry in production at scale).
- **Fallback: `oclif`** (activated if Phase 2 hits a blocker with clipanion before Phase 3 begins; framework swap remains possible because no leaf command imports clipanion directly — only `lib/src/cli/framework/` does).
- **Eliminated:** `citty` (younger, API churn risk), `commander` and `yargs` (JS-first, no first-party test harness, no structured-error contract). Both kept as last-resort fallbacks only.
- **Companion: `c12`** (UnJS) selected as the layered YAML config loader regardless of CLI framework. Plugs into the framework adapter.
- Decision matrix and scoring: see `spec.md §6.5`.
- **Phase 2 architectural invariant.** All clipanion-specific code lives in `lib/src/cli/framework/`. Leaf commands declare `Command.Paths`, extend a project-local `Command` base class, and never import clipanion directly. This guarantees the fallback to oclif (or any later framework swap) is a contained refactor.

## D3 — Configuration strategy

- Layered, YAML-first.
- Resolution order (low → high): built-in defaults < user config (`$XDG_CONFIG_HOME/prompt-registry/config.yaml`) < project config chain (`./prompt-registry.config.yaml` walked upward from `cwd`; every hit merges, deepest wins) < env (`PROMPT_REGISTRY_*`) < CLI flags.
- `--config FILE` and `--config KEY=VALUE` both accepted. Repeats merge left-to-right. `--config` takes precedence over env and all files.
- Merge semantics: scalars override; arrays concatenate with higher-precedence items last (cargo semantics).
- Env-var mapping: `foo.bar.baz` ↔ `PROMPT_REGISTRY_FOO_BAR_BAZ` (dots and dashes → underscores; upper-case).
- Schema-validated. Profiles / sections per subcommand.
- Never embed `prompt-registry` config in `package.json` — always a dedicated file (pnpm lesson).
- Monorepos: workspace-level + per-member files both allowed; per-member files override workspace file (cargo's upward-walk rule).

## D4 — Root-cause remedies (the "not happy about" list)

Research and spec must explicitly address **all four**:

1. **Barrel-only, no physical move** — real package boundaries, not alias files.
2. **Wrong conceptual ownership** — bundle / hub / primitive domain lives in a shared package, not inside `primitive-index`. Search (BM25/tokenizer/eval/bench) depends on the domain, not the reverse.
3. **Leaky package root** — curated public API; primitive-index internals must not be reachable from `@prompt-registry/collection-scripts`.
4. **No real CLI composition story** — shared framework (config, flags, help, exit codes, logging, plugin hook, subcommand registry).

## D5 — Reflect & correct rigor

- When iter N invalidates iter M (M < N), rewrite iter M's entry in `iterations.md` and annotate both.
- `spec.md` is kept strictly consistent at all times.

## D6 — Checkpoint cadence

- Every 5 iterations (after iter 5, 10, 15, 20, 25, 30).

## D7 — Baseline runtime

- Node `>=20` (bump from the current `>=18`, justified by framework selection and modern API surface).
- ESM where viable; TypeScript strict.

## D8 — Phase 4 proxy strategy *(locked iter 13)*

The unified `prompt-registry` CLI ships in two layers:

1. **Native commands**: subcommands rewritten on the framework. They
   emit the JSON envelope, route errors through `RegistryError`, and
   honor `Context` invariants. **8 of 11** legacy bins are native
   (collection list/validate/affected, bundle manifest/build, skill
   new/validate, version compute).
2. **Proxy commands**: `index <verb>`, `hub analyze`, `collection
   publish` are dispatched to the legacy `lib/bin/<name>.js` script
   via `child_process.spawn` with `stdio: 'inherit'` (or in-process
   `import` for `primitive-index/cli`). The legacy parser handles
   flags; the proxy keeps the existing surface available immediately
   without rewriting ~1000 lines.

**Rationale**: Phase 4's primary goal — "every legacy bin reachable
through `prompt-registry`" — is achieved with the proxy approach in
half the time. Native ports of the proxied commands are scheduled
for iters 36-50 (or Phase 5 if necessary); shipping the unified
binary first lets users start migrating CI workflows without
waiting for the per-command rewrite.

## D9 — Hand-rolled argv parser at the binary entry *(locked iter 8)*

`lib/src/cli/index.ts` parses argv by hand for the cross-cutting
flags (`-o`, `--cwd`, `--quiet`, `--no-color`, `--collection-file`,
`--version`, `--out-dir`, `--repo-slug`, `--changed-path`,
`--skill-name`, `--description`, `--skills-dir`, `--verbose`,
`--markdown`). Each parsed flag becomes an option on every
`createXxxCommand` factory, so commands that need a flag receive
it; commands that don't ignore it.

**Rationale**: clipanion-native option wiring per command is
~15 lines of boilerplate × 17 commands. The hand-rolled parser is a
single 80-line function that handles every existing flag and is
easy to evolve. Iter 9 (clipanion-native options) will incrementally
replace it as commands need stricter validation; the cutover is
mechanical.

**Trade-off accepted**: positional arguments (`explain <code>`,
`config get <key>`, `target add <name>`, `install <bundle>`) are
intercepted *before* `runCli` rather than declared as clipanion
positionals. The intercept blocks are ~10 lines each and are
mechanical to convert when the framework adapter learns positionals.

## D10 — Install pipeline composition *(locked Phase 5 / iter 20)*

The install pipeline is composed of five stages behind explicit
interfaces:

```
BundleResolver  ->  BundleDownloader  ->  BundleExtractor  ->  validateManifest()  ->  TargetWriter
```

Each stage is plug-in via a TypeScript interface. `InstallPipeline`
sequences them and emits `PipelineEvent` through an optional
`onEvent` callback so the install command can render verbose
progress and feed the JSON envelope's `meta.events`.

**Rationale**: the four real impls (GitHub-API resolver, HTTPS
downloader, adm-zip extractor, per-host writers) are heterogeneous
and each has its own test surface. Composing them behind interfaces
keeps the pipeline testable in isolation (deterministic test doubles)
and decouples the iteration cadence — Phase 5 ships 4-of-5 stage
interfaces today; the GitHub resolver + HTTP downloader land in
Phase 5 spillover without changing the pipeline's contract.

**Trade-off accepted**: `InstallPipelineError` carries a (code, stage)
pair so the install command can branch on stage-specific failure
modes; this duplicates the structured-code vocabulary RegistryError
already maintains, but keeps the pipeline's error surface concrete
and testable.

## D11 — Phase 5 spillover scope *(locked Phase 5 / iter 23)*

Phase 5's primary deliverable is "environment-agnostic install".
The interfaces, target persistence, manifest validation, target
writers, lockfile read/write, and `--from <localDir>` install path
ship in this phase. The remote resolver + HTTP downloader + zip
extractor land in **Phase 5 spillover**.

**Rationale**: The Phase-5 boundary is "install works for bundles
the user can produce locally". Adding a network/zip-reader
dependency stack is a separate concern (security review, license
audit for adm-zip, GitHub-API rate-limit handling, auth, retries).
Shipping the local-dir path now gives users a complete dev workflow
(`bundle build` → `install --from`) and lets them migrate CI scripts;
spillover delivers the remote path without surface changes (same
install command, same flags).

**Trade-off accepted**: `prompt-registry install <bundle>` *without*
`--from` surfaces an `INTERNAL.UNEXPECTED` with a hint pointing at
`bundle build` + `install --from`. Users who need remote install
must wait for spillover or configure their own resolver via the
plugin API (P5 spillover deliverable).

## D12 — Lockfile schema *(locked Phase 5 / iter 25)*

`prompt-registry.lock.json` is JSON (not YAML), `schemaVersion: 1`,
`entries[]` ordered by install order. Each entry: `target`,
`sourceId`, `bundleId`, `bundleVersion`, `installedAt` (ISO-8601),
`files[]` (bundle-relative paths), optional `sha256`.

**Why JSON not YAML?**
- Lockfiles are machine-written + machine-read; comments add no
  value (the project config carries comments).
- JSON's stricter syntax catches accidental hand-edits earlier.
- Diff-friendliness is preserved by pretty-printing on write.

**Why `target` on every entry instead of grouping by target?**
- The same bundle can be installed into multiple targets in the
  same project; per-target grouping turns lookups (`is bundle X
  installed for target Y?`) into nested traversal.
- The flat list is cheaper to merge across machines (Git conflicts
  appear on the array boundaries, not on per-target subobjects).

**Why upsert-by-(target, bundleId)?**
- Bundle versions can change without the (target, bundleId) pair
  changing; users want a single entry per logical install, not a
  history.
- A separate `--lockfile-history` mode could record every install
  in the future without disturbing the contract.

## D13 — Lib lockfile evolves additively toward extension shape *(locked Phase 5 spillover / iter 7)*

The lib lockfile (today: `schemaVersion: 1`, flat `entries[]`) gains
optional `sources{}`, `hubs{}`, `profiles{}` siblings, mirroring the
extension's `LockfileManager` shape. Existing fields are unchanged.
Readers tolerate missing sections; writers emit them only when
populated. Once both consumers (lib CLI + extension) read/write
the shared shape, the migration window closes and the duplication
between `lib/src/install/lockfile.ts` and the extension's
`LockfileManager` can collapse.

## D14 — `BundleResolver` is the non-VS-Code slice of `IRepositoryAdapter` *(locked Phase 5 spillover / iter 7)*

Every concrete `BundleResolver` in lib (e.g., `GitHubBundleResolver`)
must consume only Node + a dependency-injected `HttpClient` — no
`vscode.*` imports. This keeps lib importable by the extension
without sucking in the framework. Resolvers reuse the extension's
`generateHubSourceId(type, url, {branch, collectionsPath})` algorithm
verbatim so identifiers remain stable across both consumers.

## D15 — Downloader uses hand-rolled `node:https` *(locked Phase 5 spillover / iter 7)*

Mirrors `GitHubAdapter.downloadFile` (https.get + manual redirect
chain). Rationale: avoids an `axios` dependency, matches the
extension's behavior precisely (auth headers, redirect depth limit,
status handling). The downloader sits behind an `HttpClient` interface
so test doubles can replace it without spinning up sockets.

## D16 — Extractor uses `yauzl` *(locked Phase 5 spillover / iter 7; revised iter 30)*

**Original decision (iter 7)**: lib will use `adm-zip` because the
extension already does.

**Revision (iter 30)**: lib uses `yauzl` instead. Discovery during
implementation revealed that `adm-zip` is a *root* (extension-only)
dep, while `yauzl` is already in the lib's dep tree as the
`archiver` peer-loader. Same functional surface (lazy entry walk,
in-memory decode), no new transitive deps for the published
`@prompt-registry/collection-scripts` package. Both libraries have
MIT licenses. Zip-slip protection is implemented in
`isUnsafeZipPath` and unit-tested directly (archiver normalizes
zip-slip paths in fixtures, so the predicate is the test surface).

The extension's `BundleInstaller` continues to use `adm-zip`; no
disturbance to existing flows. When the extension migrates to lib's
extractor, the choice can be unified by either side.

## D17 — Pluggable `TokenProvider` *(locked Phase 5 spillover / iter 7)*

Auth in lib is encapsulated in `TokenProvider { getToken(host: string)
→ Promise<string | null> }`. The CLI default impl reads
`GITHUB_TOKEN` / `GH_TOKEN` / `~/.config/prompt-registry/token`. The
extension provides its own impl chaining vscode auth → `gh` CLI.
Resolvers + downloader receive a `TokenProvider` via constructor;
they never read `process.env` directly.

## D18 — `claude-code` joins the reserved target types *(locked Phase 5 spillover / iter 7)*

Adds `claude-code` to the reserved Target tagged union (now 6
variants). Default base dir: `${HOME}/.claude`. Routes mirror kiro's
permissive layout (prompts/, agents/, instructions/, chatmodes/).
Spec §5.6's reserved list grows; the constraint that Target is a
*tagged union* (not a string) is preserved.

## D19 — Hub config schema additively mirrors extension's *(locked Phase 6 / iter 7)*

The lib's `HubConfig` is a **superset-compatible subset** of the
extension's `src/types/hub.ts` `HubConfig`: same field names, same
JSON-schema validators (we reuse `schemas/hub-config.schema.json`),
and same `sanitizeHubId` rules. Lib drops the
`vscode.EventEmitter`-bound members and any UI-only fields
(`ConflictResolutionDialog`, `formatChangeSummary` etc.). When the
extension serializes a hub config, lib can read it without a
migration; when lib writes one, the extension can read it the same
way. **No schema fork.**

## D20 — User-level state lives at XDG `~/.config/prompt-registry/` *(locked Phase 6 / iter 7)*

Lib follows the [XDG Base Directory
Specification](https://specifications.freedesktop.org/basedir-spec/):

| What | Where |
|---|---|
| Hub configs | `${XDG_CONFIG_HOME:-$HOME/.config}/prompt-registry/hubs/` |
| Profile activations | `${XDG_CONFIG_HOME:-$HOME/.config}/prompt-registry/profile-activations/` |
| Active hub pointer | `${XDG_CONFIG_HOME:-$HOME/.config}/prompt-registry/active-hub.json` |
| Optional user targets | `${XDG_CONFIG_HOME:-$HOME/.config}/prompt-registry/targets.yml` |
| Token cache | `${XDG_CONFIG_HOME:-$HOME/.config}/prompt-registry/token` |

The extension's `globalStorageUri.fsPath` is host-defined and not
under user control; the lib refuses to share that path even if
running on the same machine, so the extension and CLI **do not
trample each other's hub state**. A future iter may add a
`prompt-registry user import-from-extension` migration helper, but
no shared writes.

## D21 — Single active profile globally *(locked Phase 6 / iter 8)*

Mirrors the extension's invariant (`activateProfile` deactivates
every other active profile across all hubs). Activating profile B
while profile A is active is a one-shot
`deactivate(A) → activate(B)` transition. Two profiles cannot be
co-active; that would defeat the "this is my current role" UX.
Forced by the activation store's API: there is no
`activateMany`.

## D22 — Profile activation is atomic with rollback *(locked Phase 6 / iter 8)*

When activating profile P with N bundles:

1. Resolve all N bundles upfront (any `null` from the resolver
   aborts before any IO).
2. Download all N (any failure aborts before any extraction).
3. Validate manifests (any failure aborts before any write).
4. Write all N atomically via the writer (`FileTreeTargetWriter`).
   On any per-bundle failure, **revert previously-written files for
   this activation** by deleting them, then re-throw with a
   `PROFILE.ACTIVATION_FAILED` code.

Rollback is deliberately conservative: lib does not try to "merge"
a partial profile. Either the whole profile lives or none of it
does. The activation state is written *only* at the end; a failed
activation leaves no `ProfileActivationState` on disk.

## D23 — Default local hub for detached sources *(locked Phase 6 / iter 9)*

The user can `source add ...` without first importing a hub.
Behind the scenes, lib auto-creates a synthetic hub:

```
hubs/default-local/
  config.yml   (HubConfig with metadata.name = "Local sources",
                metadata.description = "Auto-managed; do not edit
                directly", sources[] populated as the user adds
                them, profiles[] empty unless the user creates
                local profiles)
  meta.json    (reference: { type: 'local', location: <path> })
```

The user is never *required* to import a curated hub; they can run
the CLI in fully-detached mode forever. But the data model
guarantees every source belongs to *some* hub, which keeps
`source list`, `profile activate`, and lockfile entries uniform.
Identifier: `default-local`. Reserved; users cannot create a hub
with that ID.

## D24 — Lockfile `useProfile?` linkage *(locked Phase 6 / iter 9)*

Adds an optional `useProfile?: { hubId: string; profileId: string }`
to the project lockfile root. When set, `install --lockfile`
replay also activates that profile after replaying entries
(idempotent — re-activation is a no-op when the activation state
matches what the lockfile expects).

This is **complementary**, not redundant, to the entries[]:

- `entries[]` records *every* bundle in the project (manual,
  profile-driven, or both)
- `useProfile?` records the **intent**: "this project is supposed
  to be running profile X"; CI replay both restores the bytes and
  re-flags the activation

A project that doesn't use profiles simply omits `useProfile?`.

## D25 — APM adapter deferred *(locked Phase 6 / iter 10)*

Per user direction (session start), the `apm` and `local-apm`
source types are NOT in scope for Phase 6. The schema accepts them
(forward-compat, no error) and lib's `BundleResolver` interface is
ready for them, but no resolver impl ships in this phase. Tracked
as post-Phase-6 spillover alongside `awesome-copilot` and `skills`.


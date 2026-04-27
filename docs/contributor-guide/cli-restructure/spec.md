# `prompt-registry` CLI — design spec

> Status: **Phase 1 complete, awaiting sign-off** (iter 30). Implementation begins in Phase 2 once §14.6 entry criteria are met.
> Companion files:
> - `iterations.md` — per-iteration delta + reflection log (iter 1–30)
> - `decisions.md` — locked architectural calls (D1–D7)
> - `progress.txt` — durable cross-session notes
> - `migration-plan.md` — per-binary migration mechanics

## 0. Summary

A single Node ≥20 binary `prompt-registry` replaces the 11 scattered `lib/bin/*.js` scripts. It is built on **clipanion** (with **oclif** locked as fallback) and uses **c12** for layered YAML configuration. The architecture cleanly separates the **domain layer** (bundle / primitive / hub) from **feature layers** (indexing & search, installation, runtime translation, validation, publishing); only domain code may be depended on transitively, never the reverse.

The command surface is a two-level noun-verb taxonomy (`prompt-registry <noun> <verb>`) with a single 3rd-level carve-out under `index`. Inherited flags propagate at every depth (`--config`, `--output`, `--log-level`, `--color`, `--profile`, `--allow-target`, `--exit-on-warning`, `--exit-on-deprecation`, `--no-plugins`, `--allow-plugins`, `--strict-plugins`, `--dry-run`). Output flows through a unified `-o, --output {text,json,yaml,markdown,table,ndjson}` flag with auto-detection (text on TTY, json off-TTY) and a stable JSON envelope `{schemaVersion, command, status, data, warnings, errors, meta}`. Errors use the `RegistryError` shape `{code, message, hint, docsUrl, cause, context}` with a 60-code dotted-path namespace and POSIX/sysexits/domain-tier exit codes.

Plugins are PATH-binaries by default (`prompt-registry-<name>` per the `gh` / `kubectl` model, with kubectl dash-nesting); npm-plugins are opt-in only via `plugins.allowNpm: true`. Tests run in-process via `runCommand(argv, ctx)` over an injectable `Context {stdin, stdout, stderr, fs, net, env, clock, cwd}`; an ESLint rule forbids commands from touching Node globals directly.

Migration from the 11 old binaries is gated by a deprecation lifecycle (Phase 4 ship → Phase 5 deprecate → next major remove); shims are 6-line files in `lib/bin/<old-name>.js` that delegate to `runCli`.

## 1. Scope & goals

### 1.1 What `prompt-registry` is

A single Node.js CLI binary that is the canonical command-line interface for the Prompt Registry ecosystem. It unifies the capabilities currently split across 11 stand-alone scripts into one consistent, discoverable tool.

### 1.2 Primary goals (ordered)

1. **Unify entry points.** One `prompt-registry` binary. All current `lib/bin/*.js` functionality reachable as subcommands with consistent flag, help, and exit-code conventions.
2. **Enforce a clean domain layer.** Bundle / primitive / hub concepts live in a shared domain package. Feature layers (indexing/search, validation, publishing, installation, runtime translation) depend on that domain — never the reverse.
3. **Curate the public API.** Only intentional surface is exported from `@prompt-registry/collection-scripts`. No internal `primitive-index/hub/*` leakage.
4. **Layered YAML configuration.** Users configure once (project or user level), override per invocation with env or flags, and can carry config across machines via git.
5. **Environment-agnostic operations.** Install / list / search / update work identically whether the host runtime is VS Code, VS Code Insiders, GitHub Copilot CLI, Kiro, or Windsurf. The CLI does not require those environments to be present.
6. **Testable-by-default.** Every subcommand and every IO boundary (stdin, stdout, stderr, fs, network, env) is injectable so tests can assert on structured output without spawning subprocesses where possible.

### 1.3 Secondary goals

- Plugin model that allows third parties to add subcommands without forking.
- Stable JSON output contract for machine consumers (scripts, extensions, CI).
- First-class structured logging (`--log-level`, JSON logs in CI mode).
- Minimal but complete i18n-neutral English output. No emoji in error paths; short, actionable messages.

## 2. Non-goals

- Being a general-purpose prompt-engineering runtime. `prompt-registry` manages *artifacts* (bundles, primitives, profiles, collections) and their lifecycle; it does not execute prompts.
- Being a multi-tenant server. The CLI is a local tool; remote operations are HTTP/Git calls to existing hubs.
- Replacing the VS Code extension UI. The extension remains the graphical surface; the CLI covers the same capabilities for terminal / CI / non-VS-Code hosts.
- Breaking existing CI pipelines in the short term. Backward-compat shims preserve current `bin/*.js` names during a documented deprecation window (detailed in §13).
- Rewriting the search engine or harvest pipeline in this effort. We move and re-layer the existing working code; we do not rewrite it.

## 3. User personas & workflows

### 3.1 Personas

- **P1 — Contributor to a hub repository.** Authors bundles/collections/skills. Runs validate, build, generate-manifest, create-skill from repo root. Needs fast feedback and clear validation errors.
- **P2 — Hub maintainer / release engineer.** Runs publish-collections, compute-collection-version, hub-release-analyzer. Needs reproducible output, machine-readable logs, stable exit codes for CI.
- **P3 — End-user developer.** Consumes bundles. Wants to search the index, shortlist primitives, and install bundles into whichever agentic host they use (VS Code / Insiders / Copilot CLI / Kiro / Windsurf).
- **P4 — Extension backend.** The VS Code extension already calls library functions. It must keep working unchanged; the CLI is a sibling consumer of the same library.
- **P5 — Automation / CI.** Invokes subcommands non-interactively with `--json` output and expects sysexits-style exit codes.

### 3.2 Representative workflows

- *P1, local repo:* `prompt-registry bundle validate` · `prompt-registry bundle build --out dist/` · `prompt-registry collection list` · `prompt-registry skill new <name> --description "…"`.
- *P2, CI:* `prompt-registry version compute --output json` · `prompt-registry collection publish --dry-run` · `prompt-registry hub analyze --since v1.2.0 --output markdown`.
- *P3, terminal:* `prompt-registry index harvest --hub-repo org/hub` · `prompt-registry index search -q "terraform"` · `prompt-registry install <bundle-id> --target vscode` or `--target copilot-cli`.
- *P4, extension:* imports from `@prompt-registry/collection-scripts` (public API only); does not shell out to the CLI.
- *P5, automation:* `PROMPT_REGISTRY_LOG_LEVEL=info prompt-registry collection validate --output json | jq …`.

## 4. Inventory of current entry points

Source: `lib/package.json#bin` + headers of `lib/bin/*.js`.

| Current binary | Purpose | Planned subcommand |
|---|---|---|
| `validate-collections` | Validate all `collections/*.collection.yaml` files | `prompt-registry collection validate` |
| `validate-skills` | Validate `skills/*/SKILL.md` folders | `prompt-registry skill validate` |
| `build-collection-bundle` | Build a deployable bundle ZIP from a collection | `prompt-registry bundle build` |
| `compute-collection-version` | Compute next semver for a collection from git history | `prompt-registry version compute` |
| `detect-affected-collections` | Detect collections affected by a diff range | `prompt-registry collection affected` |
| `generate-manifest` | Render a `deployment-manifest.yml` from a collection | `prompt-registry bundle manifest` |
| `publish-collections` | Publish bundles to a hub (GitHub release flow) | `prompt-registry collection publish` |
| `list-collections` | List collection files in a repo | `prompt-registry collection list` |
| `create-skill` | Interactive/CLI wizard to scaffold a new skill | `prompt-registry skill new` |
| `hub-release-analyzer` | Analyze hub release download stats | `prompt-registry hub analyze` |
| `primitive-index` | BM25 search + harvest + shortlist + export + eval/bench | `prompt-registry index …` subtree |

Observations feeding §7 (command taxonomy):

- Six natural nouns surface from existing scripts: `collection`, `bundle`, `skill`, `index`, `hub`, `version`. Phase 5 adds three more (`target`, `config`, `plugins`).
- `primitive-index` is the only existing binary with a subcommand tree; the rest are flat — the unification will deepen all of them by one level.
- `install` does not exist as a script today; it lives inside the VS Code extension. Phase 5 moves it into the library and surfaces it as `prompt-registry install`. Plugins for additional install targets (e.g. JetBrains, Zed) remain a third-party `prompt-registry-install-<host>` extension surface.

## 5. Competitive scan of modern CLIs

*(Populated across iter 4–8. Each exemplar entry lists: architecture, help UX, config, output, extension/plugin model, exit codes, and one specific take-away we adopt.)*

### 5.1 clig.dev — Command Line Interface Guidelines *(iter 4 reference framework)*

Not a CLI itself but the canonical modern guideline, authored by practitioners from Heroku, Anchore, Replicate et al. Principles we adopt verbatim:

- **Human-first; machine-second via a stable contract.** Default output is human-readable; `--json` (and friends) switches to a stable machine contract.
- **Consistency across programs.** Reuse POSIX conventions: `-h`/`--help`, `-V`/`--version`, `--`, kebab-case flags, `NAME=VALUE` for key-value, stdin when `-` is the positional arg.
- **Ease of discovery.** `prompt-registry` (no args) shows the most-used subcommands first, not an exhaustive list. Every subcommand has `--help`.
- **Conversation as the norm.** On failure, suggest the next action (`did you mean …?`, `try --help`, `run X first`).
- **Empathy.** Error messages name the offending file/line/flag, the cause, and the fix — never only the symptom.
- **Configuration layering.** Defaults < config file < env < flags. *(Matches our D3.)*
- **Env-var naming.** `PROMPT_REGISTRY_<SUBCOMMAND>_<KEY>` upper-case, underscores.

### 5.2 Cargo (Rust) — canonical reference for layered configuration *(iter 4)*

Cargo's config system is the closest precedent to our D3 decision and we should mirror its shape (adapted from TOML to YAML):

- **Upward directory walk for project config.** Cargo probes `.cargo/config.toml` in `cwd` and every ancestor, merging results deepest-first with CWD winning. `$CARGO_HOME/config.toml` is the user-global fallback.
- **Env-var mapping by convention.** `foo.bar` ↔ `CARGO_FOO_BAR`. Dots and dashes become underscores; keys upper-case.
- **Precedence.** CLI (`--config KEY=VALUE`) > env > config files. `--config` accepts either inline `KEY=VALUE` or a file path; repeats merge left-to-right.
- **Merge semantics.** Scalars override; arrays concatenate with higher-precedence items placed later.
- **`include` for composition.** Config files can include other config files — useful for monorepos that share policy across multiple projects.

Our adaptation: YAML + dotted-path selectors. Env-var mapping: `PROMPT_REGISTRY_INDEX_CACHE_DIR` ↔ `index.cacheDir`. `--config` accepts `KEY=VALUE` (YAML-literal) and `PATH`. Identical merge rules.

### 5.3 GitHub CLI (`gh`) — subcommand taxonomy & extension model *(iter 5)*

- **Noun-verb taxonomy, 2 levels deep.** `gh pr create`, `gh repo clone`, `gh issue list`. Nouns = domain objects; verbs = actions. Depth > 2 is avoided (`gh pr review comment` is an exception, not the norm). We adopt the same rule: `prompt-registry <noun> <verb>`; a 3rd level is admissible only for `index` (which already has `harvest / search / stats / shortlist / export / eval-pattern / bench`).
- **Standalone not wrapping.** `gh` is a standalone tool built on its own domain API; it does not monkey-patch `git`. We apply the same rule: `prompt-registry` is not a thin wrapper around `npm run …` or the VS Code extension — it is a first-class CLI that the extension and scripts happen to share code with.
- **Extension model.** `gh` discovers third-party subcommands by looking for `gh-<name>` executables on `$PATH` (and under `~/.local/share/gh/extensions`). This unlocks user-authored subcommands without a plugin registry. We will adopt the same pattern for Phase 1's plugin story: a `prompt-registry-<name>` executable on `$PATH` becomes `prompt-registry <name>`.
- **Help UX.** `gh` groups commands into *core* / *GitHub actions* / *additional*, shows the most-used first, and carries a one-line tagline per subcommand. We mirror this grouping: *common*, *authoring*, *publishing*, *tooling*, plus a *plugins* group rendered last (per iter 7's kubectl-driven plugin-discovery decision). Final group list and assignment in §7.1.

### 5.4 Deno — config-driven tasks & workspaces *(iter 6)*

- **Single config file, auto-detected.** `deno.json` or `deno.jsonc` at project root (walked upward from `cwd`); JSON-with-comments accepted. Confirms that *one config file per project is enough*; we do not need multi-file layering inside a project. Cargo's upward walk already covers multi-project monorepos.
- **User-defined subcommands via config.** `deno task dev` runs the `"dev"` entry under `tasks` in `deno.json`. Interesting for us: config can declare *project-scoped subcommands* (`prompt-registry run <task>`), but we explicitly **reject** this for Phase 1 to avoid eroding the curated noun-verb taxonomy. Revisit in Phase 4 only if a concrete use case emerges.
- **Workspace mode.** `workspace: ["pkg-a", "pkg-b"]` in root config enables per-member overrides. For monorepos containing multiple hub repos, we allow a top-level `prompt-registry.config.yaml` to carry `workspace` → members, each with its own `prompt-registry.config.yaml`.
- **Permissions as explicit capabilities.** Deno's `--allow-read=PATHS`, `--allow-net=HOSTS` is not a verbatim adoption (we're not a runtime) but the *shape* informs Phase 5: `prompt-registry install` should expose `--allow-target=vscode,copilot-cli` (or equivalent) so users can gate which host the CLI is permitted to write to, and so CI can lock installs to a single target.

### 5.5 kubectl — plugin model, output flag family, list subcommand *(iter 7)*

- **Plugin discovery.** `kubectl-<plugin>` executable on `$PATH` becomes `kubectl <plugin>`. Dashes in the filename become command nesting: `kubectl-foo-bar` invokes as `kubectl foo bar`. This is the same rule as `gh`. We adopt both: `prompt-registry-<name>` on `$PATH`, and dashes map to nested subcommands.
- **First-class discovery subcommand.** `kubectl plugin list` enumerates valid plugins and flags shadowing/conflicts with built-ins (warnings for overrides). We adopt `prompt-registry plugins list` with the same warnings.
- **Unified output flag.** `-o / --output` with values `{json, yaml, wide, name, go-template, jsonpath}`. Single flag, discoverable, consistent across all `kubectl` subcommands. Strictly superior to the current mix of `--json`, `--format markdown|json`, etc. in our scripts. We adopt `--output` (aka `-o`) with values `{text, json, yaml, markdown, table, ndjson}`; `--json` becomes a deprecated alias for `--output json`.
- **Imperative vs declarative split.** `kubectl create` (imperative) vs `kubectl apply -f` (declarative from file). Phase 5 shape: `prompt-registry install <bundle>` is imperative; `prompt-registry install --lockfile prompt-registry.lock.json` is declarative. Same split, same verb; explicit in §7.

### 5.6 pnpm + rclone — workspaces & remote-backend abstraction *(iter 8)*

**pnpm** (Node monorepo manager):

- `pnpm-workspace.yaml` at workspace root declares `packages` (globs). Settings can live in the workspace YAML or in `.npmrc` files at any level; precedence is CLI > env > workspace YAML > `.npmrc` chain. This mirrors cargo's model in spirit — *multiple files at multiple levels, unified by deterministic precedence* — and validates our D3 decision.
- Newer pnpm versions are migrating settings from `package.json` into `pnpm-workspace.yaml` to keep dependency-manifest and tool-config concerns separate. Lesson: we should **never** embed `prompt-registry` config inside `package.json`; always a dedicated file.

**rclone** (remote-backend tool) — analogue for Phase 5's "install target" abstraction:

- Command shape: `rclone copy src:path dst:path`. `src` and `dst` reference *remotes* — typed, named, user-configured entries in a config file (`rclone config`). Remotes are tagged unions keyed by backend type (`drive`, `s3`, `sftp`, …) with per-type fields.
- Users add/remove remotes interactively or via flags; backend types are pluggable.
- Takeaway for us: **model install targets the same way.** A target is a typed entry in `prompt-registry.config.yaml#targets[]` keyed by host type: `vscode`, `vscode-insiders`, `copilot-cli`, `kiro`, `windsurf`, with per-type fields (scope paths, profile id, allowed kinds). Phase 5 will surface `prompt-registry target add` / `target list` / `target remove`, and `prompt-registry install --target <name>` selects the configured entry by name, not just by type.

## 6. Framework selection

*(Populated in iter 9–13. Each framework's deep-dive lists: community/maintenance, TS ergonomics, command model, config integration, help UX, plugin model, testability, bundle size, open risks. Final recommendation in iter 13.)*

### 6.1 oclif (Salesforce) — candidate #1 *(iter 9)*

- **Community & maintenance.** Used by Heroku CLI, Salesforce CLI, Shopify CLI. Actively maintained by Salesforce. High production exposure; breaking changes rare.
- **Command model.** Class-based command files, one command per file (`src/commands/foo/bar.ts` → `foo bar`). Decorator-less; static `flags` / `args` / `description` members. TypeScript-native — flag types inferred at call sites.
- **Config integration.** No built-in layered config system — we'd plug in our own YAML loader and feed values into flag defaults. Clean integration; oclif's `this.config` exposes platform-specific paths (XDG, AppData) that we can point our config discovery at.
- **Help UX.** Auto-generated, themeable, includes topic pages (`oclif-generated README.md` lists all commands). `--help` at any level shows the subtree. Meets our "empathy" requirement out of the box for usage; we layer `{code, hint, docsUrl}` on top via a shared error renderer.
- **Plugin model.** `@oclif/plugin-plugins` — users run `prompt-registry plugins install <npm-pkg>` to dynamically load a published plugin. Complements (does not replace) the `gh`/`kubectl` PATH-binary model. Design: we adopt *both* — PATH for ad-hoc extensions, npm-plugin for published ones.
- **Testability.** `@oclif/test` provides `runCommand(['foo:bar', '--flag'])` → `{stdout, stderr, exitCode}`. In-process; no subprocess. Directly satisfies §1.2 goal 6.
- **Bundle size.** Non-trivial (several MB with transitive deps). Concern only if we ever distribute a single-file bundled binary; not a concern for `npm install -g`.
- **Opinionated repo layout.** `src/commands/<noun>/<verb>.ts` is enforced by the auto-discovery convention. If we adopt oclif, Phase 2 physical layout of `lib/src/cli/` is pre-decided.
- **Open risks.** (a) opinionated layout forces a repo reshape; (b) bundle size if we ever want single-file distribution; (c) plugin system writes to user dirs at install time, needs opt-out for air-gapped CI.

### 6.2 clipanion (Yarn Berry) — candidate #2 *(iter 10)*

- **Community & maintenance.** Written and maintained by Maël Nison (Yarn lead). Used by Yarn Berry in production at large scale. Smaller community than oclif, but very high-quality code and TS-first.
- **Command model.** Class-based, no decorators required (`Option.String`, `Option.Boolean`, `Option.Array` helpers on class fields). FSM-based argv parser — deterministic and robust to unusual flag combinations (e.g. repeated `--config`).
- **Runtime dependencies.** Zero. Remarkable property for a framework; eliminates transitive-vuln risk.
- **TypeScript ergonomics.** Fully inferred types for flags; no codegen step. `validator: t.isNumber()` / `t.isOneOf(['a','b'])` at class fields gives runtime + type safety.
- **Config integration.** No built-in, same as oclif — we plug in the YAML loader. `Command.Paths` static member declares the invocation paths (`[['collection','validate']]`), which maps cleanly to our noun-verb taxonomy.
- **Help UX.** Built-in help, version, `--help` at every level. Less polished than oclif out of the box; customizable. No auto-`README` generator — we would add one or cross-pipe to a markdown renderer.
- **Plugin model.** No built-in plugin system. We'd build the PATH-binary discovery ourselves (small: ~50 LOC in the top-level dispatcher). We lose the "npm-published plugin" story unless we build it too — but given that `gh` and `kubectl` consider the PATH model sufficient, this is an acceptable trade.
- **Testability.** `cli.run(argv, {stdin, stdout, stderr})` returns the exit code and captures streams. In-process; same satisfaction as oclif's test helper.
- **Bundle size.** Small (~100 KB published). Single-file bundles are feasible.
- **Open risks.** (a) smaller community → slower answers on edge cases; (b) no `README` auto-gen; (c) plugin discovery is DIY.

### 6.3 citty (UnJS) — candidate #3 *(iter 11)*

- **Community & maintenance.** Part of the UnJS ecosystem (Anthony Fu / Pooya Parsa et al.). Modern; widely adopted in the Nuxt and Nitro space. Smaller and younger than oclif and clipanion, but very active.
- **Command model.** `defineCommand({ meta, args, run })` — declarative object literal. Sub-commands are nested via the `subCommands` field. No classes, no inheritance. Functional style.
- **Runtime dependencies.** A handful (`consola`, `defu`, `pathe`); small overall footprint, all maintained by the same group. Acceptable.
- **TypeScript ergonomics.** Strong inference from the `args` schema; no codegen.
- **Config integration.** No built-in layered config but UnJS publishes `c12` (companion config loader with file-discovery, layering, and `defu`-merging) which can plug in cleanly. `c12` is itself a strong candidate for the underlying YAML/TS config loader regardless of which CLI framework wins.
- **Help UX.** Built-in, simple. Less elaborate than oclif's themed help; serviceable.
- **Plugin model.** None built in. PATH-binary discovery is again ~50 LOC.
- **Testability.** `runMain(main, { rawArgs })` and `runCommand` testing patterns; in-process. Adequate.
- **Bundle size.** Small.
- **Open risks.** (a) youngest of the candidates; API has churned in early versions; (b) no scaffolding tooling; (c) ecosystem help-rendering is the least polished of the three.

### 6.4 commander + yargs — candidates #4–5 *(iter 12, head-to-head)*

These two are the historical defaults. Treated together because the conclusion is the same for both.

| Aspect | commander | yargs |
|---|---|---|
| Weekly downloads | ~500M | ~150M |
| TS support | community typings, JS-first | community typings, JS-first |
| Subcommand model | `program.command('deploy')` chain | `yargs.command('deploy', ...)` |
| Plugin model | none | none |
| Test harness | none built-in | none built-in |
| Bundle size | small (~30 KB raw, ~174 KB on-disk) | larger (~600 KB) |
| Config integration | manual | manual |
| Help UX | adequate, plain | adequate, plain |

**Verdict.** Both are solid for one-binary, flat-or-shallow CLIs. Both fall short for our context for the same three reasons:

1. **JS-first design.** TypeScript types come from `@types/*` packages and never reach the ergonomic level of clipanion's class-based `Option.*` or citty's `defineCommand` inference.
2. **No first-party test harness.** We would build our own subprocess wrapper or substitute streams manually.
3. **No structured-error contract.** Errors are raw strings; the `{code, message, hint, docsUrl}` shape we committed to in iter 4 has to be hand-rolled and consistently applied across every leaf subcommand — exactly what the framework should be doing for us.

Both are eliminated as primary candidates, kept on file as "drop-in fallbacks" if the chosen framework hits an unforeseen blocker during Phase 2 implementation.

### 6.5 Decision matrix and selection *(iter 13)*

#### 6.5.1 Criteria and weights

| # | Criterion | Weight | Why |
|---|---|---|---|
| C1 | TypeScript ergonomics | 10 | Whole codebase is strict TS; types must be inferred without codegen. |
| C2 | Testability (in-process harness) | 10 | Goal §1.2.6; single-process tests. |
| C3 | Maintenance health & community | 8 | Long-term viability; willingness to absorb breaking changes. |
| C4 | Plugin model | 6 | Per gh/kubectl; PATH model is sufficient if framework allows it. |
| C5 | Help UX (built-in quality) | 6 | clig.dev "ease of discovery" requirement. |
| C6 | Bundle size + dep weight | 6 | We are also a library; transitive deps end up in downstream. |
| C7 | Parser robustness (repeated flags, KEY=VALUE) | 6 | We have repeated-flag patterns today (`--config`, `--extra-source`). |
| C8 | Lock-in & repo-layout flexibility | 5 | Phase 2 will reshape the repo regardless; less rigidity is better. |
| C9 | Config integration | 4 | Layered YAML is plugged in by us either way. |

Total weight: **61**.

#### 6.5.2 Scoring (1–5 per criterion)

| Criterion | oclif | clipanion | citty | commander | yargs |
|---|---|---|---|---|---|
| C1 TS ergonomics (×10) | 4 | 5 | 4 | 3 | 3 |
| C2 Testability (×10) | 5 | 5 | 3 | 3 | 3 |
| C3 Maintenance (×8) | 5 | 4 | 4 | 5 | 4 |
| C4 Plugin model (×6) | 5 | 2 | 3 | 2 | 2 |
| C5 Help UX (×6) | 5 | 3 | 4 | 4 | 4 |
| C6 Bundle/deps (×6) | 2 | 5 | 5 | 4 | 3 |
| C7 Parser robustness (×6) | 4 | 5 | 4 | 3 | 4 |
| C8 Lock-in (×5) | 2 | 4 | 5 | 5 | 5 |
| C9 Config integration (×4) | 3 | 4 | 4 | 3 | 3 |
| **Weighted total** | **248** | **258** | **239** | **215** | **207** |

#### 6.5.3 Selection

**Primary: `clipanion` (score 258).** Reasoning:

- Best TS ergonomics + zero runtime deps + FSM parser align directly with our largest existing pain (sprint-3 relevance bug was parser-caused; we already have repeated-flag patterns that bit us).
- `Command.Paths = [['<noun>','<verb>']]` is the cleanest possible mapping of our committed taxonomy.
- The "no built-in plugin" gap is exactly the kind of thing we already decided to do in-house anyway (PATH-binary model from gh/kubectl). Net: not a real gap.
- `cli.run(argv, {stdin, stdout, stderr})` test harness satisfies §1.2 goal 6 immediately.

**Fallback: `oclif` (score 248).** If during Phase 2 we hit:

- A genuine need for npm-pluggable extensions (community feedback or roadmap item we haven't yet anticipated); or
- A blocker with clipanion's help-rendering pipeline that costs more than ~2 days to work around;

…then we switch to oclif. The fallback is "switch frameworks before Phase 3" — i.e. before the primitive-index integration hardens any framework-specific patterns. This is the latest viable rollback point.

**Eliminated.**

- `citty` (239) — strong but the youngest and least battle-tested. Notable: keep `c12` (UnJS's config loader) as a serious candidate for the YAML config layer regardless of CLI framework.
- `commander` (215) and `yargs` (207) — fail C1 (TS) and C2 (testability) hard; both shipped as "drop-in fallbacks" if the others both hit blockers.

#### 6.5.4 Implementation guardrails (Phase 2 inputs)

- All command files isolate clipanion-specific code behind a thin adapter `lib/src/cli/framework/`. Phase 2 deliverable.
- Shared abstractions: `Command` base class (extends clipanion's), `runCli(argv, ctx)` entrypoint, `Context` (the IO umbrella per §11.2.1), `RegistryError {code, message, hint, docsUrl, cause, context}` (extended in §10.1.1), `Output {format, write}`, `Logger {level, json}`.
- No leaf command imports clipanion directly. This guarantees the fallback to oclif (or the eventual framework swap) is a contained refactor.

#### 6.5.5 Locked

- **D2 in `decisions.md`** is now resolved: framework = `clipanion`, fallback = `oclif`, eliminated = `citty / commander / yargs`. Locked at iter 13.
- **C12 (UnJS config loader)** chosen as the underlying YAML config layer. Plugs into clipanion via the framework adapter. Also locked at iter 13.

## 7. Command taxonomy & naming

### 7.1 Top-level taxonomy *(iter 14)*

Two-level noun-verb structure (per iter 5). Third level admitted only for `index`. Built-in framework verbs (`help`, `version`) are top-level singletons.

```
prompt-registry
├─ collection
│  ├─ list           list collection files in a repo
│  ├─ validate       validate all collection YAML files
│  ├─ affected       detect collections affected by a diff range
│  └─ publish        publish collection bundles to a hub
├─ bundle
│  ├─ build          build a deployable bundle ZIP
│  ├─ manifest       render deployment-manifest.yml from a collection
│  └─ validate       validate a bundle (id/version/manifest)
├─ skill
│  ├─ new            scaffold a new skill folder
│  └─ validate       validate skill folders
├─ index
│  ├─ harvest        download + index a hub
│  ├─ search         keyword + facet search
│  ├─ stats          primitive count, byKind, bySource
│  ├─ shortlist
│  │   ├─ new
│  │   ├─ add
│  │   ├─ remove
│  │   └─ list
│  ├─ export         emit a hub-schema-valid profile YAML
│  ├─ eval-pattern   pattern-based relevance eval
│  └─ bench          search microbench
├─ hub
│  └─ analyze        analyze hub release download stats
├─ version
│  └─ compute        compute next semver for a collection
├─ install <bundle>  install a bundle into a target host
├─ target
│  ├─ add
│  ├─ list
│  └─ remove
├─ config
│  ├─ get
│  ├─ set
│  ├─ list
│  └─ validate
├─ plugins
│  └─ list
├─ help              show help for a command (built-in)
└─ version           print prompt-registry version (built-in alias for `--version`)
```

**Disambiguation note.** Two `version` entries appear above. The top-level `version` (parent of `compute`) is the *noun*: `prompt-registry version compute` computes a collection's next semver. The bottom `version` is clipanion's built-in: `prompt-registry version` (no further args) prints the CLI's own version, equivalent to `--version`. The framework dispatches deterministically on argv length: with one extra positional (`compute`) the noun-verb path matches; with none the built-in matches.

Groups in help output (per iter 5/7):

- **common** — `install`, `index search`, `index harvest`, `config list`
- **authoring** — `collection *`, `bundle *`, `skill *`
- **publishing** — `collection publish`, `version compute`, `hub analyze`
- **tooling** — `index *` (advanced), `target *`, `plugins list`, `config *`
- **plugins** — third-party PATH-binaries (rendered last, with `[plugin]` annotation)

### 7.2 Flag inheritance *(iter 14)*

Shared flags propagate at every level:

- `-c, --config FILE | KEY=VALUE` (repeatable; merge left-to-right)
- `-o, --output {text,json,yaml,markdown,table,ndjson}` (default: auto — `text` on TTY, `json` off-TTY; see §9.1)
- `--log-level {trace,debug,info,warn,error,silent}` (default: `info`)
- `--no-color`, `--color {auto,always,never}`
- `-v, --verbose` / `--quiet` (sugar over `--log-level`)
- `--dry-run` (only on commands that mutate state)
- `-h, --help`, `-V, --version` (built-in)
- `--profile <name>` (selects a config profile section)
- `--allow-target <list>` (only on `install`; comma-separated target names; refuses writes outside the set)
- `--exit-on-warning` (CI lever; warnings escalate to error exit codes; see §9.2.4)
- `--exit-on-deprecation` (CI lever; deprecation warnings exit `EX_TEMPFAIL=75`)
- `--no-plugins`, `--allow-plugins=<list>`, `--strict-plugins` (plugin loading levers; see §12.1.4)

Inheritance is implemented in the framework adapter (Phase 2 §6.5.4); leaf commands declare only command-specific flags.

### 7.3 Imperative vs declarative *(iter 14)*

For mutating commands we keep both shapes under the same verb (kubectl precedent):

- `prompt-registry install <bundle>` — imperative, single bundle, ad-hoc.
- `prompt-registry install --lockfile prompt-registry.lock.json` — declarative, drives from a manifest.
- `prompt-registry install --apply` — re-applies the project's full lockfile non-interactively.

Same pattern shape will guide future verbs (`uninstall`, `update`).

### 7.4 Naming conventions *(iter 15)*

#### 7.4.1 Flag style

- Long flags: kebab-case, lowercase (`--hub-repo`, `--cache-dir`).
- Short flags: single char, lowercase (`-q`, `-o`, `-v`). Reserve `-h/-V/-c/-o/-v` for the inherited set; subcommand-specific short flags must avoid these.
- Repeated flags: pass the flag multiple times (`--config a=b --config c=d`); never comma-joined values.
- KEY=VALUE flags: `--config key.path=value`; YAML-literal value parsing.
- Negation: prefer `--no-color` over `--color=false`.
- Boolean flags: presence = true; explicit `--flag=false` accepted only on flags that have a `--no-` form.

#### 7.4.2 Argument style

- Required positionals listed first, then flags. Optional positionals after `--`.
- Stdin via `-` as a positional argument value where applicable (e.g. `prompt-registry collection validate -`).
- Variadic positionals only at the trailing position, never in the middle.

#### 7.4.3 File and module layout

```
lib/
├─ src/
│  ├─ cli/
│  │  ├─ framework/             # adapter over clipanion
│  │  │  ├─ command.ts          # Command base class
│  │  │  ├─ run.ts              # runCli(argv, ctx)
│  │  │  ├─ output.ts           # --output dispatcher
│  │  │  ├─ errors.ts           # RegistryError + renderer
│  │  │  ├─ logger.ts
│  │  │  ├─ config.ts           # c12 wiring
│  │  │  └─ plugins.ts          # PATH-binary discovery
│  │  ├─ commands/
│  │  │  ├─ collection/<verb>.ts
│  │  │  ├─ bundle/<verb>.ts
│  │  │  ├─ skill/<verb>.ts
│  │  │  ├─ index/<verb>.ts
│  │  │  ├─ hub/<verb>.ts
│  │  │  ├─ version/<verb>.ts
│  │  │  ├─ install.ts
│  │  │  ├─ target/<verb>.ts
│  │  │  ├─ config/<verb>.ts
│  │  │  └─ plugins/<verb>.ts
│  │  └─ index.ts               # module barrel; not consumed by CLI entry
│  ├─ domain/                   # Phase 3 destination for bundle/primitive/hub
│  ├─ index/                    # Phase 3 destination for primitive-index-only code
│  └─ install/                  # Phase 5 destination for environment-agnostic install
└─ bin/
   └─ prompt-registry.js        # single entry; spawns runCli(process.argv)
```

The `lib/bin/<old-name>.js` shims survive for the deprecation window (§13). Each shim resolves to `runCli(['<noun>','<verb>', ...rest])`.

#### 7.4.4 Test layout

- One test file per leaf command, mirror layout: `lib/test/cli/commands/<noun>/<verb>.test.ts`.
- Framework-level tests in `lib/test/cli/framework/*.test.ts`.
- Golden-output tests under `lib/test/cli/golden/<noun>-<verb>/` with one fixture pair per scenario.

#### 7.4.5 Env-var prefix

- Always `PROMPT_REGISTRY_*` (upper-case).
- Mapping: config dotted path `foo.bar.baz` ↔ `PROMPT_REGISTRY_FOO_BAR_BAZ` (D3).
- Reserved sentinels: `PROMPT_REGISTRY_CONFIG`, `PROMPT_REGISTRY_OUTPUT`, `PROMPT_REGISTRY_LOG_LEVEL`, `PROMPT_REGISTRY_NO_COLOR`, `PROMPT_REGISTRY_PROFILE`. Inherited by PATH-binary plugins.

#### 7.4.6 Plugin binary naming

- `prompt-registry-<name>` on `$PATH` ⇒ invokable as `prompt-registry <name>` (gh/kubectl model).
- `prompt-registry-foo-bar` ⇒ `prompt-registry foo bar` (kubectl dash-nesting rule).
- Built-in subcommand names always shadow plugin names; shadowed plugins are listed with `[shadowed]` in `prompt-registry plugins list`.
- Future npm plugin packages (oclif-style; opt-in only): `@scope/prompt-registry-plugin-<name>`. Loading is opt-in via `cli.plugins.allowNpm: true` in config.

## 8. Configuration

### 8.1 Schema *(iter 17)*

One file per project (canonical name `prompt-registry.config.yaml`; `.yml` accepted). YAML 1.2. Schema-versioned. Profiled. Mirrors the §7.1 taxonomy.

```yaml
# prompt-registry.config.yaml
version: 1                              # required; "1" only in Phase 1
extends:                                # optional; merged BEFORE this file's content
  - ../shared/prompt-registry.config.yaml
profiles:
  default:                              # always present (implicit if omitted)
    # CLI-wide defaults (every subcommand inherits these unless overridden)
    output: text                        # text | json | yaml | markdown | table | ndjson
    logLevel: info                      # trace | debug | info | warn | error | silent
    color: auto                         # auto | always | never

    # ── Per-subcommand sections (mirror §7.1) ──
    collection:
      validate:
        strict: false
        allowDeprecated: true
      publish:
        dryRun: false
        confirmRelease: true
      affected:
        baseRef: main
    bundle:
      build:
        out: dist/
        includeSources: false
      manifest:
        outputPath: deployment-manifest.yml
      validate:
        strict: false
    skill:
      new:
        templateDir: templates/skill
      validate:
        strict: false
    index:
      cacheDir: ~/.cache/prompt-registry/index
      defaultHubRepo: org/hub
      bm25:
        k1: 1.5
        b: 0.75
      shortlist:
        defaultProfile: my-shortlist
      bench:
        iterations: 100
    hub:
      defaultRepo: org/hub
      auth:
        method: gh                      # gh | token | app
        token: ${PROMPT_REGISTRY_HUB_TOKEN}
      analyze:
        defaultSince: latest
    version:
      compute:
        baseRef: main
    install:
      defaultTarget: dev-vscode
      allowTargets: []                  # empty = unrestricted; non-empty = whitelist

    # ── Cross-cutting infrastructure ──
    plugins:
      allowNpm: false                   # opt-in npm-plugin loader
      pathDirs: []                      # extra dirs scanned for prompt-registry-* binaries
    targets:                            # rclone-style: named, typed, user-managed
      - name: dev-vscode
        type: vscode
        scope: user
        path: ${HOME}/.config/Code
        allowedKinds: [chatmode, prompt, instruction]
      - name: ci-copilot
        type: copilot-cli
        scope: user
        path: ${HOME}/.config/github-copilot
    workspace:
      members:                          # monorepo support
        - packages/hub-a
        - packages/hub-b

  ci:                                   # selected via --profile ci
    output: json
    color: never
    install:
      allowTargets: [production-vscode]
```

**Schema rules.**

- `version` is required and validated; an unknown version aborts with `RegistryError {code: "config.schemaVersion.unsupported"}`.
- `profiles.default` is implicit; if a config file omits the `profiles:` envelope entirely, its top-level keys are read as the `default` profile body.
- All paths support `${VAR}` env-interpolation (POSIX-style) and `~` home-expansion.
- Unknown keys at any level produce a *warning* (not an error) by default; `--strict` upgrades them to errors. Forward-compat: tolerate, surface.
- Per-subcommand sections may declare anything the subcommand binds with `Option.*`; binding rules in §8.3.
- `targets` is an ordered array, looked up by `name`. Duplicate names are an error.

JSON Schema for this YAML lives at `schemas/prompt-registry-config.schema.json` (Phase 2 deliverable).

### 8.2 Discovery and merge order *(iter 18)*

#### 8.2.1 File discovery (cargo upward walk + XDG fallback)

Algorithm (deterministic, pure):

```
inputs:  cwd, env(HOME, XDG_CONFIG_HOME, PROMPT_REGISTRY_CONFIG)
output:  ordered list `files` (low-to-high precedence)

1. files = []
2. if env.PROMPT_REGISTRY_CONFIG is set:
     files.push(env.PROMPT_REGISTRY_CONFIG)
     return                                # explicit override; skip discovery
3. user_cfg = ${XDG_CONFIG_HOME:-${HOME}/.config}/prompt-registry/config.yaml
   if exists(user_cfg): files.push(user_cfg)
4. ancestors = [cwd, parent(cwd), ..., root]
   for each dir in ancestors REVERSED (root first, cwd last):
     for each name in [prompt-registry.config.yaml, prompt-registry.config.yml]:
       if exists(dir/name): files.push(dir/name); break
5. return files
```

Result: lowest-precedence file is `~/.config/prompt-registry/config.yaml`; highest is the file closest to `cwd`. Cargo's rule, applied to YAML.

#### 8.2.2 `extends:` composition

When a file declares `extends: [path, ...]`, each extended path is loaded *first* (lower precedence than the file's own body) and merged in left-to-right order. Extends are resolved relative to the file declaring them. Recursion is flattened breadth-first; cycles abort with `RegistryError {code: "config.extends.cycle"}`.

Rationale: lets a monorepo or a team share a common config base, then override per-project. Same pattern as cargo's `include` and as `tsconfig.json`'s `extends`.

#### 8.2.3 Final precedence chain

From lowest to highest precedence:

```
1. built-in defaults (compiled into the CLI)
2. user config       (~/.config/prompt-registry/config.yaml)
3. project chain     (root ancestor → … → cwd; deepest wins)
4. extends:          (each `extends:` entry merged BEFORE its including file)
5. env vars          (PROMPT_REGISTRY_*)
6. --config FILE     (each occurrence merges over the previous)
7. --config KEY=VALUE (each occurrence sets one key; left-to-right)
8. CLI flags         (per-invocation)
```

**Merge semantics** (cargo-derived):

- Scalars: higher precedence overrides.
- Arrays: concatenate, with higher-precedence items appended.
- Objects: deep-merge.
- `null` at higher precedence explicitly clears the lower-precedence value.

**Why `--config FILE` is below `--config KEY=VALUE`**: a user passing both probably wants the inline `KEY=VALUE` to be the final word. Repeats of either form merge in argv order.

### 8.3 Config-to-flag binding *(iter 19)*

Every leaf subcommand declares its flags via clipanion's `Option.*` helpers. Each flag also carries a *config path* — a dotted-path selector into the resolved profile that is read if the flag is absent.

#### 8.3.1 Path mapping

- Inherited flags map to the profile root: `--output` ↔ `output`, `--log-level` ↔ `logLevel`, `--color` ↔ `color`.
- Per-subcommand flags map to `<noun>.<verb>.<flag-camelCased>`: `collection validate --strict` ↔ `collection.validate.strict`.
- Flag names are kebab-case in argv and camelCase in config (`--include-sources` ↔ `includeSources`).
- 3rd-level subcommands (`index shortlist add`) extend the path: `index.shortlist.add.<flag>`.

#### 8.3.2 Env-var mapping

Mechanical, single rule (D3): dotted-path UPPER-SNAKE-CASED with `PROMPT_REGISTRY_` prefix.

| Config path | Env var |
|---|---|
| `output` | `PROMPT_REGISTRY_OUTPUT` |
| `logLevel` | `PROMPT_REGISTRY_LOG_LEVEL` |
| `collection.validate.strict` | `PROMPT_REGISTRY_COLLECTION_VALIDATE_STRICT` |
| `index.bm25.k1` | `PROMPT_REGISTRY_INDEX_BM25_K1` |
| `targets[0].path` | *not supported* — env vars cannot index arrays; use `--config` |

camelCase keys are split on case boundaries: `logLevel` → `LOG_LEVEL`, `cacheDir` → `CACHE_DIR`. Acronyms are split conventionally (e.g. `bm25` stays `BM25`).

#### 8.3.3 Profile selection

`--profile <name>` (CLI) > `PROMPT_REGISTRY_PROFILE` (env) > `default`. Profile selection happens *before* config-to-flag binding; the chosen profile body becomes the layered-merge target. Unknown profile name aborts with `RegistryError {code: "config.profile.unknown", hint: "available profiles: <list>"}`.

#### 8.3.4 Resolution order recap (when a flag is read)

```
flag value (--strict)
  ↳ if absent, env (PROMPT_REGISTRY_COLLECTION_VALIDATE_STRICT)
    ↳ if absent, --config KEY=VALUE overrides matching the dotted path
      ↳ if absent, --config FILE merged values
        ↳ if absent, project chain (cwd → root)
          ↳ if absent, user config
            ↳ if absent, built-in default
              ↳ if absent, undefined (clipanion validator decides)
```

The framework adapter (Phase 2 §6.5.4) implements this once in `lib/src/cli/framework/config.ts`. Leaf commands declare a path and a default; the adapter reads the layered value before invoking `Option.*`'s parser.

#### 8.3.5 Test matrix for binding

Phase 2 must test every transition in the precedence chain. Minimum coverage:

| # | Scenario | Expected winner |
|---|---|---|
| T1 | Flag set, env set, file set | flag |
| T2 | Flag absent, env set, file set | env |
| T3 | Flag absent, env absent, two files (user + project) | project |
| T4 | `--config KEY=VALUE` and `--config FILE` and env | `KEY=VALUE` |
| T5 | Two `--config FILE` with overlapping keys | rightmost |
| T6 | `extends:` chain a→b→c with overlapping keys | c (the importing file) |
| T7 | `null` at higher precedence over scalar at lower | cleared |
| T8 | Unknown profile via `--profile` | error |
| T9 | Cycle in `extends:` | error |
| T10 | Array merge: defaults `[a,b]`, project `[c]` | `[a,b,c]` |

These tests are golden-output; expected JSON of the resolved config is checked in under `lib/test/cli/golden/config-resolve/`.

## 9. Output UX

### 9.1 Unified `--output` flag and stable contract *(iter 20)*

A single flag, six values, one rule per value:

| `--output` | Use case | Encoding | Streaming? |
|---|---|---|---|
| `text` *(default)* | Humans at terminals | Free-form, may include color and unicode symbols | No |
| `json` | Programs, jq pipelines | Single JSON document with the standard envelope | No |
| `yaml` | Programs, GitOps configs | Equivalent to `json` envelope, YAML-encoded | No |
| `markdown` | PR comments, docs | Subcommand-specific markdown | No |
| `table` | Terminal scanning | Aligned columns, ASCII or unicode-box per terminal width | No |
| `ndjson` | Stream pipelines (large outputs) | One JSON object per line, **no envelope** | Yes |

**Default selection.** The default is `text` for terminals and `json` when `stdout` is not a TTY (auto-detection). Users override with `--output <value>`.

**Deprecated alias.** `--json` remains a documented alias for `--output json` through Phase 4; iter 29 migration guide names this. Logs a deprecation warning at `debug` level.

#### 9.1.1 Stable JSON envelope

Every `--output json` (and `--output yaml`) document conforms to the following envelope:

```json
{
  "schemaVersion": 1,
  "command": "collection.validate",
  "status": "ok",
  "data": { ... },
  "warnings": [
    { "code": "...", "message": "...", "hint": "...", "docsUrl": "..." }
  ],
  "errors": [
    { "code": "...", "message": "...", "hint": "...", "docsUrl": "..." }
  ],
  "meta": {
    "durationMs": 123,
    "version": "1.0.0",
    "profile": "default"
  }
}
```

**Envelope rules.**

- `schemaVersion` is the envelope version, separate from individual `data` payload schemas. Bumped on breaking envelope changes.
- `command` uses dotted path (`collection.validate`, `index.shortlist.add`).
- `status` ∈ {`ok`, `warning`, `error`}.
- `data` is subcommand-specific. Each subcommand documents its `data` schema in the spec section that introduces the subcommand (Phase 4 deliverable; reference path `schemas/output/<noun>-<verb>.schema.json`).
- `warnings` and `errors` use the `RegistryError` shape from §6.5.4 and §10.
- `meta.durationMs`, `meta.version`, `meta.profile` are always present.

**Stability contract.**

- Adding new fields to `data` is non-breaking.
- Adding new envelope fields is non-breaking.
- Removing a field, renaming a field, or changing its type is breaking → bumps `schemaVersion`.
- Subcommand `data` schemas are versioned independently within the per-command schema files.

#### 9.1.2 NDJSON contract (streaming)

For large outputs (e.g. `index search` with thousands of hits, `collection validate` over hundreds of files), `--output ndjson` emits one JSON object per line on stdout. Each line is a complete `data`-shaped record; *no envelope*. A final summary record on a single line carries `{"_summary": true, status, warnings, errors, meta}` to allow consumers to detect end-of-stream.

This format is for pipe-to-jq scenarios where buffered JSON would force the consumer to wait for the full document.

#### 9.1.3 Color, symbols, and TTY detection

- `text` output may use ANSI color and unicode symbols (✓ ✗ →) by default.
- `--no-color` (env: `NO_COLOR=1`, env: `PROMPT_REGISTRY_NO_COLOR=1`) disables ANSI escapes globally.
- `--color {auto,always,never}` overrides the auto-detection.
- All non-`text` output formats are color-free regardless of flag value.
- Unicode symbols downgrade to ASCII (`[OK]`, `[X]`, `->`) when `LANG`/`LC_*` indicate non-UTF-8 encoding.

#### 9.1.4 Stderr separation

- *Logs* (level-tagged via `--log-level`) go to **stderr**.
- *Output* (the `--output` payload) goes to **stdout**.
- *Errors* in the `error` status path: structured representation goes to stdout (so consumers can capture it), human-friendly rendering also goes to stderr. Exit code reflects the error.

This separation means `prompt-registry foo --output json | jq` always works regardless of log level: logs never contaminate the JSON stream.

### 9.2 Exit codes *(iter 21)*

POSIX-leaning, sysexits.h-derived, with a domain-specific range above 100. Three tiers:

| Tier | Range | Use |
|---|---|---|
| Tier 1: POSIX | 0–2 | Standard success / generic / usage |
| Tier 2: sysexits.h | 64–78 | Categorized failure modes |
| Tier 3: domain | 100+ | prompt-registry-specific |

#### 9.2.1 Tier 1 (POSIX)

| Code | Name | When |
|---|---|---|
| 0 | `EX_OK` | Success. May still emit warnings; warnings alone are not failure. |
| 1 | `EX_GENERAL` | Last-resort generic error. **Avoid for new errors** — pick a more specific code. |
| 2 | `EX_USAGE_LEGACY` | Argument/parse failure surfaced *outside* clipanion (e.g. our framework adapter rejecting an `--allow-target` without a list). Clipanion's own usage errors map to Tier 2's `EX_USAGE`. |

#### 9.2.2 Tier 2 (sysexits.h)

| Code | Name | When |
|---|---|---|
| 64 | `EX_USAGE` | Incorrect flags/args (clipanion's default usage error). |
| 65 | `EX_DATAERR` | Input data is well-formed but semantically invalid (malformed YAML, schema violation). |
| 66 | `EX_NOINPUT` | A required file or repo is not found. |
| 69 | `EX_UNAVAILABLE` | A required service is unreachable (registry 5xx, hub down). |
| 70 | `EX_SOFTWARE` | Internal assertion failure / unhandled exception. Should never happen; if it does, it's a bug. |
| 73 | `EX_CANTCREAT` | Cannot create an output file/dir (path blocked, target rejected the write). |
| 74 | `EX_IOERR` | Read/write failure on the filesystem. |
| 75 | `EX_TEMPFAIL` | Transient failure; safe to retry. Also used for deprecation-as-failure mode (see below). |
| 76 | `EX_PROTOCOL` | Protocol-level network error (unparseable response, schema mismatch from the wire). |
| 77 | `EX_NOPERM` | Permission denied (filesystem ACL, missing scope on auth token). |
| 78 | `EX_CONFIG` | Configuration file invalid (loaded successfully but failed schema or semantic checks). |

#### 9.2.3 Tier 3 (domain-specific)

| Code | Name | When |
|---|---|---|
| 100 | `EX_BUNDLE_INVALID` | Bundle structure is invalid (missing manifest, id mismatch). |
| 101 | `EX_BUNDLE_DEPRECATED` | Bundle is deprecated and `--allow-deprecated` was not set. |
| 110 | `EX_INDEX_CORRUPT` | Index cache is corrupted or unreadable; user should rebuild. |
| 120 | `EX_TARGET_NOT_FOUND` | A `--target <name>` does not match any configured target. |
| 121 | `EX_TARGET_KIND_BLOCKED` | The target's `allowedKinds` rejected the install. |
| 122 | `EX_TARGET_WRITE_BLOCKED` | `--allow-target` whitelist excluded this target. |
| 130 | `EX_PLUGIN_SHADOWING` | A plugin would shadow a built-in subcommand and `--strict-plugins` is set. |
| 140 | `EX_AUTH_REQUIRED` | Operation needs authentication (no token, no `gh` session). |
| 141 | `EX_AUTH_FAILED` | Authentication was attempted and rejected. |

#### 9.2.4 Warnings, deprecations, and CI strictness

- Default: warnings are logged (stderr) but exit code is 0. Warnings appear in the JSON envelope's `warnings[]` array.
- `--exit-on-warning`: any warning escalates to its corresponding error exit code (typically 65 `EX_DATAERR`, or the domain-specific code if applicable). Useful in CI.
- Deprecation warnings (e.g. using `--json` instead of `--output json`): exit 0 by default. With `--exit-on-deprecation`, exit 75 (`EX_TEMPFAIL`) — distinct from "data error" because the operation succeeded but will stop succeeding in a future version.
- Exit codes are stable per (`code`, version) pair. Adding a new code is non-breaking; reusing or repurposing a code is breaking and bumps the envelope `schemaVersion`.

#### 9.2.5 Mapping back to error codes

Every `RegistryError {code}` (§10) maps to exactly one exit code via a single table maintained at `lib/src/cli/framework/exit-codes.ts`. The CLI's exit is `errors.length > 0 ? exitCodeFor(errors[0].code) : warnings.length > 0 && exitOnWarning ? exitCodeFor(warnings[0].code) : 0`. This is the only place exit codes are computed.

### 9.3 Progress, spinners, tables *(iter 22)*

#### 9.3.1 When to render progress

| Surface | TTY required? | Suppressed by | Triggered by |
|---|---|---|---|
| Spinner | Yes | `--quiet`, non-`text` output, `--log-level error/silent` | Any operation expected to take >500ms |
| Progress bar | Yes | Same | Any operation with a known total >2s |
| Step list | Yes | Same | Multi-stage operations (>3 stages) |

Progress UX is informational only; it must never block command completion. If a progress surface fails to render (terminal too narrow, non-TTY misdetected), the operation continues silently.

#### 9.3.2 NDJSON streaming with progress

When `--output ndjson`, progress records are emitted inline as `{"_progress": true, "stage": "...", "current": N, "total": M, "elapsedMs": …}`. Consumers filter with `! ._progress` to keep only data records.

#### 9.3.3 Tables

- Auto-width: detect `process.stdout.columns`; fall back to 80 if undefined.
- Per-cell truncation with `…` marker; values are truncated visually only — the underlying record in `--output {json,yaml,ndjson}` is always full-precision.
- `--no-truncate` shows full values; output may wrap or scroll horizontally.
- Header style: bold (color) or upper-case (no-color); separator: unicode `─` (fallback `-`).
- Sort: stable on the input order; `--sort <column>` allows explicit override; tie-break is input order.
- Empty result: a one-line message `(no results)` rather than an empty table — clig.dev "empathy" principle.

#### 9.3.4 Library choice

We do *not* import `clack`, `ora`, `cli-table3`, or similar. We build a minimal renderer (~200 LOC) under `lib/src/cli/framework/output/` covering only the surfaces we need: spinner, bar, step list, table. Reasoning:

- These libraries each carry their own theming and dep weight; together they would dominate our transitive footprint.
- We have specific format constraints (deterministic output for golden tests) that require us to control every escape sequence anyway.
- The total surface is small enough (~4 components × ~50 LOC each) that owning the code is cheaper than maintaining version compatibility against four upstream libraries.

This is a Phase 2 implementation deliverable, not a design decision that can shift.

## 10. Errors & troubleshooting

### 10.1 Error taxonomy *(iter 23)*

#### 10.1.1 `RegistryError` shape

```typescript
interface RegistryError {
  code: string;                          // dotted-path string; see 10.1.2
  message: string;                       // single sentence, human-readable
  hint?: string;                         // suggested action, single sentence
  docsUrl?: string;                      // permalink to docs
  cause?: RegistryError | Error;         // wrapped underlying error
  context?: Record<string, unknown>;     // structured context (file, line, target name)
}
```

This is the shape committed in §6.5.4 for the framework adapter. All errors raised from any leaf command go through this type.

#### 10.1.2 Code namespace

Codes are dotted strings, three to four segments deep, namespaced by domain. Each code has exactly one canonical message, one or more hints (selected by `context`), and an exit-code mapping (§9.2.5).

```
config.*       configuration loading and resolution
  schemaVersion.unsupported
  extends.cycle
  extends.fileNotFound
  profile.unknown
  target.duplicateName
  merge.invalidNullClear
  parse.yaml
  parse.envInterpolation

bundle.*       bundle artifact errors
  manifest.missing
  manifest.invalid
  id.malformed
  version.mismatch
  zip.corrupted
  signature.invalid

index.*        primitive index operations
  cache.corrupted
  cache.unwritable
  harvest.failed
  search.queryInvalid
  shortlist.notFound
  shortlist.duplicate

hub.*          hub repository operations
  repo.notFound
  release.notFound
  release.assetMissing
  rateLimit
  api.failed

target.*       install targets (rclone-style)
  notFound
  kindNotAllowed
  writeBlocked
  scope.invalid
  pathNotWritable

install.*      install operation
  lockfile.missing
  lockfile.invalid
  host.unavailable
  host.unsupported
  conflict

plugins.*      plugin discovery + invocation
  shadowing
  discovery.failed
  npm.disabled
  invocation.failed

auth.*         authentication
  required
  failed
  token.expired
  token.scopeMissing

network.*      network IO
  unreachable
  dnsFailed
  timeout
  statusCode
  tls.handshake

io.*           local IO
  read
  write
  permission

cli.*          CLI-level (argv, dispatch)
  flag.unknown
  flag.invalidValue
  command.unknown
  subcommand.required
  output.unsupported
```

#### 10.1.3 Severity

| Level | Meaning | Effect |
|---|---|---|
| `error` | Operation cannot complete | Halt; non-zero exit; written to `errors[]` |
| `warning` | Operation continues but with caveats | Continue; zero exit (unless `--exit-on-warning`); written to `warnings[]` |
| `info` | Diagnostic note | Not in envelope; logged at info level |

Promoting/demoting via flags: `--strict` and `--exit-on-warning` upgrade warnings to errors; nothing demotes errors.

#### 10.1.4 Rendering

**Text mode.**

```
error: bundle.id.malformed
  Bundle id "Foo Bar" contains invalid characters.
  hint: bundle ids must match [a-z][a-z0-9-]*; rename to "foo-bar".
  docs: https://prompt-registry.dev/errors/bundle-id-malformed
```

- The first line is `error: <code>` (red on color terminals, plain otherwise).
- The message is indented two spaces.
- `hint:` and `docs:` lines are indented and dim-styled.
- `cause` (if present) is rendered after a `caused by:` separator, recursively, indented one more level.
- `context` (if present) is rendered as a bulleted key:value list under `details:`.

**JSON mode.** As-is per §9.1.1 envelope; `cause` is recursively serialized.

#### 10.1.5 Stable contract

- Adding a new code is non-breaking.
- Changing a code's *exit code* mapping is breaking and bumps envelope `schemaVersion`.
- Changing a code's *human message* is non-breaking; consumers must key on `code`, never on `message`.
- `hint` and `docsUrl` are best-effort; absence is allowed.

### 10.2 Troubleshooting UX *(iter 24)*

#### 10.2.1 Did-you-mean

When clipanion's parser raises `cli.command.unknown` or `cli.subcommand.required`, the framework adapter computes Levenshtein distance from the user's input to every registered command path and includes the closest matches with distance ≤ 2 in the error's `hint`:

```
error: cli.command.unknown
  Unknown command "instal".
  hint: did you mean "install"?
```

For `cli.flag.unknown`, the same algorithm applies over the flags registered on the matched command. For `cli.flag.invalidValue` on enum-typed flags, the hint lists the valid values.

#### 10.2.2 `prompt-registry doctor`

A first-class triage subcommand. No required flags; runs a battery of diagnostic checks and emits a single envelope with `data` shaped as:

```yaml
data:
  node: { version, platform, arch }
  locale: { LANG, LC_ALL, encoding }
  config:
    files: [ list of resolved file paths in precedence order ]
    profile: <selected>
    resolved: <merged config tree, redacted for secrets>
  targets:
    - name: dev-vscode
      type: vscode
      reachable: true
      writable: true
  plugins:
    pathDirs: [ ... ]
    found: [ { name, path, shadowed: bool } ]
  network:
    defaultHubRepo: <url>
    reachable: true
    rttMs: 42
  warnings: [ ... ]
```

The output is a complete dump for bug reports. `--output text` renders it as a structured human-readable report with section headers; `--output json` is the canonical machine form. Secrets (any value matching `*_TOKEN`, `*_KEY`, or `auth.*.token`) are redacted to `***` automatically; `--unsafe` disables redaction (loud opt-in).

Phase 5 deliverable; spec'd here so Phase 1 design is complete.

#### 10.2.3 `--explain <code>`

```
$ prompt-registry --explain bundle.id.malformed
bundle.id.malformed (exit 100)

Description:
  The bundle's id field violates the naming rule. Bundle ids must match
  [a-z][a-z0-9-]* and must not contain spaces or upper-case letters.

Hints:
  - Rename the bundle in deployment-manifest.yml.
  - If you cannot rename, run `prompt-registry bundle build --normalize-id`
    to slugify the id automatically.

Docs: https://prompt-registry.dev/errors/bundle-id-malformed

See also:
  - bundle.manifest.invalid
  - bundle.version.mismatch
```

`--explain` is a top-level flag (a "meta-command") that short-circuits the normal command flow. It works without a subcommand: `prompt-registry --explain <code>` exits with 0 if the code exists, `cli.flag.invalidValue` (exit 64) otherwise.

#### 10.2.4 Help-after-error

For `cli.command.unknown` and `cli.subcommand.required`, the framework adapter appends a one-line `Run prompt-registry --help to see available commands.` to the rendered error in `text` mode. Suppressed in `json` mode (clutter).

#### 10.2.5 Common-error catalog

Phase 5 deliverable: a curated list of the ~20 most-frequently-hit errors with their canonical hints, lived in `docs/contributor-guide/cli-errors.md`. Each entry has the code, message, hint, root cause, and resolution steps. The `docsUrl` field points into this catalog when populated.

## 11. Testability strategy

### 11.1 Test tiers and harness *(iter 25)*

#### 11.1.1 Tier model

| Tier | Location | Scope | Tooling |
|---|---|---|---|
| Unit | `lib/test/unit/**/*.test.ts` | Pure functions; no IO | mocha + chai (existing) |
| Framework | `lib/test/cli/framework/*.test.ts` | Config resolver, output formatter, error renderer; mock streams | mocha + chai + memfs |
| Command | `lib/test/cli/commands/<noun>/<verb>.test.ts` | One file per leaf; in-process via `runCommand` | mocha + chai + clipanion's `cli.run` |
| Golden | `lib/test/cli/golden/<noun>-<verb>/` | Subcommand argv → expected envelope JSON | mocha + chai-jest-snapshot or equivalent |
| E2E | `lib/test/e2e/cli/*.test.ts` | Subprocess invocation; real PATH; real fs in temp dir | mocha + execa |

Lower tiers are fast; higher tiers are slow but realistic. Coverage targets: framework 90%, command 70% (high-value paths), e2e: cover only the install flow and a representative subcommand from each noun.

#### 11.1.2 In-process harness

The framework exports `runCommand(argv: string[], ctx?: Partial<Context>): Promise<RunResult>` where:

```typescript
interface Context {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  fs: FsAbstraction;            // injectable; defaults to node:fs
  net: NetAbstraction;          // injectable; defaults to undici
  env: Record<string, string>;
  clock: ClockAbstraction;      // injectable for deterministic durations
  cwd: string;
}

interface RunResult {
  exitCode: number;
  stdout: string;               // captured
  stderr: string;               // captured
  envelope?: OutputEnvelope;    // parsed if --output json/yaml
  data?: unknown;               // shortcut for envelope.data
  status?: "ok" | "warning" | "error";
}
```

Tests typically look like:

```typescript
const result = await runCommand(['collection', 'validate', '--strict'], {
  fs: memfs.create({ '/repo/collections/foo.collection.yaml': '...' }),
  cwd: '/repo',
});
expect(result.exitCode).to.equal(0);
expect(result.envelope?.warnings).to.have.length(0);
```

This satisfies §1.2 goal 6 ("testable-by-default"). The IO surface (stdin/stdout/stderr/fs/net/clock) is injectable from the framework adapter's `Context`; leaf commands receive it as a constructor argument.

#### 11.1.3 IO injection rules

- **No leaf command imports `node:fs`, `node:net`, `node:os`, `undici`, or `axios` directly.** They go through `ctx.fs`, `ctx.net`, etc.
- The framework adapter provides production implementations; tests substitute fakes.
- `process.env` is read only via `ctx.env` (constructed once, frozen for the run).
- `Date.now()` and `setTimeout` are read only via `ctx.clock`.
- `process.exit()` is forbidden in command code; only the framework adapter calls it, and only from the entrypoint.

These rules are linted by an ESLint rule (Phase 2 deliverable). Violations fail CI.

#### 11.1.4 Golden tests

Layout:

```
lib/test/cli/golden/<noun>-<verb>/<scenario-slug>/
  ├─ argv.txt                # one arg per line
  ├─ env.json                # PROMPT_REGISTRY_* env to set
  ├─ fs/                     # virtual filesystem for the test
  ├─ expected.stdout.json    # expected envelope (json output)
  └─ expected.stderr.txt     # expected stderr (text output)
```

The harness loads the scenario, runs the command in-process, captures stdout/stderr, and compares against expected files. Updating goldens is a single command (Phase 2 deliverable: `npm run goldens:update`). This makes regressions visible in PR diffs.

#### 11.1.5 E2E coverage

Small, expensive, real. Covers:

- `prompt-registry install` against a stub host directory (no real VS Code).
- One subcommand per noun, against real fs in a temp dir.
- Plugin discovery: a fake `prompt-registry-greet` binary on `$PATH`, asserted to surface in `plugins list`.
- `--output ndjson` streaming: assert that records arrive line-by-line before completion.

CI matrix: Node 20 + 22, Linux + macOS (Windows on best-effort).

### 11.2 IO injection patterns *(iter 26)*

#### 11.2.1 `Context` interface

```typescript
interface Context {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  fs: FsAbstraction;
  net: NetAbstraction;
  env: Readonly<Record<string, string | undefined>>;
  clock: ClockAbstraction;
  cwd: string;
}
```

The framework adapter (Phase 2) constructs production `Context` once at startup and passes it through clipanion's command instances via constructor injection. Tests substitute fakes per-tier (see §11.1).

#### 11.2.2 `FsAbstraction`

```typescript
interface FsAbstraction {
  readFile(path: string, encoding?: BufferEncoding): Promise<string | Buffer>;
  writeFile(path: string, data: string | Buffer): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<FsStat>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  realpath(path: string): Promise<string>;
}

interface FsStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  mtimeMs: number;
}
```

Production: `NodeFs` — thin wrapper over `node:fs/promises`. ~50 LOC.

Test: `MemFs` — wrapper over `memfs` (the existing library; we trust it). Tests construct it from a JS object literal mapping paths to file contents.

Boundary rule (per §11.1.3): no leaf command imports `node:fs` directly. The ESLint rule `no-direct-fs` enforces it.

#### 11.2.3 `NetAbstraction`

```typescript
interface NetAbstraction {
  fetch(url: string, init?: NetRequestInit): Promise<NetResponse>;
}

interface NetRequestInit {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD";
  headers?: Record<string, string>;
  body?: string | Buffer | Readable;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface NetResponse {
  status: number;
  headers: Record<string, string>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
  body: Readable;
}
```

Production: `UndiciNet` — wrapper over `undici`'s `fetch`. We pick `undici` over `axios` because it's Node-native, smaller, and supports streaming consistently. ~80 LOC.

Test: `MockNet` — wraps `undici`'s `MockAgent` (preferred over `nock` because it's the same lib as production and avoids global-state mutation). Tests register expectations per-URL with response bodies; assertions can verify request count and shape.

#### 11.2.4 `ClockAbstraction`

```typescript
interface ClockAbstraction {
  now(): number;                          // unix ms
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
```

Production: `RealClock` — `Date.now()` + `node:timers/promises.setTimeout`. ~10 LOC.

Test: `FakeClock` — settable `now()`, `advance(ms)` for deterministic time travel; `sleep()` resolves when the fake's clock crosses the threshold (or rejects if `signal` aborts). Hand-rolled, ~30 LOC.

#### 11.2.5 Env access

`ctx.env` is a `Readonly<Record<string, string | undefined>>` snapshot of `process.env` taken once at adapter construction. After that, command code can only read; mutations are impossible (frozen) and would throw under strict mode.

Tests substitute env directly: `runCommand(['…'], { env: { PROMPT_REGISTRY_OUTPUT: 'json' } })`. The substituted env *replaces* the real one (it doesn't merge), forcing tests to be explicit about every env they depend on.

#### 11.2.6 Plugin `Context` inheritance

PATH-binary plugins (§12.1) cannot share a TypeScript `Context` — they're separate processes, possibly written in different languages. The framework adapter constructs an *outgoing-Context envelope* on the plugin's stdin:

```json
{
  "schemaVersion": 1,
  "framework": "prompt-registry",
  "frameworkVersion": "1.x.x",
  "argv": ["…", "…"],
  "config": { /* resolved profile, secrets redacted */ },
  "profile": "default",
  "output": "json",
  "logLevel": "info",
  "color": "auto",
  "cwd": "/abs/path",
  "env": { "PROMPT_REGISTRY_*": "…" }
}
```

The plugin reads this from stdin, executes, and writes a §9.1.1-compliant envelope to stdout (and human errors to stderr). The framework adapter parses the plugin's stdout envelope and re-emits it through its own `--output` formatter so the user always sees the configured format regardless of what the plugin emitted.

In-process npm plugins (§12.2) receive the full TypeScript `Context` directly via the `activate(ctx)` entrypoint. No envelope serialization needed.

#### 11.2.7 Why these shapes, not Node's standard ones

`fs.promises`, `fetch`, and `Date.now` are perfectly good — but they're global and not injectable. The wrapping layer is small (~150 LOC total for production, ~150 LOC for fakes) and pays back on every command and every test. The alternative — letting commands import `node:fs` directly — has been tried and produces test suites that either spawn subprocesses (slow) or monkey-patch globals (flaky). We are not relitigating this trade.

## 12. Plugin / extension model

### 12.1 PATH-binary plugins *(iter 27)*

#### 12.1.1 Discovery algorithm

```
inputs:  $PATH, plugins.pathDirs (config), built-in command registry
output:  registry: Map<plugin-path, {name, file, shadowed: bool}>

1. dirs = (plugins.pathDirs ++ split($PATH)).deduplicated()
2. registry = new Map()
3. for each dir in dirs:
     for each entry in readdir(dir):
       if entry matches /^prompt-registry-(.+)$/ AND entry is executable:
         name-tokens = entry.replaceAll("prompt-registry-", "").split("-")
         path-key = name-tokens.join(" ")           # "foo bar" for prompt-registry-foo-bar
         file = dir/entry
         shadowed = built-in-registry.has(name-tokens[0])
         if not registry.has(path-key):              # first-found wins (PATH order)
           registry.set(path-key, {name: path-key, file, shadowed})
4. return registry
```

**Resolution**: when the user runs `prompt-registry foo bar baz`, the dispatcher matches against the registry by *longest prefix*: it tries `["foo","bar","baz"]`, then `["foo","bar"]`, then `["foo"]`. The first hit invokes that plugin with the remaining argv as its arguments.

**Built-in shadowing**: a plugin whose first token matches a built-in noun (`collection`, `bundle`, …) is marked `shadowed: true` and is *not* dispatchable. Built-ins always win. Shadowed plugins are listed by `prompt-registry plugins list` with a `[shadowed]` tag and a hint to rename or move them.

**PATH order**: first-found wins. The user can reorder `$PATH` or use `plugins.pathDirs` (which is searched *before* `$PATH`) to override.

#### 12.1.2 `prompt-registry plugins list` output

```
NAME              SOURCE                                    STATUS
greet             /usr/local/bin/prompt-registry-greet      active
foo bar           ~/.bin/prompt-registry-foo-bar            active
collection        /usr/local/bin/prompt-registry-collection [shadowed]
                  hint: rename or remove; built-in `collection` always wins.
```

`--output json` returns an array of `{name, source, status, version?, summary?}` objects. `version` and `summary` are best-effort: the framework calls `<plugin> --version` and parses the first line of `<plugin> --help` (with a 500ms timeout per call).

#### 12.1.3 Plugin invocation contract

When the dispatcher resolves to a plugin:

1. Build the outgoing-Context envelope (§11.2.6).
2. Spawn the plugin with `argv` = remaining argv after the plugin name. Pass the envelope on stdin.
3. Forward `process.stdout` of the plugin to *our* output formatter (rebuffer if needed for stable envelope re-emit). Forward `process.stderr` directly.
4. Wait for exit. The plugin's exit code is propagated as our exit code.
5. If the plugin's stdout is not a valid envelope (`--output json` requested, plugin emitted plain text), emit a warning `plugins.invocation.invalidEnvelope` and pass through the raw stdout.

Plugins are *trusted* — they execute arbitrary code under the user's UID. The opt-out is `--no-plugins` (skip discovery for this invocation) and the strict mode is `--strict-plugins` (any shadowing or invalid envelope is an error, not a warning).

#### 12.1.4 Levers and flags

| Flag | Effect |
|---|---|
| `--no-plugins` | Skip plugin discovery for this invocation; only built-ins available. |
| `--allow-plugins=<list>` | Comma-separated whitelist; only listed plugins are loaded. |
| `--strict-plugins` | Shadowing or invalid envelope from a plugin → exit 130 (`EX_PLUGIN_SHADOWING`). |

These are inherited (apply to every subcommand). Spec §7.2 should be updated to add these to the inherited flag list (deferred to iter 30 final pass).

### 12.2 npm-package plugins *(iter 28)*

#### 12.2.1 Opt-in switch

Off by default. Enable via `plugins.allowNpm: true` in config or `--allow-npm-plugins` flag (also writable as `PROMPT_REGISTRY_PLUGINS_ALLOW_NPM=true`). When enabled, the framework adapter scans `node_modules` for npm packages declaring `prompt-registry` plugin metadata and loads them in-process at startup.

Reasoning: npm plugins execute arbitrary JS *in our process*. PATH plugins are also arbitrary code but they're at least sandboxed by process boundary. Defaulting to *off* is the conservative choice; users who want npm plugins consciously opt-in once.

#### 12.2.2 Package shape

```json
{
  "name": "@scope/prompt-registry-plugin-mycompany",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "engines": { "node": ">=20" },
  "peerDependencies": {
    "@prompt-registry/collection-scripts": "^1.0.0"
  },
  "prompt-registry": {
    "schemaVersion": 1,
    "displayName": "MyCompany Plugin",
    "commands": [
      { "path": ["mycompany", "foo"], "description": "Run mycompany foo." },
      { "path": ["mycompany", "bar"], "description": "Run mycompany bar." }
    ]
  }
}
```

The `prompt-registry` field in `package.json` declares:

- `schemaVersion`: integer; framework-side version of the plugin contract.
- `displayName`: shown in `plugins list`.
- `commands[]`: declared command paths and descriptions. The framework registers these *before* loading the module, so `--help` works without forcing module evaluation.

#### 12.2.3 Module entrypoint

The module's `default export` is an `activate` function:

```typescript
import type { Context, CommandRegistrar } from "@prompt-registry/collection-scripts/cli";

export default async function activate(
  ctx: Context,
  register: CommandRegistrar,
): Promise<void> {
  register.command(MyFooCommand);
  register.command(MyBarCommand);
}
```

`CommandRegistrar` is a thin facade over clipanion's `cli.register()` that adds our framework's invariants (config-binding, output formatter, error renderer). Plugins extend the same `Command` base class (§7.4.3) as built-ins, so a plugin command and a built-in command are indistinguishable to the dispatcher.

#### 12.2.4 Discovery algorithm

```
inputs:  cwd, plugins.allowNpm, plugins.pathDirs (no effect on npm; PATH only)
output:  list<{package, paths[], commands[]}>

1. if not plugins.allowNpm: return []
2. roots = []; dir = cwd
3. while dir != root:
     if exists(dir/node_modules): roots.push(dir/node_modules)
     dir = parent(dir)
4. roots.push(${HOME}/.npm-global/lib/node_modules)        # `npm install -g`
5. plugins = []
6. for each root in roots:
     for each pkg matching `prompt-registry-plugin-*` or `@*/prompt-registry-plugin-*`:
       manifest = readJSON(pkg/package.json)
       if not manifest["prompt-registry"]: continue
       plugins.push({pkg, manifest})
7. deduplicate by package name; keep the cwd-closest
8. return plugins
```

Plugins are loaded after built-ins and after PATH plugins — last-in registration order, but built-in shadowing applies the same way.

#### 12.2.5 Security model

- **Off by default.** Users opt in once.
- **Pin in lockfile.** When `plugins.allowNpm: true`, the framework refuses to load npm plugins without a `package-lock.json` or equivalent in the same project. This prevents transparent supply-chain shifts.
- **Whitelist option.** `plugins.allowList: [@scope/foo, @scope/bar]` restricts loading to named packages even with `allowNpm: true`.
- **Doctor surface.** `prompt-registry doctor` enumerates loaded npm plugins under `data.plugins.npm[]`, including the resolved version of each, so audit trails are easy.

#### 12.2.6 Future: install/uninstall commands

Phase 5 deliverable, not Phase 1:

- `prompt-registry plugins install @scope/pkg` — runs `npm install --save-dev` in the project root, then verifies the package declares `prompt-registry` metadata.
- `prompt-registry plugins uninstall @scope/pkg` — inverse.
- `prompt-registry plugins update` — bulk update with the same constraints.

Spec'd here so the namespace is reserved; implementation deferred.

## 13. Migration plan

*(Detailed plan in `migration-plan.md`. Summary below.)*

### 13.1 Per-binary mapping *(iter 29)*

| Old binary | New subcommand | Shim location | Behavior |
|---|---|---|---|
| `validate-collections` | `prompt-registry collection validate` | `lib/bin/validate-collections.js` | Pass-through |
| `validate-skills` | `prompt-registry skill validate` | `lib/bin/validate-skills.js` | Pass-through |
| `build-collection-bundle` | `prompt-registry bundle build` | `lib/bin/build-collection-bundle.js` | Pass-through |
| `compute-collection-version` | `prompt-registry version compute` | `lib/bin/compute-collection-version.js` | Pass-through |
| `detect-affected-collections` | `prompt-registry collection affected` | `lib/bin/detect-affected-collections.js` | Pass-through |
| `generate-manifest` | `prompt-registry bundle manifest` | `lib/bin/generate-manifest.js` | Pass-through |
| `publish-collections` | `prompt-registry collection publish` | `lib/bin/publish-collections.js` | Pass-through |
| `list-collections` | `prompt-registry collection list` | `lib/bin/list-collections.js` | Pass-through |
| `create-skill` | `prompt-registry skill new` | `lib/bin/create-skill.js` | Pass-through |
| `hub-release-analyzer` | `prompt-registry hub analyze` | `lib/bin/hub-release-analyzer.js` | Pass-through |
| `primitive-index` | `prompt-registry index <verb>` | `lib/bin/primitive-index.js` | Argv-rewriting (subcommand → 2nd positional) |

### 13.2 Shim implementation pattern

Every shim is a 6-line file:

```js
#!/usr/bin/env node
// shim: validate-collections → prompt-registry collection validate
// Deprecated: will be removed in v<X+2> per §13.4.
const { runCli } = require("../dist/cli/run.js");
runCli(["collection", "validate", ...process.argv.slice(2)]);
```

The `primitive-index` shim is special — its old subcommand layer (`harvest`/`search`/…) is preserved by passing `process.argv.slice(2)` directly so `primitive-index search foo` ↔ `prompt-registry index search foo`.

### 13.3 Deprecation lifecycle

| Phase | Shim status | Warning level | Exit on deprecation |
|---|---|---|---|
| Phase 4 ship | Active | `debug` | 0 |
| Phase 4 + 1 minor | Active | `info` | 0 |
| Phase 5 ship | Active | `warn` | 0 (configurable) |
| Phase 5 + 1 minor | Active | `warn` | 75 (`EX_TEMPFAIL`) when non-TTY |
| Next major (v<X+2>) | Removed | n/a (binary 404) | 127 (command not found) |

The `--exit-on-deprecation` flag (§9.2.4) is documented in the migration guide as the lever CI maintainers use to catch deprecated calls *before* the removal milestone.

### 13.4 npm-package version policy

- Phase 1 sign-off (this work): docs PR; no version bump.
- Phase 2 ship (framework): minor bump (`0.X+1.0`).
- Phase 4 ship (shims active, all subcommands wired): minor bump.
- Phase 5 ship (deprecation warnings escalate to `warn`): minor bump.
- Shim removal: major bump (1.0 → 2.0). Migration guide is the README front-matter for that release.

### 13.5 Shim test strategy

For each shim:

- **Unit**: assert `runCli` is called with the expected argv (mock `runCli`).
- **Contract**: assert that *every* current shim consumer in the repo and downstream still works (CI grep over `lib/package.json#bin` references).

For a representative sample (3 shims chosen by usage frequency):

- **E2E**: subprocess-invoke the shim, assert exit code and stdout shape match the equivalent `prompt-registry` invocation.

This lets us prove "shim X is equivalent to subcommand Y" without testing every shim end-to-end (which would make CI prohibitively slow).

### 13.6 Migration guide (user-facing)

`docs/migration-guide.md` (to be authored alongside the Phase 4 ship) covers, for each binary:

- The new command.
- Flag-rename table (e.g. `--strict-mode` → `--strict`; deprecated long-flag aliases supported through Phase 5).
- A short shell snippet showing before/after for the most common usage.
- A pointer to `prompt-registry --explain <code>` for any new error codes the user might see during the transition.

The guide is referenced from the deprecation warning text:

```
DeprecationWarning: validate-collections is deprecated.
  Use: prompt-registry collection validate
  Migration guide: https://prompt-registry.dev/migration#validate-collections
```

## 14. Final consolidated summary *(iter 30)*

### 14.1 What we are building

A single Node ≥20 binary `prompt-registry`, built on **clipanion** (with **oclif** locked as fallback) and **c12** for layered YAML config. It replaces the eleven scattered `lib/bin/*.js` scripts with a coherent two-level noun-verb command tree:

- **Authoring**: `collection {list, validate, affected, publish}`, `bundle {build, manifest, validate}`, `skill {new, validate}`.
- **Tooling**: `index {harvest, search, stats, shortlist {new,add,remove,list}, export, eval-pattern, bench}`, `target {add, list, remove}`, `config {get, set, list, validate}`, `plugins {list}`.
- **Cross-cutting**: `install <bundle>` (imperative) / `install --lockfile` (declarative), `version compute`, `hub analyze`, `doctor` (Phase 5).
- **Built-ins**: `help`, `version`-as-builtin, `--explain <code>`.

### 14.2 Architectural invariants (locked)

1. **Domain layer separation.** `bundle`, `primitive`, `hub` types live in `lib/src/domain/`. Feature layers (indexing/search, validation, publishing, install, runtime translation) depend on domain — never the reverse.
2. **Framework isolation.** Leaf commands never import clipanion. Only `lib/src/cli/framework/` does. Fallback to oclif (or any future framework swap) is a contained refactor.
3. **`Context`-only IO.** Commands access stdin/stdout/stderr/fs/net/env/clock through `Context` — never through Node globals. ESLint enforces.
4. **Single source of truth tables.** Exit codes (`exit-codes.ts`), error namespace (`errors/codes.ts`), default config (`config/defaults.ts`), command registry (`commands/index.ts`).
5. **Stable JSON envelope.** Every machine-readable output conforms to §9.1.1's `{schemaVersion, command, status, data, warnings, errors, meta}` shape. Field additions are non-breaking; field removals or type changes bump `schemaVersion`.
6. **Profile-driven configuration.** All flags read from layered YAML config via dotted paths. Env vars mirror config paths mechanically. CLI flags always win.

### 14.3 Decisions locked in `decisions.md`

- **D1**: One binary replaces 11 scripts.
- **D2**: clipanion (primary), oclif (fallback). Locked iter 13.
- **D3**: Layered YAML config; cargo-style upward walk; XDG fallback; CLI > env > files. Extended iter 18 with the 8-step precedence chain.
- **D4**: Public API surface curated; no internal `primitive-index/hub/*` leakage.
- **D5**: Plugins are PATH-binaries by default; npm-plugins are opt-in.
- **D6**: Backward-compatibility shims exist for every old binary through one major version after Phase 5.
- **D7**: Node ≥20 baseline.

### 14.4 Phase boundaries

| Phase | Iter budget | Goal |
|---|---|---|
| 1 | 30 (this) | Design spec, sign-off this document |
| 2 | 10 | Framework adapter + `Context` + ESLint + golden-test runner (TDD) |
| 3 | 20 | Extract `bundle`/`primitive`/`hub` domain from `primitive-index` |
| 4 | 50 | Fold all 11 bin/* scripts into subcommands; shims active |
| 5 | 50 | Environment-agnostic install + targets + `doctor` |
| 6 | 30 + 30 | Primitive→runtime translation (research + TDD) |

### 14.5 Phase 1 deliverables (this checkpoint)

- `spec.md` — this file (§§0–14 populated).
- `iterations.md` — full per-iteration delta log (iter 1–30).
- `decisions.md` — locked architectural calls (D1–D7).
- `progress.txt` — durable cross-session notes.
- `migration-plan.md` — per-binary migration table and shim mechanics.

### 14.6 Phase 2 entry criteria

Phase 2 may begin once:

1. This spec is signed off (iter 30 complete).
2. The `lib/src/cli/framework/` directory layout is approved (§7.4.3).
3. The first concrete deliverable list is locked: framework adapter + `Context` interface + ESLint rule + minimum golden-test runner (per iter 25 reflection).

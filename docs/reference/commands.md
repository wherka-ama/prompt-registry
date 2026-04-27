# Command Reference

This document lists all VS Code commands provided by the Prompt Registry extension.

## Bundle Management

| Command | Title | Description |
|---------|-------|-------------|
| `promptRegistry.viewBundle` | View Bundle Details | View detailed information about a bundle |
| `promptRegistry.updateBundle` | Update Bundle | Update a specific bundle to the latest version |
| `promptRegistry.uninstallBundle` | Uninstall Bundle | Remove an installed bundle |
| `promptRegistry.checkBundleUpdates` | Check for Bundle Updates | Check if updates are available for a bundle |
| `promptRegistry.updateAllBundles` | Update All Bundles | Update all installed bundles to their latest versions |
| `promptRegistry.manualCheckForUpdates` | Check for Updates (Manual) | Manually trigger an update check |
| `promptRegistry.enableAutoUpdate` | Enable Auto-Update | Enable automatic updates for a bundle |
| `promptRegistry.disableAutoUpdate` | Disable Auto-Update | Disable automatic updates for a bundle |

## Primitive Index

Commands for the deterministic primitive-search feature. See
[`contributor-guide/spec-primitive-index.md`](../contributor-guide/spec-primitive-index.md)
for the full design and [`lib/PRIMITIVE_INDEX_DESIGN.md`](../../lib/PRIMITIVE_INDEX_DESIGN.md)
for the underlying engine.

| Command | Title | Description |
|---------|-------|-------------|
| `promptregistry.primitiveIndex.build` | Primitive Index: Build from installed bundles | Walks every installed bundle and builds a BM25-backed searchable index of its agentic primitives |
| `promptregistry.primitiveIndex.harvestHub` | Primitive Index: Harvest from hub… | Prompts for a GitHub hub (`owner/repo`), fetches hub-config.yml, and harvests primitives from every configured source. Also offers to inject `github/awesome-copilot` plugins/ as an extra `awesome-copilot-plugin` source. Uses conditional requests + blob cache for resumable, near-free warm runs |
| `promptregistry.primitiveIndex.search` | Primitive Index: Search | Opens a QuickPick to search prompts, instructions, chat modes, agents, skills and MCP servers |
| `promptregistry.primitiveIndex.shortlist.new` | Primitive Index: New shortlist | Creates a named shortlist to collect primitives across bundles |
| `promptregistry.primitiveIndex.shortlist.add` | Primitive Index: Add primitive to shortlist | Appends a primitive to an existing (or new) shortlist |
| `promptregistry.primitiveIndex.export` | Primitive Index: Export shortlist as profile | Emits a hub-schema-valid profile YAML (optionally with a suggested collection) from a shortlist |

The persistent index lives at `<globalStorage>/primitive-index.json`. The same
engine is available as a CLI via `npx --package @prompt-registry/collection-scripts primitive-index`.

### CLI subcommands

Run `primitive-index help` for the full flag reference. Highlights:

| Subcommand | Purpose |
|------------|---------|
| `hub-harvest` | Download + index every source in a hub. Supports `--extra-source` to inject additional sources (e.g. `github/awesome-copilot` plugins) without editing `hub-config.yml` |
| `hub-report` | Render a markdown report of the last harvest's progress log |
| `search` | Keyword + facet search. Short flags: `-q`, `-k`, `-s`, `-b`, `-t`, `-l`, `-o` |
| `stats` | Primitive count, byKind, bySource |
| `shortlist new / add / remove / list` | Curate a named set of primitive IDs |
| `export` | Emit a hub-schema-valid profile YAML (optionally with a collection) from a shortlist |
| `eval-pattern` | Pattern-based relevance eval against `lib/fixtures/golden-queries.json` (CI-ready: non-zero exit on fail) |
| `bench` | Run each golden query N times, report p50/p95/max + QPS |

Notes for `shortlist`:

- `primitive-index shortlist --help` (or `-h`, or `shortlist help`) prints shortlist-specific usage.
- `primitive-index shortlist` without a subcommand exits with code `2` and prints guidance (missing subcommand + shortlist usage).

### Default paths (no flag required)

```
cache dir     $PROMPT_REGISTRY_CACHE
              $XDG_CACHE_HOME/prompt-registry
              ~/.cache/prompt-registry            (POSIX fallback)
index file    <cache dir>/primitive-index.json
hub cache     <cache dir>/hubs/<owner>_<repo>/
progress      <hub cache>/progress.jsonl
```

## Scope Management

Commands for managing bundle installation scope. These are available via context menu on installed bundles in the Registry Explorer.

| Command | Title | Description |
|---------|-------|-------------|
| `promptRegistry.moveToRepositoryCommit` | Move to Repository (Commit) | Move a user-scoped bundle to repository scope, tracked in Git |
| `promptRegistry.moveToRepositoryLocalOnly` | Move to Repository (Local Only) | Move a user-scoped bundle to repository scope, excluded from Git |
| `promptRegistry.moveToUser` | Move to User | Move a repository-scoped bundle to user scope |
| `promptRegistry.switchToLocalOnly` | Switch to Local Only | Change a repository bundle from commit to local-only mode |
| `promptRegistry.switchToCommit` | Switch to Commit | Change a repository bundle from local-only to commit mode |
| `promptRegistry.cleanupStaleLockfileEntries` | Clean Up Stale Repository Bundles | Remove lockfile entries where files no longer exist |

### Move to Repository

Migrates a bundle from user scope to repository scope.

**Commands:**
- `promptRegistry.moveToRepositoryCommit` — Files tracked in version control
- `promptRegistry.moveToRepositoryLocalOnly` — Files excluded via `.git/info/exclude`

**Parameters:**
- `bundleId` — The ID of the bundle to move

**Requirements:** A workspace must be open.

### Move to User

Migrates a bundle from repository scope to user scope.

**Command:** `promptRegistry.moveToUser`

**Parameters:**
- `bundleId` — The ID of the bundle to move

The bundle becomes available across all workspaces after migration.

### Switch Commit Mode

Changes how a repository-scoped bundle interacts with Git.

**Commands:**
- `promptRegistry.switchToLocalOnly` — Exclude files from Git (adds to `.git/info/exclude`)
- `promptRegistry.switchToCommit` — Track files in Git (removes from `.git/info/exclude`)

**Parameters:**
- `bundleId` — The ID of the bundle

### Clean Up Stale Repository Bundles

Removes lockfile entries where the corresponding files no longer exist in the repository.

**Command:** `promptRegistry.cleanupStaleLockfileEntries`

This is useful when bundle files have been manually deleted but the lockfile still references them. The command:
1. Scans the lockfile for bundles with missing files
2. Shows a confirmation dialog with the count of stale entries
3. Removes confirmed stale entries from the lockfile

## Source Management

| Command | Title | Description |
|---------|-------|-------------|
| `promptRegistry.addSource` | Add Source | Add a new bundle source |
| `promptRegistry.editSource` | Edit Source | Modify an existing source configuration |
| `promptRegistry.removeSource` | Remove Source | Delete a source from the registry |
| `promptRegistry.syncSource` | Sync Source | Synchronize bundles from a specific source |
| `promptRegistry.syncAllSources` | Sync All Sources | Synchronize bundles from all configured sources |
| `promptRegistry.toggleSource` | Toggle Source Enabled/Disabled | Enable or disable a source |

## Profile Management

| Command | Title | Description |
|---------|-------|-------------|
| `promptRegistry.createProfile` | Create New Profile | Create a new bundle profile |
| `promptRegistry.editProfile` | Edit Profile | Modify an existing profile |
| `promptRegistry.activateProfile` | Activate Profile | Activate a profile to install its bundles |
| `promptRegistry.deactivateProfile` | Deactivate Profile | Deactivate a profile |
| `promptRegistry.deleteProfile` | Delete Profile | Remove a profile |
| `promptRegistry.exportProfile` | Export Profile | Export a profile to a file |
| `promptRegistry.importProfile` | Import Profile | Import a profile from a file |
| `promptRegistry.listProfiles` | List All Profiles | Display all available profiles |
| `promptRegistry.toggleProfileView` | Toggle Favorites View | Switch between profile views |
| `promptRegistry.toggleProfileFavorite` | Toggle Favorite | Mark or unmark a profile as favorite |

## Hub Management

| Command | Title | Description |
|---------|-------|-------------|
| `promptregistry.importHub` | Import Hub | Import a hub configuration |
| `promptregistry.listHubs` | List Hubs | Display all configured hubs |
| `promptregistry.syncHub` | Sync Hub | Synchronize with a hub |
| `promptregistry.deleteHub` | Delete Hub | Remove a hub configuration |
| `promptregistry.switchHub` | Switch Hub | Switch to a different hub |
| `promptregistry.exportHubConfig` | Export Hub Configuration | Export hub configuration to a file |
| `promptregistry.openHubRepository` | Open Hub Repository | Open the hub's repository in a browser |

## Hub Profile Management

| Command | Title | Description |
|---------|-------|-------------|
| `promptregistry.listHubProfiles` | List Hub Profiles | Display profiles from a hub |
| `promptregistry.browseHubProfiles` | Browse Hub Profiles | Browse available hub profiles |
| `promptregistry.viewHubProfile` | View Hub Profile | View details of a hub profile |
| `promptregistry.activateHubProfile` | Activate Hub Profile | Activate a hub profile |
| `promptregistry.deactivateHubProfile` | Deactivate Hub Profile | Deactivate a hub profile |
| `promptregistry.showActiveProfiles` | Show Active Hub Profiles | Display currently active hub profiles |
| `promptregistry.checkForUpdates` | Check Hub Profile for Updates | Check for updates to a hub profile |
| `promptregistry.viewProfileChanges` | View Hub Profile Changes | View changes in a hub profile |
| `promptregistry.syncProfileNow` | Sync Hub Profile Now | Immediately sync a hub profile |
| `promptregistry.reviewAndSyncProfile` | Review and Sync Hub Profile | Review changes before syncing |
| `promptregistry.viewSyncHistory` | View Hub Profile Sync History | View synchronization history |
| `promptregistry.rollbackProfile` | Rollback Hub Profile | Revert to a previous profile state |
| `promptregistry.clearSyncHistory` | Clear Hub Profile Sync History | Clear the sync history |

## Collection & Validation

| Command | Title | Description |
|---------|-------|-------------|
| `promptRegistry.createCollection` | Create New Collection | Create a new prompt collection |
| `promptRegistry.validateCollections` | Validate Collections | Validate collection YAML files including file references and duplicate detection |
| `promptRegistry.validateApm` | Validate APM Package | Validate an APM package |
| `promptRegistry.listCollections` | List All Collections | Display all collections |

## Scaffolding & Resources

| Command | Title | Description |
|---------|-------|-------------|
| `promptRegistry.scaffoldProject` | Scaffold Project | Create a new project from a template |
| `promptRegistry.addResource` | Add Resource | Add a prompt, instruction, agent, or skill |

## Settings & Configuration

| Command | Title | Description |
|---------|-------|-------------|
| `promptRegistry.exportSettings` | Export Settings | Export extension settings to a file |
| `promptRegistry.importSettings` | Import Settings | Import extension settings from a file |
| `promptRegistry.openSettings` | Open Settings | Open extension settings |

## Authentication & Access

| Command | Title | Description |
|---------|-------|-------------|
| `promptregistry.forceGitHubAuth` | Force GitHub Authentication | Force re-authentication with GitHub |

## Utilities

| Command | Title | Description |
|---------|-------|-------------|
| `promptregistry.openItemRepository` | Open Repository | Open an item's repository in a browser |
| `promptRegistry.resetFirstRun` | Reset First Run | Reset first-run state to re-trigger hub selection dialog |

## See Also

- [Settings Reference](./settings.md) — Extension configuration options
- [Getting Started](../user-guide/getting-started.md) — Installation and first steps

## prompt-registry CLI (Phase 4)

The unified `prompt-registry` binary replaces the eleven legacy
`lib/bin/*.js` scripts with a noun-verb taxonomy. Run `prompt-registry
--help` to discover commands; `--version` prints the package version.

### Output

`-o / --output <fmt>` selects the output format. Native commands accept
`text` (default), `json`, `yaml`, and `ndjson`. The legacy `--json`
boolean is a deprecated alias for `-o json` and prints a stderr
warning.

### Subcommands

| Command | Replaces | Native? |
|---|---|---|
| `prompt-registry collection list` | `list-collections.js` | yes |
| `prompt-registry collection validate` | `validate-collections.js` | yes |
| `prompt-registry collection affected` | `detect-affected-collections.js` | yes |
| `prompt-registry collection publish` | `publish-collections.js` | proxy |
| `prompt-registry bundle manifest` | `generate-manifest.js` | yes |
| `prompt-registry bundle build` | `build-collection-bundle.js` | yes |
| `prompt-registry skill new` | `create-skill.js` (non-interactive) | yes |
| `prompt-registry skill validate` | `validate-skills.js` | yes |
| `prompt-registry version compute` | `compute-collection-version.js` | yes |
| `prompt-registry hub analyze` | `hub-release-analyzer.js` | proxy |
| `prompt-registry index <verb>` | `primitive-index.js` | proxy |
| `prompt-registry doctor` | new (Phase 2) | yes |
| `prompt-registry explain <CODE>` | new (Phase 4 iter 19) | yes |
| `prompt-registry config get/list` | new (Phase 4 iter 22-23) | yes |
| `prompt-registry plugins list` | new (Phase 4 iter 24) | yes |
| `prompt-registry target list/add/remove` | new — Phase 5 stub | yes (stub) |
| `prompt-registry install <bundle>` | new — Phase 5 stub | yes (stub) |

**proxy** = the unified CLI dispatches to the legacy `lib/bin/<name>.js`
script. Native ports are scheduled for Phase 4 iters 36-50.

### Common flags

| Flag | Purpose |
|---|---|
| `-o / --output <text\|json\|yaml\|ndjson>` | Output format. |
| `--cwd <path>` | Override the working directory for filesystem operations. |
| `--verbose / -v` | Verbose mode (per-command meaning). |
| `--collection-file <path>` | Collection YAML path for collection/bundle/version commands. |
| `--changed-path <p>` | Repeatable path for `collection affected`. |
| `--version <semver>` | Bundle version for `bundle manifest` / `bundle build`. |
| `--out / --out-file <path>` | Output file for manifest commands. |
| `--out-dir <path>` | Output directory for `bundle build`. |
| `--repo-slug <slug>` | Repo slug for `bundle build`; falls back to `GITHUB_REPOSITORY`. |
| `--skill-name <name>` | Skill name for `skill new`. |
| `--description <text>` | Skill description for `skill new`. |
| `--skills-dir <path>` | Skills root for `skill new` / `skill validate`. |
| `--markdown <path>` | PR-comment-style markdown report for `collection validate`. |

### Error codes

`prompt-registry explain <CODE>` looks up structured error codes. The
current catalog covers `BUNDLE.*`, `FS.*`, `PRIMITIVE.*`, `USAGE.*`,
`INTERNAL.*`. Phase 5 will fill out `INDEX.*`, `HUB.*`, `CONFIG.*`,
`NETWORK.*`, `AUTH.*`, `PLUGIN.*` as commands surface them.

### Migration

See `docs/contributor-guide/cli-restructure/phase-4-migration-guide.md`
for full details on flag renames and the deprecation timeline.

## Phase 5: install + targets

### `prompt-registry target list / add / remove`

| Verb | Synopsis |
|---|---|
| `target list` | Show configured install targets (NAME / TYPE / SCOPE / PATH / ALLOWED-KINDS table). |
| `target add <name> --type <T> [--scope <S>] [--path <P>] [--allowed-kinds <a,b,c>]` | Persist a new target into the project config. |
| `target remove <name>` | Remove a target from the project config. |

Targets live in `targets[]` of `prompt-registry.yml` (cargo-style
upward walk; create on `target add` if not present). Five reserved
types: `vscode`, `vscode-insiders`, `copilot-cli`, `kiro`, `windsurf`.

### `prompt-registry install`

```
prompt-registry install <bundle-id> --target <name> --from <localDir>
prompt-registry install --lockfile <path> --target <name>
```

Flags:

| Flag | Purpose |
|---|---|
| `--target <name>` | Required. Resolved against `targets[]`. |
| `--from <dir>` | Skip resolve/download; install from a local bundle directory. |
| `--lockfile <path>` | Replay a `prompt-registry.lock.json`. |
| `--dry-run` | Validate + plan but write nothing. |
| `--allow-target a,b,c` | CI gate. Refuses targets outside the allowlist. |

A successful install:
- writes routed primitive files into the target's filesystem layout, and
- upserts an entry into `prompt-registry.lock.json` next to the project config.

### Error codes added in Phase 5

`prompt-registry explain <CODE>` documents these:

- `BUNDLE.MANIFEST_MISSING`
- `BUNDLE.MANIFEST_INVALID`
- `BUNDLE.ID_MISMATCH`
- `BUNDLE.VERSION_MISMATCH`
- `BUNDLE.EXTRACT_FAILED`
- `NETWORK.DOWNLOAD_FAILED`
- `CONFIG.SCHEMA_VERSION_UNSUPPORTED`
- `FS.WRITE_FAILED`

### Phase 5 spillover (interfaces stable; implementations TBD)

- Remote bundle resolution + download + zip extraction.
- Lockfile *replay body* (read + validate ships in iter 28).

## Phase 5 spillover: remote install + lockfile replay

### `prompt-registry install <bundle> --source <owner/repo>`

Imperative remote install. Resolves the bundle via the GitHub
release-asset API, downloads `bundle.zip`, extracts it in memory,
validates the manifest, writes routed primitives into the chosen
target, and upserts a lockfile entry that includes the bundle's
SHA-256, per-file checksums, and the source descriptor.

```bash
prompt-registry install foo --source owner/repo --target my-vscode
prompt-registry install owner/repo:foo@1.0.0 --target my-vscode
```

Auth: provide `GITHUB_TOKEN` or `GH_TOKEN` for private repos
(matches the `gh` CLI / Action-runner conventions).

### `prompt-registry install --lockfile <path> --target <name>`

Declarative replay. Reads every entry whose `target` matches the
`--target` flag and re-installs each one via the same pipeline as
the imperative path, using `lockfile.sources[entry.sourceId]` to
recover the upstream `owner/repo` (github sources) or absolute path
(local sources). SHA-256 integrity is enforced when the lockfile
recorded one (refuses to install bytes that drifted from the lockfile).

Output:

| Field | Meaning |
|---|---|
| `data.replayPlanned` | Number of entries seen for the target. |
| `data.replayed` | List of bundle ids successfully reinstalled. |
| `data.failures[]` | `{ bundleId, reason }` per entry that failed. |

Exit code: 0 on full success, 1 on any failure.

### Sixth target type: `claude-code`

Reserved Anthropic Claude Code target. Default base dir
`${HOME}/.claude`; routes:

| Bundle path | Target subpath |
|---|---|
| `prompts/` | `commands/` |
| `chatmodes/` | `modes/` |
| `agents/` | `agents/` |
| `instructions/` | `instructions/` |

```bash
prompt-registry target add my-claude --type claude-code
prompt-registry install foo --source owner/repo --target my-claude
```

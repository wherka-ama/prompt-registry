# CLI UX Improvement Proposals

_Document generated from friction analysis of the full e2e user flow (see `e2e-user-flow.sh` and the lifecycle tests in `e2e-cli-workflow.test.ts`)._

---

## Summary of Friction Points

A new user installing `prompt-registry` today faces a significant cliff before getting any value.
The table below lists the concrete pain points, their severity, and the proposed remedies.

| # | Friction Point | Impact | Proposed Fix |
|---|---------------|--------|--------------|
| F-01 | 6+ sequential manual commands before anything useful | Critical | `prompt-registry init` wizard |
| F-02 | `hub-config.yml` must be hand-written YAML | High | `hub create` interactive command |
| F-03 | No situational-awareness command | High | `prompt-registry status` dashboard |
| F-04 | `--index` required on every search/stats/shortlist | High | XDG default index path |
| F-05 | `hub add` + `hub use` + `hub sync` are three separate steps | Medium | Auto-use + sync on add |
| F-06 | Error messages don't guide recovery | High | Structured hints in every error |
| F-07 | `index search` is buried under `index` group | Medium | Top-level `search` alias |
| F-08 | Profile export → hub update is fully manual | Medium | `profile publish --hub <id>` |
| F-09 | No dry-run for destructive operations | Medium | `--dry-run` on install/activate/deactivate |
| F-10 | Target type is opaque — no discovery | Low | `target types` command |
| F-11 | No idempotent "apply current state" shortcut | Medium | `prompt-registry apply` |
| F-12 | No watch/CI mode | Low | `--watch` flag on apply |
| F-13 | Lockfile path not auto-detected for uninstall | Medium | Auto-locate project lockfile |

---

## Detailed Analysis and Proposals

### F-01 — Onboarding cliff: too many steps before first value

**Current journey (6 commands, manual file creation):**

```bash
target add my-target --type copilot-cli --path ~/.../prompts
# manually create hub-config.yml
hub add --type local --location ./my-hub
hub use my-hub
hub sync my-hub
profile activate backend --target my-target
```

**Proposed fix — `prompt-registry init`:**

An interactive wizard that detects the environment and prompts for the minimum necessary information:

```
$ prompt-registry init

? What IDE are you using?  › Copilot / Cursor / Kiro / Other
? Where should prompts be installed?  › ~/.../prompts  (auto-detected)
? Connect to a hub?  › (1) Amadeus Hub (default)  (2) Local directory  (3) Skip

✓ Target 'my-target' created  (type: copilot-cli)
✓ Hub 'amadeus' added and synced
✓ Ready. Run `prompt-registry profile list` to see available profiles.
```

One command. Zero YAML editing. The wizard writes `prompt-registry.yml` and registers the hub.

**Design principles:**
- All positional arguments are optional — fully non-interactive with `--yes` for CI.
- Re-running `init` on an existing project safely merges (no destructive changes).

---

### F-02 — Hub config requires hand-crafted YAML

Users who want a local hub must write a multi-level YAML document from scratch. There is no template, no schema hint, and no command to scaffold it.

**Proposed fix — `hub create`:**

```bash
prompt-registry hub create --name "My Hub" --out ./my-hub
```

Creates a well-commented `hub-config.yml` skeleton, optionally adding a local source pointing to a bundle directory:

```bash
prompt-registry hub create --name "My Hub" --add-source ./bundles/my-bundle --out ./my-hub
```

The generated file includes inline comments explaining every field (mirrors what `git init` does for `.gitconfig`).

---

### F-03 — No situational awareness ("where am I?")

After several commands, the user cannot quickly see what is configured, what is active, or what is installed.

**Proposed fix — `prompt-registry status`:**

```
$ prompt-registry status

Target      copilot-target   (copilot-cli)   ~/.../prompts
Hub         amadeus          (active)        synced 2h ago
Profile     backend          (active)        3 bundles · 12 files installed
Index       ~/.cache/prompt-registry/index.json   47 primitives

Run `prompt-registry profile list` to see available profiles.
```

JSON mode: `--output json` returns a structured snapshot for automation.

---

### F-04 — `--index` flag required on every search/stats/shortlist command

Every interaction with the primitive index requires passing the full path to the index file:

```bash
index search --query "code review" --index ~/.cache/prompt-registry/index.json
index stats --index ~/.cache/prompt-registry/index.json
index shortlist new --name foo --index ~/.cache/prompt-registry/index.json
```

The path is already resolved by XDG conventions (`$XDG_CACHE_HOME/prompt-registry/index.json`).

**Proposed fix — omit `--index` when using the default path:**

```bash
index search --query "code review"   # uses XDG default
index stats
index shortlist new --name foo
```

`--index` remains available for overriding (testing, multi-hub setups). This matches how `git` resolves `.git/` without requiring users to pass it each time.

---

### F-05 — `hub add` / `hub use` / `hub sync` are three separate steps

The typical journey is always: add → use → sync. Breaking these into three commands adds ceremony without flexibility (99% of the time users want all three).

**Proposed fix — `hub add` auto-uses and auto-syncs:**

```bash
hub add --type local --location ./my-hub   # adds + marks as active + syncs
```

Keep `--no-sync` and `--no-use` flags for power users who need explicit control.

Separately, provide a shorthand to sync-and-stay-current:

```bash
hub refresh   # synonym for: hub sync <active-hub>
```

---

### F-06 — Error messages don't guide recovery

Current output for a common mistake (running in a non-project directory):

```json
{"status":"error","errors":[{"code":"FS.NOT_FOUND","message":"File not found"}]}
```

This gives the user no actionable next step.

**Proposed fix — every error includes a `hint` field:**

```json
{
  "status": "error",
  "errors": [{
    "code": "FS.NOT_FOUND",
    "message": "prompt-registry.yml not found in current directory",
    "hint": "Run `prompt-registry target add <name>` to initialise a project here, or cd to an existing project."
  }]
}
```

Text mode renders the hint on a separate indented line, e.g.:

```
✗ FS.NOT_FOUND: prompt-registry.yml not found in current directory
  → Run `prompt-registry target add <name>` to initialise a project here.
```

Common hint cases to implement:
- `FS.NOT_FOUND` on `prompt-registry.yml` → suggest `target add`
- `INDEX.NOT_FOUND` → suggest `index build`
- `HUB.NOT_FOUND` → suggest `hub add` or `hub list`
- `PROFILE.NOT_FOUND` → suggest `profile list`

---

### F-07 — `index search` is buried under the `index` command group

The search workflow is the most frequent daily action, yet it requires:

```bash
prompt-registry index search --query "code review"
```

`index` is an implementation concept (the BM25 index), not a user-facing one.

**Proposed fix — top-level `search` alias:**

```bash
prompt-registry search "code review"
prompt-registry search "code review" --kinds prompt skill
```

The existing `index search` remains functional; `search` is a thin alias. Users discover the full `index` group via `--help` only when they need advanced operations.

---

### F-08 — Profile export → hub update is fully manual

After `index export` produces a `.profile.yml`, the user must:
1. Open `hub-config.yml` by hand
2. Paste the profile YAML
3. Run `hub sync`

This three-step manual process is error-prone.

**Proposed fix — `profile publish`:**

```bash
index export --shortlist my-list --profile-id custom-profile
profile publish custom-profile --hub local-test-hub   # injects into hub + syncs
```

Or as a single pipeline:

```bash
index export --shortlist my-list --profile-id custom-profile --publish --hub local-test-hub
```

---

### F-09 — No dry-run for destructive operations

`profile activate`, `profile deactivate`, `install`, and `uninstall` all modify the filesystem with no preview.

**Proposed fix — `--dry-run` flag:**

```bash
profile activate backend --target my-target --dry-run

Would install:
  prompts/hello.prompt.md → ~/.../prompts/hello.prompt.md
  skills/test-skill/SKILL.md → ~/.../skills/test-skill/SKILL.md

Run without --dry-run to apply.
```

---

### F-10 — Target types are not discoverable

New users cannot discover valid values for `--type` without reading documentation.

**Proposed fix — `target types` command:**

```bash
$ prompt-registry target types

  copilot-cli    GitHub Copilot CLI (user scope, ~/.config/...)
  copilot-ws     GitHub Copilot (workspace scope, .github/...)
  cursor         Cursor IDE
  kiro           Kiro IDE

Use: target add <name> --type <type> --path <path>
```

Also, `target add` without `--type` could auto-detect based on installed tools (check for `.cursor/`, `.kiro/`, GitHub CLI config, etc.) and prompt the user to confirm.

---

### F-11 — No idempotent "apply current state" command

In CI or after cloning a repository with a `prompt-registry.yml`, there is no single command to "make the system match the config file":

```bash
# What users have to do today:
hub sync my-hub
profile activate backend --target my-target
```

**Proposed fix — `prompt-registry apply`:**

```bash
prompt-registry apply
```

Reads `prompt-registry.yml` + `prompt-registry.lock.json`, syncs the hub if stale (>1h by default or `--force`), and activates the profile recorded in the lockfile. Idempotent: re-running has no side effects if already up to date.

This enables a clean CI pattern:

```yaml
# .github/workflows/dev-setup.yml
- run: prompt-registry apply
```

---

### F-12 — No watch mode for active development

Bundle authors iterating on prompts locally have no feedback loop — they must manually re-run `install` or `profile activate` after each change.

**Proposed fix — `--watch` flag on `apply`:**

```bash
prompt-registry apply --watch
```

Watches bundle source directories for changes and re-installs affected files immediately. Out of scope for v1 but important for author ergonomics.

---

### F-13 — Lockfile path must be passed explicitly to `uninstall`

```bash
uninstall --lockfile ./path/to/lockfile.json --target my-target
```

The project lockfile (`prompt-registry.lock.json`) is always in the project root (same dir as `prompt-registry.yml`). Requiring the user to pass its path is unnecessary ceremony.

**Proposed fix — auto-locate project lockfile:**

```bash
uninstall --target my-target   # auto-resolves ./prompt-registry.lock.json
```

`--lockfile` remains available for pointing to a different file (e.g., exported lockfiles from CI).

---

## Suggested Implementation Priority

| Priority | Items |
|----------|-------|
| **P0** (onboarding) | F-01 (`init`), F-06 (hints in errors) |
| **P1** (daily use) | F-03 (`status`), F-04 (default index path), F-07 (`search` alias), F-11 (`apply`) |
| **P2** (power users) | F-02 (`hub create`), F-05 (auto-sync on add), F-09 (`--dry-run`), F-13 (lockfile auto-locate) |
| **P3** (author tools) | F-08 (`profile publish`), F-10 (`target types`), F-12 (`--watch`) |

The P0/P1 changes are mostly additive (new commands, new defaults) and carry zero breaking-change risk. They can be shipped independently.

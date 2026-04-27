# Installing bundles with `prompt-registry install`

`prompt-registry install` is the unified command for placing prompt
bundles into a host's filesystem layout (VS Code, Copilot CLI, Kiro,
Windsurf). The command grew out of the VS Code extension's
`installBundle` flow and is built on the same primitives, but is now
host-agnostic.

## TL;DR

```bash
# 1. Tell prompt-registry where to write things.
prompt-registry target add my-vscode --type vscode

# 2. Build a bundle (or use one published elsewhere).
prompt-registry bundle build --collection-file collections/my.yml --version 1.0.0 --out-dir build/

# 3. Install.
prompt-registry install my-bundle-id --target my-vscode --from build/my-bundle-id/

# 4. Verify.
prompt-registry doctor
```

## Targets

A **target** is a typed entry in your project's `prompt-registry.yml`
under `targets:`. Each entry pairs a `name` (your label) with a `type`
(one of `vscode`, `vscode-insiders`, `copilot-cli`, `kiro`,
`windsurf`, `claude-code`).

```yaml
targets:
  - name: my-vscode
    type: vscode
    scope: user
    path: ${HOME}/.config/Code/User
    allowedKinds: [prompt, instruction]   # optional
```

| Field | Meaning |
|---|---|
| `name` | Free-form label used by `--target <name>`. |
| `type` | Discriminant: `vscode`, `vscode-insiders`, `copilot-cli`, `kiro`, `windsurf`. |
| `scope` | `user` or `workspace`. `copilot-cli` is user-only. |
| `path` | Override the platform-default base directory. Supports `${HOME}` and leading `~`. |
| `allowedKinds` | Restrict which primitive kinds this target accepts. Others are skipped. |

### Adding a target

```bash
prompt-registry target add my-vscode --type vscode
prompt-registry target add ci-vscode --type vscode --path /opt/codespaces/User --allowed-kinds prompts
prompt-registry target add my-windsurf --type windsurf --scope user
```

### Listing / removing

```bash
prompt-registry target list
prompt-registry target remove my-vscode
```

## Install modes

### Imperative (per-bundle)

```bash
prompt-registry install <bundle-id> --target <name> --from <bundle-dir>
```

`--from` points at a directory containing `deployment-manifest.yml`
and the primitive subdirs (`prompts/`, `chatmodes/`, etc.). Every
file under those subdirs is routed into the target's filesystem
layout. The manifest itself is *not* written into the target.

### Declarative (lockfile)

```bash
prompt-registry install --lockfile prompt-registry.lock.json --target <name>
```

The lockfile (`prompt-registry.lock.json`) is written automatically
by every successful imperative install. Each entry records target,
bundle id, version, install timestamp, and file list. Replay reads
the lockfile and re-installs every entry.

> **Phase 5 status**: lockfile read + validation lands in iter 28.
> Full replay body lands in Phase 5 spillover; today's iter prints the
> plan and points users at imperative `install --from <dir>` for each
> entry.

## Useful flags

| Flag | Purpose |
|---|---|
| `--target <name>` | Required. Looked up against `targets[]` in the project config. |
| `--from <dir>` | Skip resolve/download; use a local bundle directory. |
| `--lockfile <path>` | Replay a lockfile (declarative mode). |
| `--dry-run` | Validate + plan but write nothing. |
| `--allow-target a,b,c` | CI gate: refuse `--target` outside the comma-separated set. |
| `-o / --output <fmt>` | `text` (default), `json`, `yaml`, `ndjson`. |
| `--cwd <dir>` | Override working directory. |

## Per-target file layout

| Target type | Default base dir | Kind routes |
|---|---|---|
| `vscode` | `${HOME}/.config/Code/User` | `prompts/` `chatmodes/` `instructions/` |
| `vscode-insiders` | `${HOME}/.config/Code - Insiders/User` | (same) |
| `copilot-cli` | `${HOME}/.config/github-copilot` | `prompts/` only |
| `kiro` | `${HOME}/.kiro` | `prompts/` `agents/` `chatmodes/` `instructions/` |
| `windsurf` | `${HOME}/.codeium/windsurf` | `prompts/`+`instructions/` → `rules/`; `agents/` → `workflows/` |
| `claude-code` | `${HOME}/.claude` | `prompts/` → `commands/`; `chatmodes/` → `modes/`; `agents/`+`instructions/` keep their names |

Each target type's defaults can be overridden with `target.path` for
scenarios like a portable install or a non-standard host User dir.

## Diagnosing failures

When install fails, the command exits non-zero and (in JSON mode)
emits a structured `errors[]` entry with a `code`. Look up the
remediation with `prompt-registry explain <CODE>`:

```bash
prompt-registry explain BUNDLE.MANIFEST_MISSING
prompt-registry explain FS.WRITE_FAILED
```

`prompt-registry doctor` reports the project config + targets state:

```bash
prompt-registry doctor
#   [ OK ] node-version: ...
#   [ OK ] cwd-accessible: ...
#   [ OK ] project-config: ./prompt-registry.yml
#   [ OK ] install-targets: 2 targets: my-vscode(vscode), my-windsurf(windsurf)
```

## What's not yet implemented

Phase 5 ships the install pipeline + local-directory installs +
target persistence + lockfile read/write. The following are
**Phase 5 spillover** deliverables (interfaces are stable;
implementations land in a follow-up):

- **Remote bundle resolution** (`install <bundle>` without `--from`)
- **Remote bundle download** + zip extraction
- **Lockfile replay body** (read+validate ships today)

For today, build bundles locally with `prompt-registry bundle build`
and install with `--from`.

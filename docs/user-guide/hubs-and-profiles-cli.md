# Hubs, Sources, and Profiles

> **Status:** Phase 6 (lib parity with the VS Code extension's
> Hub/Source/Profile model). Target-agnostic, atomic profile
> activation. Profiles complement project lockfiles.

## Mental model

```
   Hub          a curated catalog (sources + profiles), one per remote
   Source       a place bundles come from (github repo, local dir)
   Bundle       an installable unit (id + version) inside a source
   Profile      a User-level grouping of bundles. Activation installs
                them atomically across every configured target.
```

The user-level state lives at `${XDG_CONFIG_HOME:-$HOME/.config}/prompt-registry/`.
The project state lives in `prompt-registry.yml` (targets) and
`prompt-registry.lock.json` (entries + the optional `useProfile` link).

## Hub commands

```bash
# Import a hub from a github repo (looks for hub-config.yml at root).
prompt-registry hub add --type github --location owner/repo --ref main

# Or from a local directory containing hub-config.yml:
prompt-registry hub add --type local --location ~/my-hub

# List imported hubs (current hub marked with *):
prompt-registry hub list

# Switch the active hub:
prompt-registry hub use my-hub

# Refresh from the remote:
prompt-registry hub sync [my-hub]

# Remove (also clears active pointer if it was active):
prompt-registry hub remove my-hub
```

## Source commands (detached mode)

When you don't want to import a curated hub, you can still register
individual sources. They land in a synthetic `default-local` hub
that the CLI auto-creates and manages on your behalf.

```bash
prompt-registry source add --type github --url owner/repo
prompt-registry source list           # all sources, all hubs
prompt-registry source remove <sourceId>
```

`source list` shows the `[hubId]` next to every entry so you can
see at a glance which sources came from a curated hub vs from
detached `source add`.

## Profile commands

A **Profile** says "if I'm playing role X, install these bundles".
Activation is **atomic** (all or nothing) and **target-agnostic**
(installs into every project target by default).

```bash
prompt-registry profile list [--hub <id>]
prompt-registry profile show <profileId> [--hub <id>]
prompt-registry profile activate <profileId> [--hub <id>] [--target <names>]
prompt-registry profile deactivate
prompt-registry profile current
```

### Atomic activation guarantees (D22)

When you run `profile activate <id>`:

1. Resolve every bundle in the profile up-front. **Any failure
   aborts before any IO write.**
2. Download and validate every bundle in memory. **Any failure
   aborts before any disk write.**
3. Write across every project target in turn. On any per-write
   failure, **the engine rolls back every previously-written file
   for this activation** and throws `PROFILE.ACTIVATION_FAILED`.

Either the whole profile lives on disk, or none of it does.

### Single active profile globally (D21)

Activating profile B while profile A is active is a one-shot
`deactivate(A) → activate(B)` transition. There is at most **one
active profile per user**, across all hubs. The activation state
lives at:

```
${XDG_CONFIG_HOME}/prompt-registry/profile-activations/<hubId>_<profileId>.json
```

### Project↔profile link (D24)

`profile activate` writes a `useProfile: { hubId, profileId }` block
into `prompt-registry.lock.json` so a fresh checkout (or CI replay
via `install --lockfile`) can re-activate the same profile. This is
**complementary** to the lockfile's `entries[]`:

* `entries[]` records *every* bundle that's currently installed
  (regardless of who installed it).
* `useProfile` records the **intent** — "this project is supposed
  to be running profile X".

`profile deactivate` clears the link.

## Common flows

### "Wear a different hat for the day"

```bash
prompt-registry profile activate backend-developer
# ... work for a while ...
prompt-registry profile activate technical-writer
# Bundles for backend-developer are atomically uninstalled,
# bundles for technical-writer are atomically installed,
# all in one transition.
```

### Onboard a new project

```bash
git clone <project>
cd <project>
prompt-registry install --lockfile prompt-registry.lock.json --target my-vscode
# If the lockfile carried a useProfile, the profile is also re-activated.
```

### Run fully detached (no curated hub)

```bash
prompt-registry source add --type github --url owner/repo
# `default-local` hub is auto-created behind the scenes; you never
# have to think about it. `profile list` and `profile activate`
# work the same way against the default-local hub.
```

## What stays in user-scope vs project-scope

| Concept | Scope | Where |
|---|---|---|
| Hubs | User | `${XDG_CONFIG_HOME}/prompt-registry/hubs/` |
| Active hub pointer | User | `${XDG_CONFIG_HOME}/prompt-registry/active-hub.json` |
| Profile activation state | User | `${XDG_CONFIG_HOME}/prompt-registry/profile-activations/` |
| Targets | Project | `prompt-registry.yml` |
| Installed-bundle log | Project | `prompt-registry.lock.json` (`entries[]`) |
| Profile linkage | Project | `prompt-registry.lock.json` (`useProfile?`) |

The two layers are designed to be **complementary, not redundant**:
profiles travel across projects, lockfiles pin a specific project's
bundle bytes. Both work independently and together.

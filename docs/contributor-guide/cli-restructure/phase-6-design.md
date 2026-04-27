# Phase 6 — Hubs, Sources, Profiles (lib parity)

> **Charter (user, session start):** Hub / Source / Bundle is the
> remote registry **configuration layout**. **Profiles** are the
> User-level orthogonal grouping that drives atomic (un)install,
> reflecting role / assignment-type / domain. Profiles are
> **non-negotiable** and **target-agnostic**. Profiles co-exist with
> the project lockfile — they are **complementary, not redundant**.
>
> Detached mode (no explicit hub) is permitted but is an edge case:
> behind the scenes, sources land in a synthetic **default local
> hub**. APM adapter is **lower priority** for this phase.

## Why this phase exists

Phase 5 spillover gave the CLI a **project-level** install pipeline
(`install <bundle> --from`/`--source`/`--lockfile`) and an extension-
parity lockfile shape. What's still missing:

1. **Hub** as a first-class config primitive in the lib — today the
   lockfile has an empty `hubs?` field but no impl reads or writes
   hubs. Without hubs, the user has no way to bootstrap a coherent
   set of sources from a single curated reference.
2. **Profile** as a first-class user-level concept in the lib — today
   the lockfile has an empty `profiles?` field. Without profiles,
   the user cannot say "I'm wearing the X hat today; install
   everything that hat needs".
3. **Atomic activation** — when a profile is activated, *all* its
   bundles install together (or none); when deactivated, *all* its
   bundles uninstall together. This is the core UX promise.
4. **Target-agnosticism for profiles** — activating a profile must
   not care whether the user has vscode, kiro, claude-code, or all
   three configured. The profile says "these are the bundles I
   need"; the user-level targets say "where they go".
5. **User-level vs project-level boundary** — Profiles are **user-
   scoped state** (carried across projects); the lockfile is
   **project-scoped state** (committed to the repo). Both must work
   independently and together.

## Conceptual model

```
                    User-level (~/.config/prompt-registry/)
   ┌──────────────────────────────────────────────────────────┐
   │   ┌──────────────────────────────────────────────────┐   │
   │   │             Hubs (one is "active")               │   │
   │   │                                                  │   │
   │   │   ┌─────────────┐    ┌─────────────┐             │   │
   │   │   │   Hub A     │    │   Hub B     │             │   │
   │   │   │             │    │             │             │   │
   │   │   │  sources[]  │    │  sources[]  │             │   │
   │   │   │  profiles[] │    │  profiles[] │             │   │
   │   │   └─────────────┘    └─────────────┘             │   │
   │   │                                                  │   │
   │   │   default-local-hub (synthetic; detached mode)   │   │
   │   └──────────────────────────────────────────────────┘   │
   │                                                          │
   │   active profile (singleton across hubs)                 │
   │                                                          │
   │   user-level targets (vscode, kiro, claude-code, …)      │
   └──────────────────────────────────────────────────────────┘

                Project-level (./prompt-registry.{yml,lock.json})
   ┌──────────────────────────────────────────────────────────┐
   │   targets[]            (project-scoped target overrides) │
   │                                                          │
   │   lockfile.entries[]   (what's actually installed where) │
   │   lockfile.sources{}   (resolver descriptors)            │
   │   lockfile.profiles{}  (which profile drove the install) │
   │   lockfile.hubs{}      (which hub the profile came from) │
   └──────────────────────────────────────────────────────────┘
```

## Operations

### Hub-level

| Command | Effect |
|---|---|
| `hub add <ref>` | Import a hub config from github/local/url; persist under user dir; auto-add its sources |
| `hub list` | List imported hubs |
| `hub use <hubId>` | Make a hub active (singleton). Sources from inactive hubs remain visible via `--hub <id>` filter |
| `hub remove <hubId>` | Remove a hub + its sources + deactivate any of its active profiles |
| `hub sync [<hubId>]` | Re-fetch the hub config from its reference; re-add/update sources |

### Source-level (detached mode)

| Command | Effect |
|---|---|
| `source add --type github --url owner/repo` | Add a source without a hub; lives in the synthetic `default-local-hub` |
| `source list` | List all sources across all hubs (one column shows `hubId`) |
| `source remove <sourceId>` | Remove a source |

### Profile-level (the headline feature of this phase)

| Command | Effect |
|---|---|
| `profile list [--hub <id>]` | List profiles from one hub or all hubs |
| `profile show <profileId>` | Show profile details (bundles, source, version, required flag) |
| `profile activate <profileId>` | **Atomic**: install every bundle in the profile into every user-level target (or `--target` filter); deactivate any previously-active profile first; persist activation state |
| `profile deactivate` | **Atomic**: uninstall every bundle that was installed by the active profile; clear activation state |
| `profile current` | Show the currently-active profile (across all hubs) |

### Install integration

| Shape | Effect |
|---|---|
| `install --profile <profileId> --target <name>` | One-shot: same as `profile activate` but limited to a single target |
| `install --lockfile <path>` | Replay; if lockfile records a profile, replay also re-activates the profile's bundles into the project's targets |

## What gets stored where

### User dir (`~/.config/prompt-registry/`)

| Path | Content |
|---|---|
| `hubs/<hubId>.yml` | Hub config (mirrors extension's `HubStorage.saveHub` shape) |
| `hubs/<hubId>.meta.json` | `{ reference, lastModified, size }` |
| `hubs/active-hub.json` | `{ hubId }` |
| `hubs/default-local/` | Synthetic hub auto-created when first detached source is added |
| `profile-activations/<hubId>_<profileId>.json` | `ProfileActivationState` |
| `targets.yml` | Optional user-level targets (in addition to project ones) |

### Project dir

`prompt-registry.yml` (targets, optional `useProfile: <hubId>/<profileId>`)
`prompt-registry.lock.json` (entries, sources{}, hubs{}, profiles{})

## Decisions to lock in iter 7-10

| ID | Title |
|---|---|
| D19 | Hub config schema mirrors extension's `HubConfig` (additive, not identical) |
| D20 | User-level state lives at `~/.config/prompt-registry/`; XDG-compliant |
| D21 | Single active profile globally (mirrors extension constraint) |
| D22 | Profile activation is atomic with rollback on partial failure |
| D23 | Default local hub is auto-created on first detached source add |
| D24 | Lockfile gains `useProfile?` field linking project to a (hubId, profileId) |
| D25 | APM adapter is post-Phase-6 (deferred per user direction) |

## Iter plan (100 iters)

| Iters | Block | Deliverable |
|---|---|---|
| 1-5 | Discovery + synthesis | Extension model decoded; this design doc |
| 6-10 | Decisions D19-D25 | Locked in `decisions.md` |
| 11-20 | Domain layer | `HubReference`, `HubConfig`, `Source` (lib variant), `Profile`, `ProfileActivationState` types + tests |
| 21-30 | User-level storage | `UserConfigPaths`, `HubStore`, `ProfileActivationStore`, `ActiveHubStore`, `UserTargetStore` + tests |
| 31-40 | Hub fetch | `HubResolver` interface + `GitHubHubResolver` + `LocalHubResolver` + `UrlHubResolver` + tests |
| 41-50 | HubManager (lib) | Orchestrate import/list/remove/sync/use; default-local-hub synthesis; auto-load sources |
| 51-60 | CLI hub commands | `hub add`/`list`/`remove`/`sync`/`use` + e2e |
| 61-70 | Profile activation engine | Resolve profile → bundles → install across all targets atomically, with rollback |
| 71-80 | CLI profile commands | `profile list`/`show`/`activate`/`deactivate`/`current` + e2e |
| 81-85 | Default local hub | Synthetic hub creation on first detached source add; `source add` UX |
| 86-90 | Lockfile profile linkage | `useProfile` field; install --lockfile profile-aware replay |
| 91-95 | install --profile | One-shot install path; tests |
| 96-100 | Docs + closure | Decisions log, parity matrix, user-guide, checkpoint, completion |

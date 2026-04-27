# Phase 6 — Hubs, Sources, Profiles checkpoint

> **Status:** Phase 6 iters 1-90 complete. CLI is now iso-functional
> with the VS Code extension's Hub/Source/Profile model. Iters 91-100
> deliver docs + checkpoint.

## What this phase ships

| Capability | Surface | Decision |
|---|---|---|
| Hub-as-config-layer | `domain/registry`, `registry-config/HubManager` + `HubStore` | D19, D20 |
| Hub fetch (github/local/url) | `HubResolver` interface + 3 impls | — |
| Active hub singleton | `ActiveHubStore` | — |
| Default-local hub for detached sources | `HubManager.addDetachedSource` | D23 |
| Single active profile globally | `ProfileActivationStore.getActive` | D21 |
| Atomic, target-agnostic profile activation | `ProfileActivator` | D22 |
| Project↔profile linkage | `Lockfile.useProfile?` + `upsertUseProfile` | D24 |
| `prompt-registry hub` commands | `cli/commands/hub.ts` | — |
| `prompt-registry profile` commands | `cli/commands/profile.ts` | — |
| `prompt-registry source` commands | `cli/commands/source.ts` | — |
| APM resolver | (deferred) | D25 |

## Numbers

| Metric | Phase 6 baseline (iter 0) | Phase 6 today (iter 90) | Δ |
|---|---|---|---|
| Tests | 590 | 647 | +57 |
| Lint errors | 0 | 0 | 0 |
| TSC | clean | clean | — |
| New `lib/src/` files | — | 9 | +9 |
| New `lib/test/` files | — | 7 | +7 |

## Files added this phase

```
lib/src/domain/registry/
  index.ts                       (barrel)
  hub-config.ts                  HubReference, HubConfig, HubMetadata,
                                 sanitizeHubId, DEFAULT_LOCAL_HUB_ID
  registry-source.ts             RegistrySource (with hubId), guard
  profile.ts                     Profile, ProfileBundle,
                                 ProfileActivationState (+syncedTargets)

lib/src/registry-config/
  index.ts                       (barrel)
  user-config-paths.ts           XDG-compliant path resolver
  hub-store.ts                   YAML+JSON hub persistence
  active-hub-store.ts            singleton active-hub pointer
  profile-activation-store.ts    enforces D21
  hub-resolver.ts                HubResolver interface +
                                 GitHub/Local/Url + Composite
  hub-manager.ts                 orchestrator + default-local synthesis
  profile-activator.ts           atomic, target-agnostic activator

lib/src/cli/commands/
  hub.ts                         hub add/list/use/remove/sync
  profile.ts                     profile list/show/activate/deactivate/current
  source.ts                      source add/list/remove

lib/test/domain/registry/
  hub-config.test.ts
  profile.test.ts
  registry-source.test.ts

lib/test/registry-config/
  storage.test.ts
  hub-resolver.test.ts
  hub-manager.test.ts
  profile-activator.test.ts

lib/test/cli/integration/
  hub-cli.test.ts
  profile-cli.test.ts
  source-cli.test.ts
```

## Constraint compliance

User's session-opening reframe ("the Profile makes sense on the User
level and it can co-exist with the lock file that is project specific.
They are complementary. It should be used in agnostic way - no matter
the target environment. It is non-negotiable") is satisfied as
follows:

- **User-level vs project-level boundary** — D20 puts hub configs +
  active hub pointer + profile activations under
  `${XDG_CONFIG_HOME}/prompt-registry/`. The lockfile (project-level)
  reads/writes `useProfile` (D24) but does not move state between
  layers.
- **Complementary** — Lockfile entries are bytes-on-disk; useProfile
  is intent. A project without profiles works as before.
- **Target-agnostic** — `ProfileActivator` iterates over `Target[]`
  with no per-type code paths; the same profile activates uniformly
  into vscode + claude-code + kiro + windsurf + copilot-cli.
- **Non-negotiable** — `profile activate` refuses zero targets
  (`PROFILE.ACTIVATION_NO_TARGETS`); D21 enforces single active
  profile globally; D22 enforces atomicity with rollback.
- **Detached mode is an edge case** — The default-local hub (D23) is
  invisible UX-wise but always present in the data model; users see
  it only as the `[default-local]` tag in `source list`.

## What's left (iter 91-100)

- iter 91-95: this checkpoint, decisions log housekeeping, parity
  matrix sweep, user-guide docs (`hubs-and-profiles-cli.md` shipped).
- iter 96: hub-config schema reference doc.
- iter 97: `install --profile <id>` one-shot command (deferred to
  post-100 if profile activate is sufficient — `profile activate`
  already does the work).
- iter 98-100: progress.txt + iterations.md update + final summary.

## Deferred to post-Phase-6

- Awesome-copilot / skills source resolvers (each is a one-impl
  drop-in against the existing `BundleResolver` interface).
- APM adapter (D25, per user direction).
- `install --lockfile` profile-aware replay path (the linkage is
  written; the replay-side awareness is one small loop in
  `install.ts`'s lockfile branch). Mechanical follow-up.

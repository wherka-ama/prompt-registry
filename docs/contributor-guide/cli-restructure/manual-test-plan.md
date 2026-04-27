# Manual test plan — `prompt-registry` CLI

> **Audience:** anyone exercising the new CLI by hand against a real
> hub. Also serves as the script that future automated e2e tests
> can be derived from.
>
> **Reference hub:** `Amadeus-xDLC/genai.prompt-registry-config`
> (private — requires GitHub authentication).
>
> **Validation status:** every command in this plan was dry-run
> during authoring; issues hit are tracked in
> `manual-test-issues.md` (BLOCKING items already fixed; HIGH /
> MEDIUM items flagged per-step).
>
> **Scope (post-Phase-D):** the `index <verb>` family
> (search/stats/build/shortlist/export/harvest/report/eval/bench)
> is first-class — there is no separate `primitive-index` binary.
> See §17–§27 for the full coverage matrix and `migration-plan.md`
> §2.1 for the dispatcher rationale.

---

## 0. One-time test sandbox setup

Use throwaway directories so the test never touches the user's
real `${XDG_CONFIG_HOME}/prompt-registry`.

```bash
# ~/.test-prompt-registry holds both the user state and the
# project workspace for the test session.
export PR_TEST_ROOT=$HOME/.test-prompt-registry
rm -rf "$PR_TEST_ROOT"
mkdir -p "$PR_TEST_ROOT"/{xdg,project,bundles/local-foo}

# Isolate the CLI's user-level state from your real install.
export XDG_CONFIG_HOME="$PR_TEST_ROOT/xdg"

# Pick the right binary. If you've checked out the repo:
export PR_BIN="node $(pwd)/lib/dist/cli/index.js"
# …otherwise once a release is published:
# export PR_BIN=prompt-registry

# Convenience: run from the project sandbox so prompt-registry.yml
# / prompt-registry.lock.json land there.
cd "$PR_TEST_ROOT/project"
```

### 0.1 Environment-readiness checklist

> **Manual today** — see I-008 in `manual-test-issues.md` for the
> proposed `prompt-registry diagnose` command that collapses this.

```bash
# 1. node version
node --version          # expect >= 20.x

# 2. gh CLI installed + logged in
gh --version
gh auth status          # expect: "Logged in to github.com as <you>"

# 3. token retrievable (do NOT echo to a terminal you record!)
gh auth token | wc -c   # expect non-zero

# 4. Reach the API directly to prove network + token work.
curl -sS -o /dev/null -w "HTTP %{http_code}\n" \
  -A "manual-test-plan" \
  -H "Authorization: Bearer $(gh auth token)" \
  https://api.github.com/repos/Amadeus-xDLC/genai.prompt-registry-config
# expect: HTTP 200
```

### 0.2 Auth modes the CLI supports

The CLI resolves a GitHub token via this priority chain (composite
provider, first non-null wins):

| # | Source | When |
|---|---|---|
| 1 | `GITHUB_TOKEN` env var | Always |
| 2 | `GH_TOKEN` env var | When `GITHUB_TOKEN` is unset |
| 3 | `gh auth token` | When the env vars are unset and `gh` is installed |

Disable the gh-cli fallback (e.g., to test the unauth path):

```bash
export PROMPT_REGISTRY_DISABLE_GH_CLI=1
```

> Future-friendly: the VS Code extension will plug in
> `vscode.authentication.getSession('github', …)` ahead of the
> three above. Documented in `extension-integration-plan.md` §6.

---

## 1. Unauthenticated smoke test (rate-limited path)

Nothing in this section touches the network. It only verifies that
the CLI launches, parses flags, prints structured JSON with zero
state, and reports its own metadata correctly.

```bash
unset GITHUB_TOKEN GH_TOKEN
export PROMPT_REGISTRY_DISABLE_GH_CLI=1

# 1.1 Version + top-level help.
$PR_BIN --version             # expect: a non-empty semver-ish line
$PR_BIN --help | head -5      # expect: "$ prompt-registry <command>" + table

# 1.2 Empty-state list.
$PR_BIN hub list -o json | jq -e '.status=="ok" and .data.hubs==[] and .data.activeId==null'

# 1.3 Unknown top-level command → exit 1 + clipanion fuzzy-match.
$PR_BIN bogus 2>&1; test $? -ne 0

# 1.4 Index dispatcher: unknown verb exits 64.
$PR_BIN index ghost; test $? -eq 64

# 1.5 `explain` produces a non-empty body for any well-formed code.
$PR_BIN explain INDEX.NOT_FOUND | wc -l | awk '$1>0 {exit 0} {exit 1}'

# 1.6 Schema version stable across `--output` values for a no-op call.
for fmt in text json yaml ndjson; do
  $PR_BIN hub list -o $fmt >/dev/null || echo "FAIL: hub list -o $fmt"
done

unset PROMPT_REGISTRY_DISABLE_GH_CLI
```

Verifies the CLI starts, parses flags, prints structured JSON,
renders the explain catalog, and that the dispatcher's exit codes
(0/1/64) match the contract.

---

## 2. Initiate user configuration from the real hub

### 2.1 Add the hub (token from `gh auth token`, env not set)

```bash
unset GITHUB_TOKEN GH_TOKEN
unset PROMPT_REGISTRY_DISABLE_GH_CLI

$PR_BIN hub add \
  --type github \
  --location Amadeus-xDLC/genai.prompt-registry-config \
  --ref main \
  -o json
```

Expected:
```json
{ "command":"hub.add", "status":"ok",
  "data":{ "id":"amadeus-hub", "location":"...", "type":"github" } }
```

The hub id `amadeus-hub` is derived from the hub's metadata.name
via `sanitizeHubId`. To force a specific id:

```bash
$PR_BIN hub add --type github \
  --location Amadeus-xDLC/genai.prompt-registry-config --ref main \
  --id amadeus
```

### 2.2 Activate the hub

```bash
$PR_BIN hub use amadeus-hub -o text
# expect: "Active hub: amadeus-hub\n"

$PR_BIN hub list -o text
# expect: "* amadeus-hub  Amadeus Hub  ...\n"
```

The leading `*` marks the active hub.

### 2.3 Sync to refresh from upstream

```bash
$PR_BIN hub sync amadeus-hub -o json
# expect: status: "ok", updatedAt timestamp matches the remote
```

### 2.4 Inspect on disk

```bash
ls -la "$XDG_CONFIG_HOME/prompt-registry/"
# expect: hubs/  active-hub.json
cat "$XDG_CONFIG_HOME/prompt-registry/active-hub.json"
# expect: {"activeId":"amadeus-hub"}

ls "$XDG_CONFIG_HOME/prompt-registry/hubs/amadeus-hub/"
# expect: hub-config.yml  reference.json
```

---

## 3. Browse profiles inherited from the hub

```bash
$PR_BIN profile list -o json | jq '.data.profiles | length'
# expect: > 0 (currently ~30)

$PR_BIN profile list -o text | head
# expect tabular text listing
```

### 3.1 Show details of a hub-supplied profile

```bash
$PR_BIN profile show role-git-skillset -o json
# expect:
#   data.profile.id == "role-git-skillset"
#   data.profile.bundles[].source == "dsre-git-skillset"
```

> ⚠️ **Test plan caveat — I-003/I-004:** activating profiles whose
> bundles come from real Amadeus sources currently fails because
> the lib's GitHub resolver expects an asset literally named
> `bundle.zip` and tags of the form `vX.Y.Z`. Real bundles use
> `<id>.bundle.zip` and `<id>-vX.Y.Z`. See `manual-test-issues.md`.
> The §3 commands below are validated up to and including
> `profile show`; activation is covered by §6 against a synthetic
> bundle.

---

## 4. Project-level configuration

### 4.1 Initialize a target

```bash
mkdir -p "$PR_TEST_ROOT/project/.vscode"
$PR_BIN target add my-vscode \
  --type vscode \
  --path "$PR_TEST_ROOT/project/.vscode" \
  -o json
# expect: data.target.name == "my-vscode" + prompt-registry.yml created
cat prompt-registry.yml
```

### 4.2 List + remove

```bash
$PR_BIN target list -o text
$PR_BIN target remove my-vscode -o json
$PR_BIN target list -o json | jq '.data.targets | length'   # 0
# Re-add for the rest of the plan:
$PR_BIN target add my-vscode --type vscode --path "$PR_TEST_ROOT/project/.vscode" -o json
```

---

## 5. Detached / "default-local" hub flow (D23 edge case)

The user can register sources without importing a curated hub.
Behind the scenes a synthetic `default-local` hub holds them.

```bash
$PR_BIN source add --type github --url owner/repo --id detached-foo -o json
$PR_BIN source list -o text
# expect: detached-foo  [default-local]  github: owner/repo

$PR_BIN source remove detached-foo -o json
```

Edge cases:

```bash
$PR_BIN source add --type github -o json   # missing --url
# expect: errors[0].code == "USAGE.MISSING_FLAG"

$PR_BIN source add --type unknown --url x -o json
# expect: type defaults to 'github'; documented quirk
```

---

## 6. End-to-end profile activation (synthetic bundle path)

This is the path that **does** work end-to-end today. It uses a
locally-prepared bundle plus a locally-imported hub so we exercise
the full `ProfileActivator` (D21 + D22) with **no** dependency on
I-003/I-004.

### 6.1 Build the synthetic bundle + local hub

```bash
mkdir -p "$PR_TEST_ROOT/bundles/local-foo/prompts"
cat > "$PR_TEST_ROOT/bundles/local-foo/deployment-manifest.yml" <<'EOF'
id: local-foo
version: 1.0.0
name: Local Foo
EOF
echo "# A prompt" > "$PR_TEST_ROOT/bundles/local-foo/prompts/a.md"

mkdir -p "$PR_TEST_ROOT/local-hub"
cat > "$PR_TEST_ROOT/local-hub/hub-config.yml" <<EOF
version: 1.0.0
metadata:
  name: Local Test Hub
  description: synthetic hub for the manual test plan
  maintainer: tester
  updatedAt: '2026-04-26T00:00:00Z'
sources:
  - id: local-foo-src
    name: Local Foo Source
    type: local
    url: $PR_TEST_ROOT/bundles/local-foo
    enabled: true
    priority: 0
    hubId: local-test-hub
profiles:
  - id: backend
    name: Backend Developer
    bundles:
      - id: local-foo
        version: 1.0.0
        source: local-foo-src
        required: true
EOF
```

### 6.2 Import + activate

```bash
$PR_BIN hub add --type local --location "$PR_TEST_ROOT/local-hub" -o json
# Hub id derived: "local-test-hub"
$PR_BIN hub use local-test-hub -o json

$PR_BIN profile show backend -o json | jq '.data.profile.bundles'
$PR_BIN profile activate backend -o json
# expect:
#   data.state.syncedBundles == ["local-foo"]
#   data.state.syncedTargets == ["my-vscode"]

# File should be on disk in the target.
ls "$PR_TEST_ROOT/project/.vscode/prompts/"
# expect: a.md
cat "$PR_TEST_ROOT/project/.vscode/prompts/a.md"
# expect: "# A prompt"

# Lockfile linkage (D24)
cat prompt-registry.lock.json | jq .useProfile
# expect: { "hubId": "local-test-hub", "profileId": "backend" }
```

### 6.3 Switch profile (single-active-globally guarantee, D21)

Add a second profile to the local hub and switch:

```bash
cat >> "$PR_TEST_ROOT/local-hub/hub-config.yml" <<'EOF'
  - id: writer
    name: Technical Writer
    bundles: []
EOF

$PR_BIN hub sync local-test-hub -o json
$PR_BIN profile activate writer -o json
$PR_BIN profile current -o json | jq '.data.current.profileId'
# expect: "writer"

# backend's files should be gone (rollback on switch).
ls "$PR_TEST_ROOT/project/.vscode/prompts/" 2>/dev/null
# expect: empty or directory missing
```

### 6.4 Deactivate

```bash
$PR_BIN profile deactivate -o json
$PR_BIN profile current -o json | jq '.data.current'
# expect: null

cat prompt-registry.lock.json | jq .useProfile
# expect: null (cleared)
```

---

## 7. Search / browse newly added capabilities

> The standalone `primitive-index` binary was **removed** during the
> post-Phase-D consolidation (see `migration-plan.md` §2.1). Every
> primitive-index verb is now a first-class subcommand of
> `prompt-registry`, dispatched by `runIndexCommand` in
> `lib/src/cli/index.ts`.
>
> The full coverage matrix for the `index <verb>` family lives in
> §17–§22 below. This section keeps a tight discovery-flow walkthrough
> that links those sections together.

### 7.1 Harvest + search (against the real hub)

```bash
# Cold harvest of the imported hub. Writes
# $XDG_CACHE_HOME/prompt-registry/primitive-index.json (or
# ~/.cache/prompt-registry/primitive-index.json on POSIX with no
# XDG override) plus a per-hub blob+ETag cache under
# $XDG_CACHE_HOME/prompt-registry/hubs/<owner>_<repo>/.
$PR_BIN index harvest --hub-repo Amadeus-xDLC/genai.prompt-registry-config -o json \
  | tee /tmp/harvest.json | jq '.data.totals'
# expect: { totalMs: <n>, done: <n>, error: 0, skip: <n>, primitives: <n>, wallMs: <n> }

# Confirm the index landed.
$PR_BIN index stats -o json | jq '{ primitives: .data.primitives, bundles: .data.bundles }'

# Discover a primitive.
$PR_BIN index search --q "git commit" --limit 5 -o json | jq '.data.hits[].primitive | { kind, title, id }'
```

### 7.2 Compose a new local profile from search results

This is the "create new local profiles by using the newly added
search capabilities" flow. The `index shortlist` family captures
intent without hand-editing YAML for the discovery part; turning a
shortlist into a published profile uses `index export`:

```bash
# 1. Find the bundle of interest
HIT_ID=$($PR_BIN index search --q "code review" --limit 1 -o json \
  | jq -r '.data.hits[0].primitive.id')

# 2. Capture in a shortlist (rewritten back into the index file)
SL_ID=$($PR_BIN index shortlist new --name "code-review-favs" -o json \
  | jq -r '.data.shortlist.id')
$PR_BIN index shortlist add --id "$SL_ID" --primitive "$HIT_ID" -o json

# 3. Export as a hub profile (and a curated collection)
$PR_BIN index export \
  --shortlist "$SL_ID" --profile-id code-review-favs \
  --out-dir "$PR_TEST_ROOT/exports" --suggest-collection -o json \
  | jq '{ profile: .data.profileFile, collection: .data.collectionFile }'

# 4. Wire the produced YAML into a local hub if you want to
#    activate it through the profile-activator pipeline (§6).
ls "$PR_TEST_ROOT/exports/"
# expect: code-review-favs.profile.yml  code-review-favs.collection.yml
```

> 🔬 **Open question logged as I-011 (low):** add a
> `prompt-registry profile create --hub <id> --name <n>
> --bundle <ref> [--bundle <ref>]…` so users can compose local
> profiles without hand-editing YAML.

---

## 8. Lockfile-driven replay (clone-then-install workflow)

Simulate a teammate cloning the project:

```bash
# 1. Re-activate so the lockfile carries useProfile.
$PR_BIN profile activate backend -o json

# 2. Snapshot the lockfile + targets.
cp prompt-registry.lock.json /tmp/snapshot.lock.json
cp prompt-registry.yml      /tmp/snapshot.yml

# 3. Wipe the worktree.
rm -rf "$PR_TEST_ROOT/project/.vscode"

# 4. Replay (today: replays bundle entries; useProfile is surfaced
#    in JSON output, see Phase 6 / iter 97).
$PR_BIN install --lockfile prompt-registry.lock.json --target my-vscode -o json | tee /tmp/replay.json
jq '.data.useProfile' /tmp/replay.json
# expect: { hubId: "local-test-hub", profileId: "backend" }

# 5. Confirm files re-landed.
cat "$PR_TEST_ROOT/project/.vscode/prompts/a.md"   # "# A prompt"
```

---

## 9. Negative paths (must produce structured errors)

```bash
# Activate non-existent profile
$PR_BIN profile activate ghost -o json | jq .errors
# expect: code starts with "PROFILE." or "USAGE."

# Use missing hub
$PR_BIN hub use nonsense -o json | jq .errors
# expect: HUB.NOT_FOUND

# Reserved hub id
$PR_BIN hub add --type local --location "$PR_TEST_ROOT/local-hub" --id default-local -o json
# expect: HUB.RESERVED_ID

# Profile activate without any target
$PR_BIN target remove my-vscode
$PR_BIN profile activate backend -o json | jq .errors[0].code
# expect: USAGE.MISSING_FLAG (no targets)
$PR_BIN target add my-vscode --type vscode --path "$PR_TEST_ROOT/project/.vscode"

# Hub clear
$PR_BIN hub use --clear
$PR_BIN profile current -o json | jq .data.current
# expect: null
$PR_BIN hub use local-test-hub
```

---

## 10. Output-format matrix

For every read-only command across every family verify all four
output formats parse cleanly. Run after §2/§6 so there is real
state (otherwise lists are empty but still well-formed).

```bash
CMDS=(
  'hub list'
  'profile list'
  'profile current'
  'source list'
  'target list'
  'config list'
  'plugins list'
  'index stats --index '"$PR_TEST_ROOT/idx-corpus/idx.json"
  'index search --index '"$PR_TEST_ROOT/idx-corpus/idx.json"' --q hello --limit 1'
  'index shortlist list --index '"$PR_TEST_ROOT/idx-corpus/idx.json"
  'index report --progress '"$PR_CACHE/progress.jsonl"
)

for c in "${CMDS[@]}"; do
  for fmt in text json yaml ndjson; do
    out=$($PR_BIN $c -o $fmt 2>/dev/null)
    test -n "$out" || echo "FAIL: $c -o $fmt produced empty output"
  done
done
```

For every JSON envelope assert the canonical key set:

```bash
$PR_BIN hub list -o json \
  | jq -e '. | keys == ["command","data","errors","meta","schemaVersion","status","warnings"]'
```

Expected: each call exits 0 with non-empty stdout; the JSON shape is
stable across formats (text/yaml/ndjson are pure projections of the
same `data` object). No field renames between modes.

> **Known schema drift:** `target list -o json` returns `data: []`
> (array) instead of `data: { targets: [] }`. Tracked as I-016. Do
> not branch script logic on `.data.targets` until that lands.

---

## 11. Cross-process state observation (extension-integration preview)

While a `profile activate` is running in shell A, a watcher in
shell B should observe the activation file appear:

```bash
# Shell B (Linux)
inotifywait -m -e create -e modify \
  "$XDG_CONFIG_HOME/prompt-registry/profile-activations" &

# Shell B (macOS)
# fswatch "$XDG_CONFIG_HOME/prompt-registry/profile-activations" &

# Shell A
$PR_BIN profile activate backend
# Expect inotifywait/fswatch in shell B to print a line within ~1s.
```

This is the foundation for `extension-integration-plan.md` Phase C
(cross-process file watch).

> **Cross-platform:** see §28 for the watcher equivalents. On
> Windows / Git-Bash this section is **skipped** (no native
> equivalent included in the plan).

---

## 12. Performance / responsiveness

| Operation | Expected p95 (cold) | Expected p95 (warm) |
|---|---|---|
| `hub list` | < 200 ms | < 100 ms |
| `hub add github` | < 5 s (network) | n/a |
| `hub sync` | < 5 s (network) | < 5 s (no-op fast path absent today) |
| `profile activate` (1 local bundle) | < 500 ms | < 500 ms |

Run with `time` to spot regressions:
```bash
time $PR_BIN hub list >/dev/null
```

---

## 13. Edge cases

| # | Setup | Command | Expected |
|---|---|---|---|
| E1 | XDG dir contains a `hubs/foo/` with malformed YAML | `hub list` | `foo` is skipped; warning to stderr; other hubs still listed |
| E2 | Empty `prompt-registry.yml` | `target list` | `data.targets: []`, exit 0 |
| E3 | Workspace has no `prompt-registry.yml` | `profile activate ...` | USAGE.MISSING_FLAG with helpful message |
| E4 | Two CLIs run in parallel: both call `profile activate` | second call | The activation is serialized via filesystem create; one wins, second sees current state |
| E5 | XDG path has a space (`My Configs`) | every command | Works; covered by quoting |
| E6 | Hub repo deleted upstream | `hub list` then `hub sync` | `list` succeeds (cached); `sync` fails gracefully with `HUB.NETWORK_ERROR` (logged as I-007) |
| E7 | gh CLI installed but logged out | `hub add github` | falls back to anonymous; gets rate-limited 60 req/h on github.com |
| E8 | gh CLI installed, env-var set | any github call | env wins; gh CLI not invoked (saves ~50 ms) |
| E9 | Network offline | `hub list` | works (no network); `hub add` | structured error from underlying `dial tcp` |
| E10 | Profile bundle source not in hub.sources | `profile activate` | `PROFILE.SOURCE_NOT_FOUND` with bundle-id context |
| E11 | Concurrent `profile activate` + `target remove` | … | activation rolls back; `PROFILE.ACTIVATION_FAILED` |
| E12 | Index file is on a different filesystem (cross-device link) | `index harvest --out /mnt/other/idx.json` | works (harvester writes via tmp-file + rename within the same dir) |
| E13 | `--cache-dir` and `--out` collide (cache holds the index) | `index harvest --cache-dir X --out X/primitive-index.json` | works; cache dir is namespaced (`X/blobs/`, `X/etags.json`) |
| E14 | Hub-config has zero sources, no `--extra-source` | `index harvest` | `data.totals.done == 0`, exit 0, empty index written |
| E15 | Two CLIs run `index shortlist add` against the same index file in parallel | second call | last-write-wins on the JSON file; no lockfile today (logged for follow-up if it bites) |
| E16 | `index search` query string starts with `-` (e.g. `--q -dash`) | with quoting | works; without quoting the dispatcher treats `-dash` as a (non-existent) short flag |
| E17 | `XDG_CACHE_HOME` is set to a path that does not exist | any `index <verb>` using defaults | the directory is created lazily by the harvester / store layer |

---

## 14. Tear-down

```bash
unset XDG_CONFIG_HOME XDG_CACHE_HOME PR_TEST_ROOT PR_BIN PR_CACHE \
  PROMPT_REGISTRY_CACHE PROMPT_REGISTRY_DISABLE_GH_CLI \
  PRIMITIVE_INDEX_SIGN_KEY PRIMITIVE_INDEX_SIGN_KEY_ID
rm -rf "$HOME/.test-prompt-registry"
```

---

## 15. Reading the rest of the plan

- Issues hit during this plan: `manual-test-issues.md`.
- The model the plan exercises: `phase-6-design.md`.
- The dispatcher details for `index <verb>`: `migration-plan.md` §2.1.
- Where this plan goes next (automation): every section above
  becomes a `test/cli/integration/manual-trace-§N.test.ts` once
  we have a fixture-hub mirroring the Amadeus structure (logged as
  follow-up F1 in `phase-6-checkpoint.md`).

## 16. Sign-off checklist

When using this plan as an acceptance gate, every box must be
checked:

**Hub / profile / target / install (Phase 4–6):**

- [ ] §0.1 environment-readiness checklist passes
- [ ] §1 unauthenticated smoke test passes (incl. `--version`, `--help`,
      `index <unknown>` exits 64, `explain` produces a non-empty body)
- [ ] §2.1–§2.4 hub import + activate + sync against the real hub
- [ ] §3.1 profile show against a hub-supplied profile
- [ ] §4 target add/list/remove
- [ ] §5 detached source flow
- [ ] §6.1–§6.4 full activation/deactivation against synthetic bundle
- [ ] §7.1–§7.2 discovery flow chains harvest → search → shortlist → export
- [ ] §8 lockfile replay reinstates files after wipe
- [ ] §9 every negative path produces a structured error envelope
- [ ] §10 every output format parses across the family matrix
- [ ] §11 cross-process watch fires within 1 s (POSIX-only — see §28)
- [ ] §13 edge cases match the table

**`index <verb>` family (post-Phase-D primitive-index consolidation):**

- [ ] §17 `index build` against a synthetic local-folder corpus
- [ ] §17 `index stats` (text + json) reports correct totals
- [ ] §18 `index search` filter matrix (kinds / sources / bundles / tags / installed-only / limit / offset / explain)
- [ ] §19 `index shortlist {new,add,list,remove}` round-trip
- [ ] §19 `index export` produces a valid profile YAML and an optional collection YAML
- [ ] §20 `index harvest` happy + `--no-hub-config` + `--hub-config-file` + `--extra-source` repeated + `--sources-include/--exclude` + `--force` + `--dry-run`
- [ ] §21 `index report` (markdown + json) reflects the JSONL progress log
- [ ] §22 `index eval` exits non-zero when a case fails; `index bench` reports positive QPS
- [ ] §23 integrity sidecar (`PRIMITIVE_INDEX_SIGN_KEY`) writes `<idx>.sig.json` and verifies
- [ ] §24 `--help` matrix — gaps tracked in I-019
- [ ] §25 envelope contract is enforced for every error code
- [ ] §26 `doctor` happy + missing-token + bad cache dir
- [ ] §27 `hub list --check` flags an unreachable cached hub

If any box does not match, add a row to `manual-test-issues.md`
and link it from the failing step.

---

## 17. `index build` + `index stats` (offline path)

These two are the offline, network-free entry to the index family.
Use them first whenever working on a new machine or a CI runner
without network access — both work entirely against a local folder.

### 17.1 Build a synthetic local-folder corpus

```bash
mkdir -p "$PR_TEST_ROOT/idx-corpus/alpha/prompts" \
         "$PR_TEST_ROOT/idx-corpus/beta/prompts"
cat > "$PR_TEST_ROOT/idx-corpus/alpha/deployment-manifest.yml" <<'EOF'
id: alpha
version: 1.0.0
name: Alpha
description: Tests
items:
  - path: prompts/hi.prompt.md
    kind: prompt
EOF
echo -e '---\ntitle: hello-alpha\ndescription: greet alpha\n---\n# Hi' \
  > "$PR_TEST_ROOT/idx-corpus/alpha/prompts/hi.prompt.md"

cat > "$PR_TEST_ROOT/idx-corpus/beta/deployment-manifest.yml" <<'EOF'
id: beta
version: 1.0.0
name: Beta
description: Tests
items:
  - path: prompts/hi.prompt.md
    kind: prompt
EOF
echo -e '---\ntitle: hello-beta\ndescription: greet beta\n---\n# Hi' \
  > "$PR_TEST_ROOT/idx-corpus/beta/prompts/hi.prompt.md"

# Build (text mode, then json envelope).
$PR_BIN index build --root "$PR_TEST_ROOT/idx-corpus" \
  --out "$PR_TEST_ROOT/idx-corpus/idx.json" --source-id local
# expect: "built ... primitives=2 bundles=2"

$PR_BIN index build --root "$PR_TEST_ROOT/idx-corpus" \
  --out "$PR_TEST_ROOT/idx-corpus/idx.json" --source-id local -o json \
  | jq -e '.command=="index.build" and .status=="ok" and .data.stats.primitives>=2'
# expect: true (jq -e exits 0 on truthy)
```

### 17.2 `index stats`

```bash
# Text mode shows a summary table.
$PR_BIN index stats --index "$PR_TEST_ROOT/idx-corpus/idx.json"
# expect: lines starting with "primitives:" / "bundles:" / "byKind:" / "bySource:"

# JSON envelope.
$PR_BIN index stats --index "$PR_TEST_ROOT/idx-corpus/idx.json" -o json \
  | jq -e '.data.primitives>=2 and (.data.byKind | type)=="object"'

# Missing index → INDEX.NOT_FOUND in the envelope.
$PR_BIN index stats --index /nonexistent.json -o json \
  | jq -e '.errors[0].code=="INDEX.NOT_FOUND"'
```

### 17.3 Edge cases

| # | Setup | Command | Expected |
|---|---|---|---|
| B1 | `--root` missing | `index build` | `errors[0].code` = `USAGE.MISSING_FLAG` |
| B2 | `--root <dir>` empty (no manifests) | `index build --root <empty-dir>` | exit 0, `data.stats.primitives == 0` |
| B3 | Manifest is malformed YAML | `index build` | non-zero exit, error namespaced under `INDEX.BUILD_FAILED` |
| B4 | `--out` points at an unwritable path | `index build` | `INDEX.BUILD_FAILED`, error message mentions ENOENT/EACCES |

---

## 18. `index search` — filter matrix

> The default index location is
> `$XDG_CACHE_HOME/prompt-registry/primitive-index.json` (or
> `~/.cache/prompt-registry/primitive-index.json` on POSIX). Override
> with `--index <file>` to test against the §17 fixture in isolation.

### 18.1 Basic queries

```bash
IDX="$PR_TEST_ROOT/idx-corpus/idx.json"

# Plain query.
$PR_BIN index search --index "$IDX" --q hello -o json | jq '.data.total'
# expect: >= 2

# Short-flag aliases (preserved by the dispatcher).
$PR_BIN index search --index "$IDX" -q hello -l 1 -o json | jq '.data.hits | length'
# expect: <= 1

# No --q at all → returns everything (intentional; tracked as I-020).
$PR_BIN index search --index "$IDX" -o json | jq '.data.total'
# expect: >= 2 (entire corpus)
```

### 18.2 Facet filters

```bash
# Kinds (csv) — only "prompt" hits in the §17 corpus.
$PR_BIN index search --index "$IDX" --q hello --kinds prompt -o json \
  | jq -e 'all(.data.hits[]; .primitive.kind=="prompt")'

# Sources (csv).
$PR_BIN index search --index "$IDX" --q hello --sources local -o json \
  | jq -e 'all(.data.hits[]; .primitive.bundle.sourceId=="local")'

# Bundles (csv) — restricting to "alpha" excludes beta.
$PR_BIN index search --index "$IDX" --q hello --bundles alpha -o json \
  | jq -e 'all(.data.hits[]; .primitive.bundle.bundleId=="alpha")'

# Tags (csv) — empty list when no tag matches.
$PR_BIN index search --index "$IDX" --q hello --tags nonexistent -o json \
  | jq '.data.total'
# expect: 0

# Pagination.
$PR_BIN index search --index "$IDX" --q hello --limit 1 --offset 0 -o json \
  | jq '.data.hits | length'
# expect: 1

# Explain — every hit gains a per-field BM25 contribution table.
$PR_BIN index search --index "$IDX" --q hello --explain -o json \
  | jq '.data.hits[0] | keys'
# expect: includes "explain"
```

### 18.3 Negative paths

```bash
$PR_BIN index search --index /nonexistent.json --q hello -o json \
  | jq -e '.errors[0].code=="INDEX.NOT_FOUND"'

# Bad output format → CLI rejects pre-dispatch.
$PR_BIN index search --index "$IDX" --q hello -o invalid 2>&1 \
  | grep -Ei 'invalid|usage'
```

### 18.4 `--installed-only`

If you've activated a profile (§6) the matching primitives are
flagged `installed: true` in the index. Verify the filter is wired:

```bash
$PR_BIN index search --index "$IDX" --q hello --installed-only -o json \
  | jq '.data.total'
# expect: 0 against the §17 fixture (nothing is installed there)
```

---

## 19. `index shortlist` round-trip + `index export`

### 19.1 Shortlist round-trip

```bash
IDX="$PR_TEST_ROOT/idx-corpus/idx.json"

SL=$($PR_BIN index shortlist new --index "$IDX" --name demo -o json \
  | jq -r '.data.shortlist.id')
test -n "$SL"  # non-empty id

PID=$($PR_BIN index search --index "$IDX" --q hello -o json \
  | jq -r '.data.hits[0].primitive.id')

$PR_BIN index shortlist add --index "$IDX" --id "$SL" --primitive "$PID" -o json \
  | jq -e '.data.shortlist.primitiveIds | length == 1'

$PR_BIN index shortlist list --index "$IDX" -o json \
  | jq -e '.data.shortlists[] | select(.name=="demo")'

$PR_BIN index shortlist remove --index "$IDX" --id "$SL" --primitive "$PID" -o json \
  | jq -e '.data.shortlist.primitiveIds | length == 0'
```

### 19.2 Negative paths

```bash
# Missing shortlist id.
$PR_BIN index shortlist add --index "$IDX" --primitive "$PID" -o json \
  | jq -e '.errors[0].code=="USAGE.MISSING_FLAG"'

# Unknown shortlist id.
$PR_BIN index shortlist add --index "$IDX" --id sl_missing --primitive "$PID" -o json \
  | jq -e '.errors[0].code=="INDEX.SHORTLIST_NOT_FOUND"'

# Unknown subcommand → exit 64 + dispatcher usage line on stderr.
$PR_BIN index shortlist quack 2>&1; test $? -eq 64
```

### 19.3 `index export` — profile + suggested collection

```bash
$PR_BIN index shortlist add --index "$IDX" --id "$SL" --primitive "$PID" -o json
$PR_BIN index export --index "$IDX" --shortlist "$SL" \
  --profile-id demo-profile --out-dir "$PR_TEST_ROOT/exports" \
  --suggest-collection -o json \
  | jq -e '.data.profileFile and .data.collectionFile'

test -f "$PR_TEST_ROOT/exports/demo-profile.profile.yml"
test -f "$PR_TEST_ROOT/exports"/*.collection.yml
```

### 19.4 Edge cases

| # | Setup | Command | Expected |
|---|---|---|---|
| X1 | `--shortlist` missing | `index export --profile-id x` | `USAGE.MISSING_FLAG` |
| X2 | `--profile-id` missing | `index export --shortlist $SL` | `USAGE.MISSING_FLAG` |
| X3 | Unknown shortlist id | `index export --shortlist sl_ghost --profile-id x` | `INDEX.SHORTLIST_NOT_FOUND` |
| X4 | `--out-dir` points at a file (not a dir) | `index export …` | `INDEX.EXPORT_FAILED`, message mentions `mkdir`/`ENOTDIR` |
| X5 | Shortlist is empty | `index export …` | exit 0, profile YAML written; `data.warnings` non-empty |

---

## 20. `index harvest` — full flag matrix

> ⚠️ Most of §20 is **online**. Run only after §0.1 confirms a token
> is available. Use a short-lived `--cache-dir` under `$PR_TEST_ROOT`
> so your real `$XDG_CACHE_HOME/prompt-registry/hubs/` is never
> polluted.

```bash
export PR_CACHE="$PR_TEST_ROOT/idx-cache"
mkdir -p "$PR_CACHE"
```

### 20.1 Happy path against the real hub

```bash
$PR_BIN index harvest \
  --hub-repo Amadeus-xDLC/genai.prompt-registry-config \
  --cache-dir "$PR_CACHE" \
  --out "$PR_TEST_ROOT/idx-cache/idx.json" -o json \
  | tee /tmp/h1.json | jq -e '.data.totals.error == 0'

# Warm re-harvest: should be near-instant + skip > 0.
$PR_BIN index harvest \
  --hub-repo Amadeus-xDLC/genai.prompt-registry-config \
  --cache-dir "$PR_CACHE" \
  --out "$PR_TEST_ROOT/idx-cache/idx.json" -o json \
  | jq -e '.data.totals.skip > 0 and .data.totals.wallMs < (.data.totals.totalMs * 1)'
```

### 20.2 Source filtering

```bash
# Include just one source.
$PR_BIN index harvest --hub-repo Amadeus-xDLC/genai.prompt-registry-config \
  --cache-dir "$PR_CACHE" --out "$PR_TEST_ROOT/idx-cache/idx-incl.json" \
  --sources-include refx-development -o json \
  | jq -e '.data.hub.sources == 1'

# Exclude a noisy one.
$PR_BIN index harvest --hub-repo Amadeus-xDLC/genai.prompt-registry-config \
  --cache-dir "$PR_CACHE" --out "$PR_TEST_ROOT/idx-cache/idx-excl.json" \
  --sources-exclude otter -o json \
  | jq -e '[.data.hub.sources >= 1, (.data | tojson | contains("otter") | not)] | all'
```

### 20.3 Local hub-config + extra-source DSL (no hub repo at all)

```bash
# Inline hub-config.yml from disk + an injected awesome-copilot source.
mkdir -p "$PR_TEST_ROOT/idx-cache/local"
cat > "$PR_TEST_ROOT/idx-cache/local/hub-config.yml" <<'EOF'
version: 1.0.0
metadata:
  name: Local
  description: empty
  maintainer: tester
  updatedAt: '2026-04-26T00:00:00Z'
sources: []
profiles: []
EOF

$PR_BIN index harvest \
  --hub-config-file "$PR_TEST_ROOT/idx-cache/local/hub-config.yml" \
  --cache-dir "$PR_CACHE" --out "$PR_TEST_ROOT/idx-cache/idx-extra.json" \
  --extra-source 'id=upstream-ac,type=awesome-copilot-plugin,url=https://github.com/github/awesome-copilot,branch=main,pluginsPath=plugins' \
  -o json \
  | jq -e '.data.hub.sources == 1 and .data.totals.error == 0'

# Repeated --extra-source (parser preserves order; later wins per-id).
$PR_BIN index harvest --no-hub-config --cache-dir "$PR_CACHE" \
  --out "$PR_TEST_ROOT/idx-cache/idx-many.json" \
  --extra-source 'id=a,type=github,url=https://github.com/owner/a,branch=main' \
  --extra-source 'id=b,type=github,url=https://github.com/owner/b,branch=main' \
  -o json \
  | jq -e '.data.hub.sources == 2'
```

### 20.4 `--force` and `--dry-run`

```bash
# --force re-fetches every blob even with a warm cache.
$PR_BIN index harvest --hub-repo Amadeus-xDLC/genai.prompt-registry-config \
  --cache-dir "$PR_CACHE" --force --sources-include refx-development -o json \
  | jq -e '.data.totals.skip == 0'

# --dry-run walks sources but does NOT write the out-file.
rm -f "$PR_TEST_ROOT/idx-cache/idx-dry.json"
$PR_BIN index harvest --hub-repo Amadeus-xDLC/genai.prompt-registry-config \
  --cache-dir "$PR_CACHE" --out "$PR_TEST_ROOT/idx-cache/idx-dry.json" \
  --sources-include refx-development --dry-run -o json
test ! -f "$PR_TEST_ROOT/idx-cache/idx-dry.json"
```

### 20.5 Negative paths

```bash
# Missing both --hub-repo and the escape hatches.
$PR_BIN index harvest -o json | jq -e '.errors[0].code=="USAGE.MISSING_FLAG"'

# Token resolution failure.
PROMPT_REGISTRY_DISABLE_GH_CLI=1 GITHUB_TOKEN= GH_TOKEN= \
  $PR_BIN index harvest --hub-repo owner/repo -o json \
  | jq -e '.errors[0].code=="INDEX.HARVEST_FAILED"'

# Invalid hub-repo shape.
$PR_BIN index harvest --hub-repo not-a-slash -o json \
  | jq -e '.errors[0].code=="INDEX.HARVEST_FAILED"'
```

### 20.6 SIGINT half-way

`index harvest` registers a SIGINT/SIGTERM handler that flushes the
ETag store before exiting with code 130:

```bash
( $PR_BIN index harvest --hub-repo Amadeus-xDLC/genai.prompt-registry-config \
    --cache-dir "$PR_CACHE" -o json &
  HARV_PID=$!
  sleep 0.5
  kill -INT $HARV_PID
  wait $HARV_PID; echo "exit=$?" )
# expect: exit=130; etags.json on disk has been touched.
test -f "$PR_CACHE/etags.json"
```

---

## 21. `index report` — JSONL progress log → human/JSON report

The harvester writes a JSONL progress log that survives crashes; the
report verb folds it into a per-bundle summary.

```bash
PROG="$PR_CACHE/progress.jsonl"

# Markdown report (default text mode).
$PR_BIN index report --progress "$PROG" | head -10
# expect:
#   # Primitive Index — Hub harvest report
#   - Progress file: `…/progress.jsonl`
#   - Done: **N**  Skip: **M**  Error: **0**
#   …
#   | Source | Bundle | Status | Commit sha | Primitives | ms | Note |

# JSON envelope.
$PR_BIN index report --progress "$PROG" -o json \
  | jq -e '.data.summary.done >= 0 and (.data.bundles | type) == "array"'
```

### 21.1 Default-path resolution

```bash
# With no flags the default progress file is derived from the hub id.
$PR_BIN index report --hub-repo Amadeus-xDLC/genai.prompt-registry-config -o json \
  | jq -e '.data.summary | type == "object"'

# Missing progress file → opened lazily, summary all zeros (per the
# JSONL append-mode contract).
$PR_BIN index report --progress /nonexistent/progress.jsonl -o json \
  | jq -e '.status == "ok" and .data.summary.done == 0'
```

### 21.2 Cache-stats sidebar

When `--cache-dir` is set the report includes blob-cache stats:

```bash
$PR_BIN index report --progress "$PROG" --cache-dir "$PR_CACHE" -o json \
  | jq '.data.cacheStats'
# expect: { entries: <n>, bytes: <n> }
```

---

## 22. `index eval` + `index bench`

Both consume a gold-set JSON file with `cases[]: PatternCase`.

```bash
GOLD="$PR_TEST_ROOT/gold.json"
cat > "$GOLD" <<'EOF'
{
  "cases": [
    {
      "id": "sanity",
      "query": { "q": "hello", "limit": 5 },
      "mustMatch": [{ "kind": ".+" }]
    }
  ]
}
EOF

# Eval — exits 0 when every case passes.
$PR_BIN index eval --index "$PR_TEST_ROOT/idx-corpus/idx.json" --gold "$GOLD" -o json \
  | jq -e '.data.aggregate.passed == 1 and .data.aggregate.failed == 0'

# Eval — exits 1 when a case fails (unsatisfiable mustMatch).
cat > "$PR_TEST_ROOT/gold-fail.json" <<'EOF'
{ "cases": [{ "id":"impossible", "query":{ "q":"zzz" },
              "mustMatch":[{ "kind":"agent" }]}] }
EOF
$PR_BIN index eval --index "$PR_TEST_ROOT/idx-corpus/idx.json" \
  --gold "$PR_TEST_ROOT/gold-fail.json" -o json
test $? -eq 1

# Bench — positive QPS, deterministic per-case stats.
$PR_BIN index bench --index "$PR_TEST_ROOT/idx-corpus/idx.json" \
  --gold "$GOLD" --iterations 5 -o json \
  | jq -e '.data.aggregate.qps > 0 and (.data.perCase | length) == 1'
```

### 22.1 Negative paths

| # | Setup | Command | Expected |
|---|---|---|---|
| EV1 | Missing `--gold` | `index eval` | `USAGE.MISSING_FLAG` |
| EV2 | Bad gold JSON | `index eval --gold <broken>` | `INDEX.EVAL_FAILED` |
| EV3 | Index file missing | `index eval --index /none --gold $GOLD` | `INDEX.NOT_FOUND` |
| BN1 | `--iterations 0` | `index bench --iterations 0` | exit 0 with `qps == 0` (documented quirk) |

---

## 23. Integrity sidecar + cache env overrides

### 23.1 HMAC-signed sidecar

```bash
export PRIMITIVE_INDEX_SIGN_KEY=test-secret
export PRIMITIVE_INDEX_SIGN_KEY_ID=test-key

$PR_BIN index harvest --hub-config-file "$PR_TEST_ROOT/idx-cache/local/hub-config.yml" \
  --cache-dir "$PR_CACHE" \
  --out "$PR_TEST_ROOT/idx-cache/idx-signed.json" -o json

test -f "$PR_TEST_ROOT/idx-cache/idx-signed.sig.json"
jq -e '.keyId=="test-key"' "$PR_TEST_ROOT/idx-cache/idx-signed.sig.json"

unset PRIMITIVE_INDEX_SIGN_KEY PRIMITIVE_INDEX_SIGN_KEY_ID
```

### 23.2 `PROMPT_REGISTRY_CACHE`

```bash
export PROMPT_REGISTRY_CACHE="$PR_TEST_ROOT/cache-override"
$PR_BIN index harvest --no-hub-config -o json \
  | jq -e '.data.cacheDir | startswith("'"$PR_TEST_ROOT/cache-override"'")'
unset PROMPT_REGISTRY_CACHE
```

### 23.3 `XDG_CACHE_HOME` (POSIX fallback)

```bash
export XDG_CACHE_HOME="$PR_TEST_ROOT/xdg-cache"
$PR_BIN index harvest --no-hub-config -o json \
  | jq -e '.data.cacheDir | startswith("'"$XDG_CACHE_HOME/prompt-registry"'")'
unset XDG_CACHE_HOME
```

---

## 24. `--help` matrix (and the I-019 gap)

| Command | `-h` | `--help` | Notes |
|---|---|---|---|
| `prompt-registry` | help | help | clipanion-managed |
| `prompt-registry hub list` | help | help | clipanion |
| `prompt-registry profile show <id>` | help | help | clipanion |
| `prompt-registry index` (bare) | ❌ fuzzy-match | ❌ fuzzy-match | I-021 |
| `prompt-registry index <verb>` | ⚠️ runs the verb | ⚠️ runs the verb | **I-019 — gap** |
| `prompt-registry index <verb> --help` | ⚠️ runs the verb | ⚠️ runs the verb | **I-019 — gap** |

Until I-019 is fixed, **never** use `--help` as a probe in CI for any
`index <verb>` — use `index <verb> -o json` and check `errors[0].code`
or `data.*` shape.

---

## 25. Envelope contract — error families

Every command emits the canonical envelope. Verify the contract for
representative error codes:

```bash
# Validate envelope shape.
ENVKEYS='. | keys == ["command","data","errors","meta","schemaVersion","status","warnings"]'

# Hub family.
$PR_BIN hub use nonsense -o json | jq -e "$ENVKEYS and .errors[0].code == \"HUB.NOT_FOUND\""
$PR_BIN hub add --type local --location /tmp --id default-local -o json \
  | jq -e ".errors[0].code == \"HUB.RESERVED_ID\""

# Profile family.
$PR_BIN profile activate ghost -o json | jq -e '.errors[0].code | startswith("PROFILE.") or startswith("USAGE.")'

# Index family — one assertion per code.
$PR_BIN index search --index /none --q x -o json | jq -e '.errors[0].code=="INDEX.NOT_FOUND"'
$PR_BIN index shortlist add --index "$IDX" --id sl_ghost --primitive p -o json | jq -e '.errors[0].code=="INDEX.SHORTLIST_NOT_FOUND"'
$PR_BIN index harvest -o json | jq -e '.errors[0].code=="USAGE.MISSING_FLAG"'

# Schema-stable on success too.
$PR_BIN hub list -o json | jq -e "$ENVKEYS and .status==\"ok\""
$PR_BIN target list -o json | jq -e "$ENVKEYS and .status==\"ok\""
# ⚠️ I-016 / I-022: target list returns data: [] (array) instead of
# data: { targets: [] }. Document the gap; do NOT branch script
# logic on .data.targets until that fixes.
```

`prompt-registry explain <code>` should produce a non-empty body
for every code; for the post-Phase-D `INDEX.*` codes it currently
returns a stub (I-022). CI should grep for "no catalog entry yet"
and warn — not fail — until the catalog is populated.

---

## 26. `doctor`

```bash
$PR_BIN doctor -o json | jq '.data.summary'
# expect: { status: "ok"|"warn"|"error", checks: [...] }

# Token-missing path (no env, no gh CLI).
unset GITHUB_TOKEN GH_TOKEN
PROMPT_REGISTRY_DISABLE_GH_CLI=1 \
  $PR_BIN doctor -o json | jq -e '.data.checks[] | select(.id=="github-auth") | .status' \
  | grep -E '"warn"|"error"'

# Bad cache dir (read-only).
ROCACHE=$(mktemp -d) && chmod 0500 "$ROCACHE"
PROMPT_REGISTRY_CACHE="$ROCACHE/cache" \
  $PR_BIN doctor -o json | jq -e '.data.checks[] | select(.id=="xdg-config") | .status' \
  | grep -E '"warn"|"error"'
chmod 0700 "$ROCACHE"; rm -rf "$ROCACHE"
```

---

## 27. `hub list --check` (I-007 fix)

```bash
# Stable case: every hub reachable → status ok.
$PR_BIN hub list --check -o json \
  | jq -e 'all(.data.hubs[]; .reachable == true)'

# Wedged case: rename a cached hub-config.yml so the next `--check`
# picks up an unreachable entry without touching the network.
mv "$XDG_CONFIG_HOME/prompt-registry/hubs/local-test-hub/hub-config.yml" \
   "$XDG_CONFIG_HOME/prompt-registry/hubs/local-test-hub/hub-config.yml.bak"
$PR_BIN hub list --check -o json \
  | jq -e '.data.hubs[] | select(.id=="local-test-hub") | .reachable == false'
mv "$XDG_CONFIG_HOME/prompt-registry/hubs/local-test-hub/hub-config.yml.bak" \
   "$XDG_CONFIG_HOME/prompt-registry/hubs/local-test-hub/hub-config.yml"
```

---

## 28. Cross-platform / TTY caveats

| Concern | Linux | macOS | Windows / Git-Bash |
|---|---|---|---|
| Default cache root | `$XDG_CACHE_HOME` → `~/.cache/prompt-registry` | `~/Library/Caches/prompt-registry`-style override via `PROMPT_REGISTRY_CACHE` | `%LOCALAPPDATA%\prompt-registry\cache` (untested in this plan; flag as gap) |
| §11 cross-process watch | `inotifywait` | `fswatch` | n/a — section §11 is POSIX-only |
| Quoting in §6 hub-config heredoc | `\$PR_TEST_ROOT` is *intentionally* expanded by the outer shell so the YAML carries an absolute path | identical | use `winpty` if `node` complains about TTY detection |
| `chmod 0500` in §26 | works | works | meaningless on NTFS — skip |

These caveats are sanity hooks; if the plan is run on a non-POSIX
host, the runner is expected to mark §11 / §26's chmod test as
"skipped" rather than "failed".

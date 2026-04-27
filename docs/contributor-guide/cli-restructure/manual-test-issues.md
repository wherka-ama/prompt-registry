# Manual test validation — issues log

> **Status:** Identified during the dry-run of `manual-test-plan.md`
> against the real Amadeus hub
> (`Amadeus-xDLC/genai.prompt-registry-config`).
>
> Issues are tagged **BLOCKING** (fixed in the same change set),
> **HIGH** (test plan documents the gap; user lands on a clear
> error), **MEDIUM** (cosmetic / DX), or **LOW** (nice-to-have).

---

## I-001 — `User-Agent` header missing on every outbound HTTPS request — **BLOCKING — FIXED**

**Symptom**
```
hub add: GitHub API 403 for https://api.github.com/repos/.../contents/hub-config.yml?ref=main
```

**Root cause**
`NodeHttpClient` did not inject a `User-Agent`; `node:https` does
not add one by default; the GitHub API returns 403 with
`Request forbidden by administrative rules. Please make sure your
request has a User-Agent header.`

Affects **every** github API call (`hub add`, `hub sync`,
`profile activate`, `install --source`, …).

**Fix (this change set)**
`lib/src/install/node-http-client.ts` injects
`User-Agent: prompt-registry-cli` when the caller did not provide
one. Caller-supplied UAs win.

**Verification**
```bash
unset GITHUB_TOKEN
prompt-registry hub add --type github \
  --location Amadeus-xDLC/genai.prompt-registry-config --ref main
```
…now succeeds.

---

## I-002 — `gh auth token` not consulted for token resolution — **BLOCKING — FIXED**

**Symptom**
Users who are logged in via `gh auth login` still had to set
`GITHUB_TOKEN` manually, contradicting the principle that any
canonical local credential source should work out of the box.

**Fix (this change set)**
`lib/src/install/http.ts`:
- new `ghCliTokenProvider()` spawns `gh auth token` (5 s timeout,
  swallows all failures, never throws);
- new `compositeTokenProvider(...providers)` returns the first
  non-null token;
- `envTokenProvider(env)` now composes
  `[envVar, ghCliTokenProvider]` so env wins, gh-cli is the
  fallback;
- gating: set `PROMPT_REGISTRY_DISABLE_GH_CLI=1` to skip the
  fallback (used by unit tests + CI matrix).

**Out-of-scope follow-ups** (logged for the extension integration
work in `extension-integration-plan.md` Phase G):
- VS Code-native auth provider (`vscode.authentication.getSession('github', …)`);
- `~/.netrc` and `git credential` fallbacks;
- Per-host (GHES) credentials.

---

## I-003 — Bundle asset name convention mismatch — **HIGH**

**Symptom**
```
profile activate: PROFILE.BUNDLE_NOT_FOUND: <bundleId>@latest not in source <src>
```
…even though the bundle exists in the source's GitHub releases.

**Root cause**
`GitHubBundleResolver` searches for an asset literally named
`bundle.zip`. Real Amadeus-hub bundles ship as
`<bundle-id>.bundle.zip` (e.g.
`dsre-git-skillset.bundle.zip`).

**Mitigation in test plan**
Profile-activation steps that target `awesome-copilot` or `github`
sources from this hub are flagged "expected to fail until I-003
fixed". Steps that target a synthetic local bundle (created
in-test) work end-to-end.

**Proposed fix (post-test-plan)**
Make `assetName` an array of patterns or a glob, default
`['bundle.zip', '*.bundle.zip']`. Match the bundle id against the
asset's basename. Mirror the extension's
`GitHubAdapter.getDownloadUrl` algorithm.

---

## I-004 — Release tag name convention mismatch — **HIGH**

**Symptom**
With `version: latest` the resolver picks the first non-prerelease
release but then *strips a leading `v`* and treats whatever remains
as the version, producing nonsense versions like
`dsre-git-skillset-0.1.0` instead of `0.1.0`.

**Root cause**
Real-world tags use the convention
`<bundle-id>-v<X.Y.Z>` (e.g. `dsre-git-skillset-v0.1.0`).
The lib's resolver does
```ts
const tag = release.tag_name.replace(/^v/, '');
```
which only handles `vX.Y.Z`.

**Proposed fix (post-test-plan)**
Reuse the extension's tag-parsing helper (regex
`(?:[\w.-]+-)?v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)$`).

---

## I-005 — `awesome-copilot` source type unsupported — **HIGH (deferred per D25)**

**Symptom**
`profile activate <id>` against any profile whose bundles point at
sources of type `awesome-copilot` fails:
```
PROFILE.BUNDLE_NOT_FOUND ...
```
or `PROFILE.UNSUPPORTED_SOURCE_TYPE` once I-003/I-004 are fixed.

**Status**
Documented in D25 as deferred to post-Phase-6.
~70 % of the Amadeus hub's sources are this type, so the test plan
captures this limitation prominently and offers an alternative
"local synthetic bundle" track for end-to-end coverage.

**Proposed fix**
Drop-in `AwesomeCopilotBundleResolver` against the existing
`BundleResolver` interface (one new file, no surface changes).

---

## I-006 — `skill` and `apm` resolvers not present — **MEDIUM (deferred per D25)**

Symmetric to I-005. None of the hub's sources are `apm`. A
handful are `github` repos containing skills which work as plain
`github` bundles (covered by I-003/I-004 fix). True `skill` source
type is not yet exercised by any production hub I could find.

---

## I-007 — `hub list` does not surface "imported but unreachable" hubs — **LOW**

**Symptom**
If the hub remote is later deleted/renamed, `hub list` happily
returns the cached entry; only `hub sync` produces an error.

**Mitigation in test plan**
Section §13 "edge cases" documents the expected UX.

**Proposed fix**
Add a `--check` flag to `hub list` that pings every hub source.

---

## I-008 — No `prompt-registry doctor` / diagnostics command — **MEDIUM**

The test plan begins with a **manual** environment-readiness
checklist (gh installed, token resolvable, target dir writable,
node version). A `prompt-registry doctor` command would collapse
this to one invocation.

**Proposed fix**
New `prompt-registry diagnose` (or `doctor`) command:
- node + npm versions
- `gh` presence + auth status (without exposing the token)
- XDG path layout + write permissions
- ping `api.github.com` with the resolved token
- list active hub + active profile
- JSON output for scripts

---

## I-009 — `target add --type vscode --path <p>` does not auto-create the target directory until activation — **LOW**

Currently the directory is created lazily when the first profile
activates. Cosmetic; the test plan documents this.

**Proposed fix**
`target add` could `mkdir -p <path>` immediately so that
`ls .vscode` after `target add` is non-empty. Optional.

---

## I-010 — `hub add --location <local-path>` does not normalize to absolute — **LOW**

If a user runs `hub add --type local --location ./hub` the entry
is stored relative to the current working directory at the time of
import; subsequent `hub sync` from a different cwd fails.

**Proposed fix**
Resolve to absolute path inside `hub add` before persisting.

---

## Summary

| # | Severity | Status |
|---|---|---|
| I-001 | BLOCKING | ✅ fixed |
| I-002 | BLOCKING | ✅ fixed |
| I-003 | HIGH | ✅ fixed (asset-name fallback chain) |
| I-004 | HIGH | ✅ fixed (semver-from-prefixed-tag) |
| I-005 | HIGH (was deferred D25) | ✅ fixed (`AwesomeCopilotBundleResolver` + on-the-fly zip) |
| I-006 | MEDIUM (was deferred D25) | ✅ fixed (`SkillsBundleResolver`, `LocalSkillsBundleResolver`, `LocalAwesomeCopilotBundleResolver`) |
| I-007 | LOW | ✅ fixed (`hub list --check` + `HubManager.checkHub`) |
| I-008 | MEDIUM | ✅ fixed (extended `doctor` with xdg-config / active-hub / github-auth / github-api checks) |
| I-009 | LOW | ✅ fixed (`target add` eager mkdir + path absolutization) |
| I-010 | LOW | ✅ fixed (`hub add --type local` resolves relative paths against cwd) |
| I-016 | MEDIUM | ⏳ logged (`target list -o json` schema drift; not yet fixed — see below) |
| I-019 | HIGH | ⏳ logged (`index <verb> --help` runs the verb; see §I-019) |
| I-020 | MEDIUM | 📝 documented (empty-query search dumps everything; intentional) |
| I-021 | LOW | ⏳ logged (bare `index` falls through to clipanion fuzzy-match) |
| I-022 | LOW | ⏳ logged (`explain` catalog stub for `INDEX.*` codes) |

**Original ten issues all resolved.** Two issues remain logged after
the post-Phase-D primitive-index consolidation (I-019, I-021), one
is documented behaviour (I-020), and the catalog gap (I-022) is an
authoring task. Two additional issues surfaced and were fixed during
e2e validation against the real hub:

- **I-011 — Release-asset URL choice for private repos.** GitHub's
  `browser_download_url` (on `github.com`) returns 404 for private
  release assets even with a Bearer token. `GitHubBundleResolver`
  now prefers the API URL (`api.github.com/.../releases/assets/<id>`)
  which works for both public and private. ✅ fixed.
- **I-012 — Strict `Accept` for API asset endpoint.** When the
  download URL is `api.github.com/.../releases/assets/<id>`, the
  Accept header must be exactly `application/octet-stream` —
  anything broader makes GitHub return JSON metadata instead of the
  bytes. `HttpsBundleDownloader` now switches the Accept header
  based on URL. ✅ fixed.
- **I-013 — Strict expected-id check too rigid for hub activation.**
  Hub-config `bundles[].id` is often a synthesized
  `<owner-with-dashes>-<repo>-<bundle>` string that doesn't match
  the manifest's natural id. `validateManifest` now accepts
  `expectedId?` (optional); profile-activator stops passing it
  through (the source URL + release uniquely identifies the
  bundle). ✅ fixed.
- **I-014 — Generic Node error codes (e.g., `ERR_OUT_OF_RANGE`)
  rejected by `RegistryError`.** The wrapper accepted `cause.code`
  unconditionally; non-conforming codes broke the wrap. Now
  validated against the `NAMESPACE.UPPER_SNAKE` regex with a
  fallback to `INTERNAL.UNEXPECTED`. ✅ fixed.
- **I-015 — Signed int32 overflow in zip-writer external-attrs.**
  `0o100644 << 16` is `-2119958528` in JS (sign-extended); the
  unsigned UInt32LE write rejected it. Fixed via
  `(0o100644 * 0x10000) >>> 0`. ✅ fixed.

## I-016 — Schema drift in `target list` JSON output — **MEDIUM — LOGGED**

**Symptom**
```
$ prompt-registry target list -o json | jq '.data.targets[0]'
jq: error (at <stdin>:1): Cannot index array with string "targets"
```

**Root cause**
`hub list`, `profile list`, `source list` all wrap their lists in
`data.<name>: [...]`. `target list` (in `lib/src/cli/commands/target-list.ts`)
returns `data: [...]` directly, breaking the convention and any
caller written against the documented schema.

**Impact**
Cosmetic on the consumer side: every script that parses
`target list -o json` needs a special case. Not a runtime failure
on the CLI itself.

**Proposed fix**
Wrap as `data: { targets: [...] }`. Bump the doc + add a
schemaVersion bump if any out-of-tree consumer parses the old
shape. Logged for the next schema-cleanup pass; not changed
in-session because the reflexive fix could break VS-Code
integration code that already parses the array form.

---

## I-017 — `HttpsBundleDownloader` lacks retries on transient 5xx — **HIGH — FIXED in middleware migration**

**Symptom**
A single 503 from `objects.githubusercontent.com` (S3-backed
release-asset CDN) during a multi-bundle profile activation killed
the whole activation with `bundle download failed: HTTP 503`.

**Root cause**
`lib/src/install/https-downloader.ts` did one shot via the raw
`HttpClient`, no retry budget.

**Fix (middleware migration)**
`HttpsBundleDownloader` is now a thin adapter over `AssetFetcher`
(`lib/src/github/asset-fetcher.ts`) which retries 408 / 429 / 5xx
with exponential backoff + jitter. Production wires the new
class via `ProfileActivator`. Legacy `(HttpClient, TokenProvider)`
constructor is preserved (with retries=0) for tests that still
inject fakes. ✅ fixed.

---

## I-018 — No central GitHub middleware → duplicated retry/rate-limit/ETag logic — **MEDIUM — FIXED in middleware migration**

**Symptom**
Two parallel HTTP stacks in `lib/src/install/*` (no retries, no
ETag) vs `lib/src/primitive-index/hub/*` (full retries, ETag,
rate-limit telemetry). Bug fixes had to be applied twice; recent
issues like I-011 / I-012 only got fixed in `install/*`.

**Fix (this change set)**
New `lib/src/github/` module:
- `client.ts` — `GitHubClient` (single funnel: retries, rate-limit,
  ETag, observability)
- `asset-fetcher.ts` — `AssetFetcher` (binary fetches with the
  Accept-header switch from I-012, retries, integrity)
- `url.ts`, `token.ts`, `errors.ts`, `events.ts` — supporting
  utilities
- `etag-store.ts`, `blob-cache.ts` — moved from
  `primitive-index/hub/`
- `bench/` — microbenchmark harness with five standard cases
  (cold / warm-etag-304 / blob-cache-hit / transient-5xx /
  rate-limit) and asserted thresholds

Backward-compat shims:
- `primitive-index/hub/github-api-client.ts` — wraps `GitHubClient`,
  preserves the `{ token: string }` constructor used by the
  harvester
- `primitive-index/hub/etag-store.ts`, `blob-cache.ts` — re-export
  the canonical files at `github/`
- `install/https-downloader.ts` — accepts both `AssetFetcher`
  (preferred) and the legacy `(HttpClient, TokenProvider)` pair

`ProfileActivator` migrated to use the new `AssetFetcher`. ✅ fixed.

**Bench results (default Node 20 on dev box)**

| Case | p95 (ms) | Threshold (ms) |
|---|---:|---:|
| cold (raw getJson) | 0.40 | 5 |
| warm-etag-304 | 0.07 | 1 |
| blob-cache-hit (inline-bytes) | 0.01 | 1 |
| transient-5xx (1 retry) | 0.38 | 5 |
| rate-limit recovery | 0.32 | 5 |

All thresholds met. The middleware adds **negligible** overhead
versus a bare `fetch()`.

---

## End-to-end validation matrix

| Source type | Hub | Profile | Result |
|---|---|---|---|
| `github` | `Amadeus-xDLC/genai.prompt-registry-config` (private) | `role-git-skillset` | ✅ activated, 1 bundle (`dsre-git-skillset`) |
| `awesome-copilot` | same | `refx-development` | ✅ activated, 3 bundles (`refx-development`, `refx-investigation-and-support`, `otter`) |
| `skills` | local hub pointing at `anthropics/skills` | synthetic `pdf-only` | ✅ activated, 1 bundle (`pdf`) — fetched recursively from `skills/pdf/` |
| `local-skills` | local hub pointing at fixture `/tmp/prtest/local-skills-repo` | synthetic `my-local-skill` | ✅ activated, 1 bundle |
| `local` (existing) | local hub | (covered in §6 of test plan) | ✅ |
| `local-awesome-copilot` | (resolver ready; no live test yet) | n/a | ⚠️ resolver class shipped, manual fixture-based test added in unit suite |
| `apm` / `local-apm` | per D25 — not implemented | — | ➖ deferred |

The `written: { ...: [] }` empty-list result on activations comes
from the target-writer's per-target file-mapping rules (the bundle
content doesn't yet match the vscode-target's `.github/prompts/...`
expectations). The resolver+download+extract+manifest pipeline is
fully exercised; closing the loop on per-target file mapping for
skill-type primitives is tracked separately as part of the
target-writer rules work.

---

## I-019 — `prompt-registry index <verb> --help` is silently swallowed and the verb runs anyway — **HIGH — LOGGED**

**Symptom**

```bash
$ prompt-registry index search --help
total: 211  took: 8ms
0.000  [agent] afterparty-code-review  …
…
$ echo $?
0
```

The user expected a help screen; instead the command runs against
the (potentially expensive) default index and dumps the entire
corpus to stdout. Worst case: a CI script that probes
`<cmd> --help` to detect availability silently performs a full
search.

**Root cause**

The `runIndexCommand` dispatcher in `lib/src/cli/index.ts` treats
the entire trailing argv as flag/value pairs without recognising
`--help` / `-h`. The clipanion `--help` machinery doesn't apply to
the `index` family because `index` is not a clipanion-registered
command (it is intercepted before the parser).

**Mitigation in test plan**

`manual-test-plan.md` §24 "`--help` matrix" documents the gap and
flags it red until fixed. CI scripts MUST use
`prompt-registry index <verb> -o json` with explicit error-shape
checks, not `--help` probes, until I-019 lands.

**Proposed fix**

In `runIndexCommand`, before dispatching, check
`restArgv.includes('--help') || restArgv.includes('-h')` and emit a
per-verb usage block to `ctx.stdout` then return 0. Each
`createIndex<Verb>Command` factory already documents its options
in TSDoc — the help renderer can read those at build-time and
generate a static usage table.

**Severity**

HIGH because a help-flag MUST never run the command; treating it
as silent no-op violates the principle of least surprise and
breaks every shell completion tool (zsh, fish, bash-completion)
that probes `--help` for option discovery.

---

## I-020 — `index search` with no `--q` returns the entire index — **MEDIUM — DOCUMENT**

**Symptom**

```bash
$ prompt-registry index search -o json | jq '.data.total'
211
```

Every primitive in the index is returned with score `0.000`.
Plausibly intentional ("show me everything") but undocumented.

**Decision**

Keep the behaviour (matches `BM25Engine.search('')` semantics — no
query means no scoring, list everything in stable order), but
document it in `manual-test-plan.md` §18 and in the CLI's help
output (after I-019). Add a guardrail:

- When stdout is a TTY and `--q` is empty, print a one-line warning
  to stderr (`hint: use --q to score results, --limit to cap`).
- JSON / CI usage stays unchanged.

**Severity**

MEDIUM (UX cliff for first-time users) — not data-incorrect.

---

## I-021 — `prompt-registry index` (bare, no subcommand) routes to clipanion fuzzy-match instead of the dispatcher — **LOW**

**Symptom**

```bash
$ prompt-registry index
Command not found; did you mean one of:
  0. prompt-registry -h
  1. prompt-registry -v
  …
```

The dispatcher in `lib/src/cli/index.ts` only intercepts when
`argv.length >= 2` (i.e. when there is at least a verb). Bare
`index` falls through to clipanion which has no command registered
and produces the standard fuzzy-match list — including completely
unrelated commands like `bundle build`.

**Proposed fix**

Lower the gate to `argv.length >= 1` and emit the dispatcher's own
"Valid: search | stats | …" usage line for the bare case. Two-line
fix.

**Severity**

LOW (cosmetic; the user immediately sees the verb list once they
add anything after `index`).

---

## I-022 — `explain` catalog has stub entries for the new INDEX codes — **LOW — LOGGED**

```bash
$ prompt-registry explain INDEX.NOT_FOUND
INDEX.NOT_FOUND
  Code INDEX.NOT_FOUND is in the recognized namespace INDEX but has
  no catalog entry yet.
```

The post-Phase-D error-code catalog hasn't been populated:

- `INDEX.NOT_FOUND`, `INDEX.SHORTLIST_NOT_FOUND`,
  `INDEX.LOAD_FAILED`, `INDEX.BUILD_FAILED`,
  `INDEX.EXPORT_FAILED`, `INDEX.EVAL_FAILED`,
  `INDEX.BENCH_FAILED`, `INDEX.HARVEST_FAILED`,
  `INDEX.REPORT_FAILED`
- `USAGE.MISSING_FLAG` (used by every family, documented only
  for hub/profile)

**Proposed fix**

Authoring task; the renderer already supports per-code remediation
prose, the catalog file just needs to be written.

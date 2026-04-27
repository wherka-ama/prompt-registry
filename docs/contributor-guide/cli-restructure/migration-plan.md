# Migration plan: 11 standalone binaries → `prompt-registry` subcommands

> Companion to `spec.md` §13. Authored in iter 29; locked at iter 30 with the rest of Phase 1 sign-off.
>
> **Update (post-Phase-D, primitive-index consolidation):** the
> `primitive-index` row in §2 has shifted from "shim with argv-rewriting"
> to **"binary removed; `index <verb>` is native to `prompt-registry`"**.
> See §2.1 below — the rest of the lifecycle (§4–§8) still applies
> verbatim to the other ten binaries.

## 1. Scope

This document covers the lifecycle of the eleven `lib/bin/*.js` scripts as they migrate into a single `prompt-registry` binary. It does **not** cover the framework-adapter implementation (`lib/src/cli/framework/`) — that is Phase 2 work.

## 2. Per-binary migration table

| # | Old binary | New subcommand | Argv translation |
|---|---|---|---|
| 1 | `validate-collections` | `prompt-registry collection validate` | Pass-through |
| 2 | `validate-skills` | `prompt-registry skill validate` | Pass-through |
| 3 | `build-collection-bundle` | `prompt-registry bundle build` | Pass-through |
| 4 | `compute-collection-version` | `prompt-registry version compute` | Pass-through |
| 5 | `detect-affected-collections` | `prompt-registry collection affected` | Pass-through |
| 6 | `generate-manifest` | `prompt-registry bundle manifest` | Pass-through |
| 7 | `publish-collections` | `prompt-registry collection publish` | Pass-through |
| 8 | `list-collections` | `prompt-registry collection list` | Pass-through |
| 9 | `create-skill` | `prompt-registry skill new` | Pass-through |
| 10 | `hub-release-analyzer` | `prompt-registry hub analyze` | Pass-through |
| 11 | `primitive-index` | `prompt-registry index <verb>` | **Removed** — see §2.1 |

"Pass-through" means the shim invokes `runCli(['<noun>', '<verb>', ...process.argv.slice(2)])` without modifying the user's flags or positionals.

## 2.1 Special case: `primitive-index` (no shim, native dispatch)

The `primitive-index` module was brand-new in this repo (no external
consumers, no semantic-versioned releases). Carrying a deprecation
shim would have shipped dead code into v1, so the migration was
short-circuited:

- The standalone `lib/bin/primitive-index.js` binary was **deleted**
  (not just deprecated). The corresponding entry in
  `lib/package.json#bin` is gone.
- The legacy `lib/src/primitive-index/cli.ts` (742 LOC, hand-rolled
  argv parser, bespoke JSON envelope) was **deleted**. The 9 verbs
  (`search`, `stats`, `build`, `shortlist {new,add,remove,list}`,
  `export`, `eval`, `bench`, `harvest`, `report`) are each implemented
  as a framework command at `lib/src/cli/commands/index-<verb>.ts`.
- `lib/src/cli/index.ts` intercepts `argv[0] === 'index'` *before*
  clipanion sees it and routes to `runIndexCommand(argv, ctx)`, which
  parses flags + invokes the right `createIndex<Verb>Command(...)`
  factory. No clipanion command is registered for `index` — the
  dispatcher fully owns that subtree.

User-facing impact:

- `prompt-registry index <verb> [...]` is the **only** supported form;
  there is no `primitive-index` binary to fall back to.
- The legacy `--json` flag is replaced by `-o json|yaml|ndjson|text`
  (canonical envelope). Legacy short-flag aliases (`-q`, `-k`, …) are
  preserved by the dispatcher for `index search`.
- Every error surfaces as an envelope with a namespaced code:
  `INDEX.NOT_FOUND`, `INDEX.SHORTLIST_NOT_FOUND`,
  `INDEX.HARVEST_FAILED`, `USAGE.MISSING_FLAG`, etc. See
  `manual-test-plan.md` §17–§22 for the full coverage matrix.

Docs that previously referenced the standalone binary
(`docs/user-guide/primitive-index.md`,
`lib/src/primitive-index/skill/SKILL.md`) were rewritten in the same
change-set.

## 3. Shim implementation pattern

Every shim is a 6-line file in `lib/bin/<old-name>.js`:

```js
#!/usr/bin/env node
// shim: <old-name> → prompt-registry <noun> <verb>
// Deprecated: will be removed in v<X+2> per migration-plan.md §5.
const { runCli } = require("../dist/cli/run.js");
runCli(["<noun>", "<verb>", ...process.argv.slice(2)]);
```

Shims are checked in to git but generated from a single source of truth: a `lib/bin/_shims.json` manifest mapping each old binary to its `[noun, verb]` pair. A small build script (`lib/bin/_generate-shims.js`, Phase 4 deliverable) regenerates every shim from the manifest. This prevents drift between shims and keeps each one trivially auditable.

> For `primitive-index` there is **no shim** (see §2.1). The
> `_shims.json` manifest does not include row 11; the dispatcher in
> `lib/src/cli/index.ts` is the single source of truth.

## 4. Deprecation lifecycle

| Phase | Shim status | Warning level | Exit on deprecation | User-facing message |
|---|---|---|---|---|
| Phase 4 ship | Active | `debug` | 0 | None unless `--log-level debug` |
| Phase 4 + 1 minor | Active | `info` | 0 | "Note: <old> is now <new>." |
| Phase 5 ship | Active | `warn` | 0 (configurable via `--exit-on-deprecation`) | "DeprecationWarning: <old> is deprecated. Use: <new>. Migration guide: …" |
| Phase 5 + 1 minor | Active | `warn` | 75 (`EX_TEMPFAIL`) when stdout is non-TTY | Same as above; CI scripts now fail unless updated |
| Next major (v\<X+2\>) | **Removed** | n/a | 127 (command not found) | Shell error; user must migrate |

Each warning carries:

- The old binary name.
- The exact replacement subcommand.
- A link to `docs/migration-guide.md` (anchor: `#<old-name>`).
- A reference to `prompt-registry --explain` for any error codes the user might encounter mid-migration.

## 5. npm-package version policy

| Event | Bump |
|---|---|
| Phase 1 sign-off (this work) | none (docs PR) |
| Phase 2 ship (framework adapter) | minor |
| Phase 4 ship (all subcommands wired, shims active) | minor |
| Phase 5 ship (deprecation warnings escalate to `warn`) | minor |
| Shim removal (next major) | **major** |

The major bump aligns with the shim removal. The release notes for that major version embed the migration guide at the top of the README so users running `npm view <pkg>` see it immediately.

## 6. Test strategy for shims

### 6.1 Per-shim contract test (every shim)

```typescript
import { expect } from 'chai';
import sinon from 'sinon';

describe('shim: validate-collections', () => {
  it('delegates to prompt-registry collection validate with passed-through argv', () => {
    const runCli = sinon.stub();
    proxyquire('../bin/validate-collections.js', { '../dist/cli/run.js': { runCli } });
    process.argv = ['node', 'validate-collections', '--strict', './my-collection'];
    require('../bin/validate-collections.js');
    expect(runCli).to.have.been.calledOnceWith(['collection', 'validate', '--strict', './my-collection']);
  });
});
```

One file per shim, ~10 LOC each. Total: 11 contract tests. CI cost: <1 second.

### 6.2 Representative E2E (3 shims)

Pick three by usage frequency (informed by analytics from `analytics-output/`):

- The most-invoked authoring shim (likely `validate-collections`).
- The most-invoked CI shim (likely `compute-collection-version`).
- ~~`primitive-index` (because of its argv-rewriting specialness)~~
  → replaced by **two** alternative checks since `primitive-index` no
  longer has a shim:
  - **2a:** `prompt-registry index --version`-style smoke (any
  `prompt-registry index <verb> -o json` returns a valid envelope).
  Covered by `test/cli/integration/all-commands.test.ts`.
  - **2b:** `runIndexCommand` dispatcher behaviour: unknown
  subcommand exits 64; missing-flag yields `USAGE.MISSING_FLAG` in
  the envelope. Covered by
  `test/cli/commands/index-{harvest,export,eval,bench}.test.ts`.

For each remaining shim:

```typescript
it('shim output matches prompt-registry output', async () => {
  const shimResult = await execa('./bin/validate-collections.js', ['./fixtures/sample']);
  const directResult = await execa('./bin/prompt-registry.js', ['collection', 'validate', './fixtures/sample']);
  expect(shimResult.stdout).to.equal(directResult.stdout);
  expect(shimResult.exitCode).to.equal(directResult.exitCode);
});
```

CI cost: ~10 seconds for three subprocess pairs. Acceptable.

### 6.3 Downstream consumer audit

A periodic CI job (weekly, not per-PR) greps the GitHub search API for repositories importing any of the 11 old binaries by name. If new consumers appear, the migration guide gets a callout PR linking the discovered repo for outreach.

## 7. Migration-guide content (`docs/migration-guide.md`)

The guide is authored alongside the Phase 4 ship and structured as one section per old binary. Each section contains:

```markdown
### `validate-collections`

**New command**: `prompt-registry collection validate`

**Flag changes**:

| Old flag | New flag | Notes |
|---|---|---|
| `--strict-mode` | `--strict` | Old form supported through Phase 5 with deprecation warning. |
| `--json` | `--output json` | Old form is a deprecated alias; see §9.1. |

**Before**:
```bash
validate-collections --strict-mode --json ./collections
```

**After**:
```bash
prompt-registry collection validate --strict --output json ./collections
```

**Common errors during migration**:

- `cli.flag.unknown` if you mistype a flag → run `prompt-registry collection validate --help` or `prompt-registry --explain cli.flag.unknown`.
- `config.profile.unknown` if you have a `--profile` set in CI → ensure your config has the profile defined.
```

This pattern repeats for all 11 binaries.

## 8. Rollback contingencies

If post-Phase-5 telemetry shows that a critical CI consumer cannot migrate before the removal milestone:

1. Push the major bump back by one release cycle.
2. Add a forced shell-warning even at `silent` log level for that specific binary.
3. Reach out to the consumer directly with a migration-PR draft.

This contingency is the reason for the `--exit-on-deprecation` flag and the lifecycle's gradual escalation: at every step, both the maintainer (us) and the consumer (CI scripts) get advance notice and a reversible adjustment lever.

## 9. Sign-off

This plan is locked at iter 30 with Phase 1. Modifications during Phase 4 / Phase 5 must be PR'd against this file with a reference back to the iteration where the change is justified. The iteration log in `iterations.md` is the single source of truth for "why did we change this?"

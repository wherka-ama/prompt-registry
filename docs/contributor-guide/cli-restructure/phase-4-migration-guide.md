# Phase 4 — Migration guide for the unified `prompt-registry` CLI

> Status: **Phase 4 in progress** (iter 14 of 50). All 11 legacy
> binaries are reachable through the unified CLI; per-iter polish
> continues.

## TL;DR

The eleven `lib/bin/*.js` scripts are now reachable through a single
binary, `prompt-registry`. The legacy entry points still work and emit
deprecation warnings to stderr; they will be removed one major version
after Phase 5.

## Command map

| Legacy binary | New command | Migration kind |
|---|---|---|
| `list-collections` | `prompt-registry collection list` | Native (iter 1) |
| `validate-collections` | `prompt-registry collection validate` | Native (iter 2) |
| `detect-affected-collections` | `prompt-registry collection affected` | Native (iter 3) |
| `compute-collection-version` | `prompt-registry version compute` | Native (iter 4) |
| `create-skill` | `prompt-registry skill new` | Native (iter 5) |
| `validate-skills` | `prompt-registry skill validate` | Native (iter 6) |
| `generate-manifest` | `prompt-registry bundle manifest` | Native (iter 7) |
| `build-collection-bundle` | `prompt-registry bundle build` | Native (iter 10) |
| `primitive-index <verb>` | `prompt-registry index <verb>` | Proxy (iter 12) |
| `hub-release-analyzer` | `prompt-registry hub analyze` | Proxy (iter 13) |
| `publish-collections` | `prompt-registry collection publish` | Proxy (iter 13) |

**Native** = ported into the framework with a TypeScript subcommand,
JSON envelope output, and `RegistryError` codes.

**Proxy** = the unified CLI dispatches to the legacy `bin/<name>.js`
script verbatim. Argv is passed through unchanged. Native ports of
the proxied commands are scheduled for Phase 4 iters 15-50.

## Output formats

Native commands accept `-o <fmt>` / `--output <fmt>` with values:
`text` (default, human-readable), `json` (stable envelope per spec
§9.1.1), `yaml` (envelope as YAML), `ndjson` (one record per line for
`jq` pipelines).

The JSON envelope shape is:

```json
{
  "schemaVersion": 1,
  "command": "<dotted.path>",
  "status": "ok" | "error" | "warning",
  "data": <command-specific payload>,
  "warnings": [...string],
  "errors": [{ "code": "NS.CODE", "message": "..." }, ...],
  "meta": { ... }
}
```

Proxy commands keep their legacy output (typically JSON-only or a
mix of `console.log`/`console.error`).

## Flag changes

| Legacy flag | New flag | Notes |
|---|---|---|
| `--collection-file` | `--collection-file` | Unchanged |
| `--changed-path` | `--changed-path` | Repeatable; unchanged |
| `--out` (generate-manifest) | `--out` or `--out-file` | Both accepted |
| `--out-dir` (build-collection-bundle) | `--out-dir` | Unchanged |
| `--repo-slug` | `--repo-slug` | Falls back to `GITHUB_REPOSITORY` env |
| `--skill-name` (positional in legacy create-skill) | `--skill-name` | Now a flag |
| `--description` (legacy create-skill) | `--description` | Unchanged |
| `--skills-dir` | `--skills-dir` | Unchanged |
| `--verbose` / `-v` | `--verbose` / `-v` | Unchanged |
| `--json` | `-o json` | Legacy `--json` not recognized; pass `-o json` instead |
| `--output-markdown FILE` (validate-collections) | `--markdown FILE` | Renamed for consistency |

Legacy positional args are translated by the shim. Example:
`generate-manifest 1.0.0 --collection-file foo.yml` becomes
`prompt-registry bundle manifest --version 1.0.0 --collection-file foo.yml`.

## Exit codes

Native commands emit one of:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Application error (validation failed, collection missing, etc.) |
| 64 (EX_USAGE) | Unknown command or invalid flags |
| 70 (EX_SOFTWARE) | Internal/unexpected error in the framework |

`RegistryError` instances carry a structured code (`BUNDLE.NOT_FOUND`,
`FS.NOT_FOUND`, `USAGE.MISSING_FLAG`, etc.) that is preserved in the
JSON envelope's `errors[].code` field. Spec §10 / decision D5 lists
the eleven locked namespaces: `BUNDLE`, `INDEX`, `HUB`, `PRIMITIVE`,
`CONFIG`, `NETWORK`, `AUTH`, `FS`, `PLUGIN`, `USAGE`, `INTERNAL`.

## Deprecation timeline (per spec D6)

1. **Now (Phase 4)**: Legacy binaries print a deprecation warning
   to stderr on every invocation, then run normally. Documented as
   the migration window.
2. **Phase 5**: The CLI gains the `install` command and target
   abstraction. Legacy binaries continue to work; warnings remain.
3. **Next major version after Phase 5**: Legacy binaries removed.
   Direct invocations of `validate-collections` etc. will fail with
   "command not found"; users must update CI scripts to call
   `prompt-registry <noun> <verb>` instead.

## Quick recipes

### Validate every collection in a repo

```bash
prompt-registry collection validate
prompt-registry collection validate -o json | jq '.data.fileResults[] | select(.ok == false)'
```

### Build a bundle in CI

```bash
prompt-registry bundle build \
  --collection-file collections/foo.collection.yml \
  --version 1.2.3 \
  --repo-slug "${GITHUB_REPOSITORY//\//-}" \
  -o json
```

### Search the primitive index

```bash
prompt-registry index search -q 'code review' --limit 10
```

### Run the doctor

```bash
prompt-registry doctor                   # text summary
prompt-registry doctor -o json | jq .data.summary
```

## Known gaps (tracked for Phase 4 iters 15+)

1. **`hub analyze` and `collection publish` are proxies**, not native
   commands. They keep their legacy output format and don't yet
   participate in the JSON envelope.
2. **`index <verb>` is a proxy** to the existing primitive-index CLI.
   Per-verb migration to native commands is iter 18-30 work.
3. **`--json` legacy alias** is not yet recognized by native commands.
   Iter 16 may add it as a deprecated alias for `-o json`.
4. **`--explain <code>`** for error code documentation is in the spec
   but not yet implemented (Phase 5).

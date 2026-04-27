# Spec: Primitive Index shortlist CLI UX hardening

## Background

Users invoking:

```bash
primitive-index shortlist
```

were receiving:

```text
Unknown shortlist subcommand: undefined
```

This message is technically correct but not actionable. It also masked a
second issue: `shortlist --help` attempted to load the index file before
handling help, which could fail with an unrelated file error.

## Problem statement

The shortlist command should provide subcommand-specific guidance when
input is incomplete or invalid, and help paths must not depend on index
file availability.

## Goals

1. Calling `shortlist` without a subcommand is user-friendly.
2. `shortlist --help`, `shortlist -h`, and `shortlist help` always work
   without requiring `--index` or an existing index file.
3. Unknown shortlist subcommands return consistent guidance and exit code.
4. Behavior is covered by regression tests.

## Non-goals

- Changing shortlist data model or storage format.
- Adding new shortlist subcommands.
- Changing global CLI parser semantics beyond shortlist UX handling.

## Design

### 1) Validate shortlist command shape before index I/O

In `handleShortlist(sub, parsed)`:

- If help requested (`flags.help === true` or `sub === 'help'`):
  - print shortlist-specific usage to stdout
  - return `0`
- If subcommand is missing:
  - print `Missing shortlist subcommand.` + shortlist usage to stderr
  - return `2`
- If subcommand is unknown:
  - print `Unknown shortlist subcommand: <name>` + shortlist usage to stderr
  - return `2`
- Only after those checks, resolve/load index and execute `new/add/remove/list`.

### 2) Add a shortlist-only usage renderer

Introduce `printShortlistUsage(stream)` in CLI module to avoid dumping
full top-level help for a shortlist-only mistake.

### 3) Tests (TDD)

Add/extend tests in `lib/test/primitive-index/cli.test.ts`:

- `shortlist` => exit `2`, stderr includes `Missing shortlist subcommand` and `shortlist <subcommand>`.
- `shortlist --help` => exit `0`, usage in stdout, empty stderr, works with missing index file.
- `shortlist -h` => same as `--help`.
- `shortlist help` => same as `--help`.
- `shortlist <unknown>` => exit `2`, includes unknown-subcommand message and shortlist usage.

## Acceptance criteria

- Manual repro no longer prints `Unknown shortlist subcommand: undefined`.
- Help paths are index-independent.
- New and existing CLI tests pass.
- User docs mention shortlist help behavior.

## Rollout / risk

Low risk. Change is isolated to shortlist command dispatch and output
text. No schema, storage, or network behavior change.

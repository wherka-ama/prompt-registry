# OctoStream Design (v1)

## Context

This design is based on the captured session in `.tmp/RATINGS_LIB_DESIGN.md` and scoped to `lib/` inside `@prompt-registry/collection-scripts`.

> **Project Identity**
> **Name:** OctoStream  
> **Description:** OctoStream transforms GitHub Discussions into a scalable, observable, pluggable event streaming system — designed to grow from GitHub-native automation to full-scale distributed queues.

## Goals

1. Treat GitHub Discussion comments as an append-only event log.
2. Provide idempotent processing via cursor checkpointing.
3. Keep the core transport-agnostic (pluggable event sources/handlers).
4. Include first-class observability (structured logs + metrics).
5. Provide failure isolation with retry and dead-letter sink support.
6. Provide sharding helpers for horizontal scaling.
7. Provide realistic traffic simulation utilities for load testing.

## Non-Goals (v1)

1. No full GitHub Action packaging in `lib/` itself.
2. No hard dependency on OpenTelemetry SDK.
3. No external queue adapter implementations (Kafka/SQS/Redis) yet.
4. No persistent deduplication store (exactly-once is out of scope).

## Architecture

```text
GitHub Discussions (append-only comments)
        |
        v
GitHubDiscussionEventSource  ----> Repository Variable Cursor Store
        |
        v
OctoStreamEngine
  |- retry policy
  |- metrics
  |- structured logs
  |- dead-letter sink (optional)
        |
        v
EventHandler (custom business logic)
```

## Core Contracts

- `OctoStreamEventSource`
  - `getCursor()`
  - `fetchPage(cursor?)`
  - `commitCursor(cursor)`
- `OctoStreamEventHandler`
  - `handle(event)`
- `OctoStreamDeadLetterSink`
  - `send(record)`

This keeps engine logic independent from GitHub specifics.

## Idempotency Model

Page-level two-phase commit:

1. Read last cursor.
2. Fetch next page after cursor.
3. Process all events in the page.
4. Commit page `endCursor`.
5. Repeat.

If a run crashes, already committed pages remain durable. Current page may be replayed (at-least-once behavior).

## Failure Model

Per-event retry (`withRetry`) and optional dead-letter emission:

- Retry up to `N` attempts.
- If still failing:
  - push to DLQ sink (if configured),
  - continue or fail-fast based on engine options.

## Observability Model

- Structured JSON logger (`jsonConsoleLogger`).
- In-memory metrics collector (`OctoStreamMetrics`) with:
  - counters,
  - timing aggregates,
  - per-run snapshot.

## GitHub Adapter Model

`GitHubDiscussionsClient` provides:

- Discussion lookup.
- Discussion comment pagination via GraphQL.
- Repository variable get/set for cursor persistence.
- Comment posting for simulation/DLQ.

`GitHubDiscussionEventSource` maps this client to `OctoStreamEventSource`.

## Scaling Model

- Cursor-based incremental processing: O(new events).
- Sharding utility:
  - `shardForKey(key, shardCount)`
  - `selectShardDiscussion(key, discussionNumbers)`

## Security & Safety

- No raw code execution from comments.
- Handler owns payload validation.
- Clear boundaries for token usage (GitHub API only).

## Plan

1. Add OctoStream core module under `lib/src/octostream.ts`.
2. Export public APIs from `lib/src/index.ts`.
3. Add unit tests in `lib/test/octostream.test.ts`.
4. Update `lib/README.md` with usage snippet.
5. Update `docs/author-guide/collection-scripts.md` with OctoStream API mention.
6. Run `lib` test suite to validate behavior.

## Minimal Public API (v1)

- Engine and contracts:
  - `OctoStreamEngine`
  - `OctoStreamEventSource`
  - `OctoStreamEventHandler`
  - `OctoStreamDeadLetterSink`
- Observability:
  - `OctoStreamMetrics`
  - `jsonConsoleLogger`
- Reliability/scaling helpers:
  - `withRetry`
  - `createRepoVariableName`
  - `buildDiscussionConcurrencyGroup`
  - `shardForKey`
  - `selectShardDiscussion`
- Simulation:
  - `generateSyntheticPayload`
  - `simulateTraffic`
- GitHub integration:
  - `GitHubDiscussionsClient`
  - `GitHubDiscussionEventSource`
  - `GitHubDiscussionDeadLetterSink`

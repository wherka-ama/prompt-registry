# OctoStream E2E Scenarios for Ratings/Feedback (GitHub Discussions)

## 1) Goal

Design end-to-end scenarios to validate how **OctoStream** can process the engagement flow introduced in branch `feature/telemetry-feedback-rating-clean` / PR #153, with focus on:

1. 5-star rating
2. Simple feedback comment
3. Real GitHub Discussions execution
4. Telemetry as secondary validation

Scope remains in `lib/`.

---

## 2) What PR #153 introduced (intent summary)

The PR intent is an engagement loop with:

- user submits rating + optional feedback,
- feedback is posted to GitHub Discussions,
- ratings are computed from comments into `ratings.json`,
- UI consumes `ratings.json` and shows stars/vote count.

Important behavior that impacts E2E design:

- Rating comment format includes `Rating: ⭐⭐⭐⭐⭐` (new format).
- Ratings are deduplicated per author by most recent comment.
- `rating_count` tracks number of star ratings (not reaction count).
- Source ID mapping is needed between `ratings.json` and extension source IDs.

---

## 3) Mapped data flows relevant for lib + OctoStream

### Flow A: Discussion provisioning

1. `setup-discussions` creates one discussion per bundle and emits `collections.yaml` mapping (`source_id`, `discussion_number`) @lib/src/setup-discussions.ts#418-553.
2. Discussion body currently documents thumbs reactions + free-form feedback @lib/src/setup-discussions.ts#384-413.

### Flow B: Rating extraction and aggregation

1. `compute-ratings` fetches discussion comments via GraphQL paging.
2. Parses stars from comment body (`Rating: ⭐⭐⭐⭐⭐` and legacy formats) @lib/src/compute-ratings.ts#148-185.
3. Deduplicates by author, keeps latest rating @lib/src/compute-ratings.ts#196-231.
4. Computes average 1..5, confidence, and `rating_count` @lib/src/compute-ratings.ts#238-255 and @lib/src/compute-ratings.ts#667-734.

### Flow C: OctoStream processing model

1. `GitHubDiscussionEventSource` reads comments as append-only pages and persists cursor in repository variables @lib/src/octostream.ts#761-793.
2. `OctoStreamEngine` processes page events with retry, metrics, and optional DLQ @lib/src/octostream.ts#208-347.
3. Idempotency is page-cursor based (replay-safe if handler is idempotent).

---

## 4) OctoStream simulation strategy for this context

For E2E, we simulate PR #153 behavior by treating each discussion comment as an event:

- Event source: `GitHubDiscussionEventSource`
- Event payload: GitHub comment body
- Parser: reuse star-rating extraction semantics (`Rating: ⭐...`)
- Projection: in-test in-memory aggregate `{ bundleId -> average, rating_count, confidence }`
- Cursor storage: repo Actions variable prefix per test run

This validates incremental/event-driven ingestion against current batch-style `compute-ratings` logic.

---

## 5) E2E scenario catalog

## Scenario E2E-01: Bootstrap + baseline

**Objective**: Verify environment and zero-rating baseline.

- Arrange:
  - Run `setup-discussions` for a test hub or fixture hub.
  - Select one bundle discussion from generated `collections.yaml`.
- Act:
  - Run OctoStream engine once with empty/new cursor.
- Assert:
  - No failures.
  - `processedEvents >= 0`, `lastCommittedCursor` set when comments exist.
  - Projection for bundle has `rating_count = 0` if no star comments.

## Scenario E2E-02: Single 5-star + simple feedback

**Objective**: Core happy path for this request.

- Arrange:
  - Post one comment in target discussion:
    - `Rating: ⭐⭐⭐⭐⭐`
    - `Feedback: Works great`
    - `---`
    - `Version: test`
- Act:
  - Run engine from current cursor.
- Assert:
  - Exactly one new event processed.
  - Projection shows `average = 5.0`, `rating_count = 1`.
  - Cursor advanced.

## Scenario E2E-03: Idempotency on rerun

**Objective**: No duplicate counting after cursor commit.

- Arrange:
  - Use same setup as E2E-02 after first successful run.
- Act:
  - Run engine again immediately.
- Assert:
  - `processedEvents = 0` (or no change in projection).
  - Aggregate remains `5.0 / count 1`.

## Scenario E2E-04: Latest-rating-wins per author

**Objective**: Match dedup behavior from `compute-ratings`.

- Arrange:
  - Same user posts two comments over time:
    1. `Rating: ⭐⭐⭐`
    2. `Rating: ⭐⭐⭐⭐⭐`
- Act:
  - Process both events.
- Assert:
  - Effective rating for that author is 5.
  - `rating_count` for that author remains 1.

## Scenario E2E-05: Multi-user average + confidence

**Objective**: Validate average and confidence shaping.

- Arrange:
  - Post ratings from multiple accounts/users: 5, 5, 4, 5, 5.
- Act:
  - Process incrementally.
- Assert:
  - Average equals expected rounded value.
  - `rating_count` reflects unique users.
  - Confidence transitions according to thresholds used in lib logic.

## Scenario E2E-06: Non-rating comments ignored

**Objective**: Ensure plain feedback without rating does not alter stars.

- Arrange:
  - Post comment like `Feedback: Nice docs` (no `Rating:` line).
- Act:
  - Process new events.
- Assert:
  - `rating_count` unchanged.
  - Event still processed, but parser yields no rating update.

## Scenario E2E-07: Handler failure isolation + DLQ

**Objective**: Validate robustness under malformed/forced failures.

- Arrange:
  - Configure handler to throw for comments containing marker `__FAIL_ME__`.
  - Configure dead-letter sink discussion.
- Act:
  - Process batch with one failing event and one valid 5-star event.
- Assert:
  - Failing event sent to DLQ.
  - Valid event still contributes when `continueOnError=true`.
  - Metrics: `events_failed`, `dead_letter_sent` increment.

## Scenario E2E-08: Parity check vs `compute-ratings`

**Objective**: Confirm OctoStream projection matches current batch output.

- Arrange:
  - Freeze test data window (same discussion set, same comments).
- Act:
  - Run OctoStream projection.
  - Run `compute-ratings` on same `collections.yaml`.
- Assert:
  - For tested bundles, parity on:
    - `star_rating`
    - `rating_count`
    - confidence class

## Scenario E2E-09 (secondary): Telemetry capture does not block rating flow

**Objective**: Telemetry is secondary and non-blocking.

- Arrange:
  - Emit telemetry events in parallel to feedback submissions.
- Act:
  - Process ratings flow.
- Assert:
  - Rating pipeline unaffected by telemetry write/read delays.
  - Telemetry events remain queryable (if enabled in backend path).

---

## 6) Real GitHub Discussions setup for E2E

## Required secrets/env

- `GITHUB_TOKEN` with permissions:
  - Discussions read/write
  - Repository variables read/write (for cursor state)
- `OCTOSTREAM_TEST_OWNER`
- `OCTOSTREAM_TEST_REPO`
- `OCTOSTREAM_TEST_DISCUSSION_NUMBER` (or generated via setup)
- `OCTOSTREAM_CURSOR_PREFIX` (example: `OCTOSTREAM_E2E_RUN_20260217`)
- `OCTOSTREAM_DLQ_DISCUSSION_NUMBER` (for E2E-07)

## One-time preparation

1. Enable Discussions in test repo.
2. Create category for rating threads.
3. Generate mapping file with `setup-discussions`.
4. Keep test discussions isolated from production (separate repo/category).

## Run discipline

- Use unique run marker in every test comment body, e.g. `Run: e2e-<timestamp>`.
- Never delete historical comments; tests rely on append-only behavior.
- Isolate cursor variable prefix per run to avoid cross-run contamination.

---

## 7) Expected deliverables for implementation phase

When implementing these scenarios in code, deliver:

1. `lib/test/octostream.github-discussions.e2e.test.ts` (env-gated, skipped by default without secrets)
2. `lib/test/fixtures/e2e/` minimal fixtures (collections mapping, sample comments)
3. Optional helper: `lib/test/helpers/octostream-e2e.ts` for GitHub setup/assertions
4. CI-safe mode: unit/integration default only; real-GitHub E2E opt-in

---

## 8) Pass criteria

A scenario passes only if:

- event ingestion and cursor semantics are correct,
- computed 5-star outputs match expected values,
- dedup by author is correct,
- failure isolation behaves per configuration,
- reruns are idempotent,
- parity with `compute-ratings` holds for covered bundles.

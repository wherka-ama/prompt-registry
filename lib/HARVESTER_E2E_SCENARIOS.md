# OctoStream Data Harvester E2E Scenarios

This document describes the end-to-end test scenarios for the OctoStream Data Harvester workflow component.

## Design Philosophy

The harvester is designed for use in GitHub Actions workflows with these key assumptions:

1. **Privacy-first payloads**: All ratings use encrypted JSONL format with HMAC integrity
2. **Incremental processing**: Cursor-based checkpointing for efficient incremental aggregation
3. **Single-processing-unit guard**: Distributed locking prevents concurrent workflow runs
4. **Concurrent production**: Multiple VS Code users can submit ratings simultaneously
5. **Workflow simulation**: Tests mirror real GitHub Actions job behavior

## Environment Variables

E2E tests are opt-in via `HARVESTER_E2E_ENABLE=true` and require:

```bash
HARVESTER_E2E_ENABLE=true
GITHUB_TOKEN=<token>
HARVESTER_E2E_OWNER=<owner>          # or PRIVACY_E2E_OWNER
HARVESTER_E2E_REPO=<repo>            # or PRIVACY_E2E_REPO
HARVESTER_E2E_DISCUSSION_NUMBER=<n>  # or PRIVACY_E2E_DISCUSSION_NUMBER
HARVESTER_E2E_HMAC_SECRET=<secret>   # or PRIVACY_E2E_HMAC_SECRET
HARVESTER_E2E_PRIVATE_KEY=<key>     # or PRIVACY_E2E_PRIVATE_KEY
HARVESTER_E2E_PUBLIC_KEY=<key>      # or PRIVACY_E2E_PUBLIC_KEY
HARVESTER_E2E_CURSOR_PREFIX=<prefix> # optional, default: HARVESTER_E2E
```

## Test Scenarios

### E2E-HARVESTER-01: Single Bundle Harvest

**Objective**: Verify basic harvest functionality for a single bundle.

**Flow**:
1. Produce N encrypted ratings for a bundle
2. Run harvester
3. Verify aggregation and extension format output

**Validation**:
- All ratings processed
- Average rating calculated correctly
- Extension format generated with correct vote count
- Feedbacks decrypted (if private key available)

---

### E2E-HARVESTER-02: Incremental Harvest (Cursor-Based)

**Objective**: Verify cursor-based incremental processing.

**Flow**:
1. Produce batch 1 ratings
2. Harvest (captures batch 1)
3. Produce batch 2 ratings
4. Harvest (captures only batch 2)
5. Harvest again (captures nothing)

**Validation**:
- First harvest: processes batch 1
- Second harvest: processes only batch 2
- Third harvest: processes 0 ratings (idempotent)
- Aggregation only includes ratings from current run

---

### E2E-HARVESTER-03: Concurrent Production Simulation

**Objective**: Handle multiple VS Code users submitting ratings simultaneously.

**Flow**:
1. Simulate 5 concurrent users posting ratings (Promise.all)
2. Wait for eventual consistency
3. Harvest all ratings

**Validation**:
- All concurrent ratings captured
- No duplicate processing
- Decrypted comments available
- feedbackByRating correctly groups by rating value

---

### E2E-HARVESTER-04: Multi-Bundle Harvest

**Objective**: Process ratings for multiple bundles independently.

**Flow**:
1. Produce ratings for bundle A (3 ratings)
2. Produce ratings for bundle B (2 ratings)
3. Produce ratings for bundle C (4 ratings)
4. Harvest each bundle separately

**Validation**:
- Each bundle processed independently
- Correct aggregation per bundle
- No cross-bundle contamination

---

### E2E-HARVESTER-05: Workflow Simulation (GitHub Actions style)

**Objective**: Simulate full workflow with file output.

**Flow**:
1. Produce ratings
2. Use `harvestAndSaveRatings()` function
3. Verify file outputs

**Validation**:
- Extension format file created (`ratings.extension.json`)
- Collections format file created (`ratings.collections.json`)
- Aggregation file created (`ratings.aggregation.json`)
- Feedbacks file created (`feedbacks.json`)
- Files contain valid JSON with expected structure

---

### E2E-HARVESTER-06: Invalid Payload Handling

**Objective**: Gracefully handle mixed valid/invalid payloads.

**Flow**:
1. Produce valid ratings (3)
2. Produce tampered ratings (2) - HMAC signature invalid
3. Produce corrupted JSON (1)
4. Harvest

**Validation**:
- Valid ratings processed
- Invalid payloads counted but not aggregated
- Invalid count returned in result
- Aggregation only includes valid ratings

---

### E2E-HARVESTER-07: Idempotent Re-processing

**Objective**: Verify idempotency on re-run.

**Flow**:
1. Produce ratings
2. Harvest (processes ratings)
3. Immediately re-harvest (no new ratings)

**Validation**:
- First harvest: processes ratings
- Second harvest: processes 0 ratings
- hasNewRatings=false on second run
- Aggregation empty on second run

---

### E2E-HARVESTER-08: Single-Processing-Unit Guard (Concurrency)

**Objective**: Ensure only one harvester runs at a time.

**Flow**:
1. Start harvester 1 (acquires lock)
2. Immediately start harvester 2 (waits for lock)
3. Harvester 1 completes and releases lock
4. Harvester 2 acquires lock and runs

**Validation**:
- Harvester 1: wasLocked=true, successful processing
- Harvester 2: wasLocked=true, successful processing after wait
- No concurrent execution (verified by lock comments)

---

### E2E-HARVESTER-09: Lock Timeout and Retry

**Objective**: Verify lock retry behavior.

**Flow**:
1. Start long-running harvester 1 (holds lock for extended period)
2. Start harvester 2 with short timeout (retries, then gives up)

**Validation**:
- Harvester 2: wasLocked=false, lockFailure set
- Appropriate retry delays between attempts
- Graceful degradation when lock unavailable

---

### E2E-HARVESTER-10: Full Workflow with Discussion Trigger

**Objective**: Simulate GitHub Actions workflow triggered by discussion comment.

**Flow**:
1. Workflow starts (via simulated trigger)
2. Harvester processes new ratings since last cursor
3. Updates ratings.json file
4. Commits changes back to repo

**Validation**:
- Trigger detection works
- Cursor updated after processing
- Output files generated
- GitHub Actions outputs set (if running in CI)

## Concurrent Execution Guard Details

The single-processing-unit guard uses a distributed locking mechanism:

### Lock Protocol

1. **Lock Acquisition**:
   - Post lock comment to discussion: `__HARVESTER_LOCK__:{...}`
   - Include timestamp, expiry, PID, hostname
   - Wait for eventual consistency
   - Verify lock is the most recent valid one

2. **Lock Timeout**:
   - Default: 300 seconds (5 minutes)
   - Configurable via `lockTimeoutSeconds`

3. **Lock Retry**:
   - Default: 3 attempts
   - Delay: 5 seconds between attempts
   - Configurable via `lockRetryAttempts` and `lockRetryDelayMs`

4. **Lock Release**:
   - Always release in `finally` block
   - Post release comment: `__HARVESTER_RELEASE__:{...}`
   - Non-fatal if release fails (log only)

### Configuration

```typescript
const harvester = new OctoStreamDataHarvester({
  // ... other config
  enableLock: true,           // Enable guard (default: true)
  lockTimeoutSeconds: 300,    // 5 minute timeout
  lockRetryAttempts: 3,       // 3 retry attempts
  lockRetryDelayMs: 5000,    // 5 second delay
});
```

## Output Formats

### Extension Format (`ratings.extension.json`)

```json
{
  "version": "1.0.0",
  "generatedAt": "2026-02-23T10:00:00Z",
  "bundles": {
    "owner/bundle-name": {
      "sourceId": "github-discussions",
      "bundleId": "owner/bundle-name",
      "upvotes": 0,
      "downvotes": 0,
      "wilsonScore": 0.875,
      "starRating": 4.5,
      "totalVotes": 10,
      "lastUpdated": "2026-02-23T10:00:00Z",
      "discussionNumber": 42,
      "confidence": "high",
      "feedbackByRating": {
        "4": { "count": 4, "comments": ["Good...", "Nice..."] },
        "5": { "count": 6, "comments": ["Excellent!", "Love it!"] }
      }
    }
  }
}
```

### Collections Format (`ratings.collections.json`)

```json
{
  "generated_at": "2026-02-23T10:00:00Z",
  "repository": "owner/repo",
  "collections": {
    "owner/bundle-name": {
      "source_id": "github-discussions",
      "discussion_number": 42,
      "up": 0,
      "down": 0,
      "wilson_score": 0.875,
      "bayesian_score": 4.5,
      "aggregated_score": 0.875,
      "star_rating": 4.5,
      "rating_count": 10,
      "confidence": "high",
      "resources": {}
    }
  }
}
```

## Running E2E Tests

```bash
# Source environment variables
source .env.test

# Run harvester E2E tests
npx mocha --require ts-node/register test/octostream-harvester.e2e.test.ts

# Run with logging
LOG_LEVEL=INFO npx mocha --require ts-node/register test/octostream-harvester.e2e.test.ts
```

## Implementation Status

| Scenario | Status | Notes |
|----------|--------|-------|
| E2E-HARVESTER-01 | ✅ Implemented | Single bundle harvest |
| E2E-HARVESTER-02 | ✅ Implemented | Incremental harvest |
| E2E-HARVESTER-03 | ✅ Implemented | Concurrent production |
| E2E-HARVESTER-04 | ✅ Implemented | Multi-bundle harvest |
| E2E-HARVESTER-05 | ✅ Implemented | Workflow simulation |
| E2E-HARVESTER-06 | ✅ Implemented | Invalid payload handling |
| E2E-HARVESTER-07 | ✅ Implemented | Idempotent re-processing |
| E2E-HARVESTER-08 | 🔄 Partial | Lock framework added, needs full test |
| E2E-HARVESTER-09 | 🔄 Partial | Retry logic added, needs test |
| E2E-HARVESTER-10 | 📋 Planned | Full workflow trigger simulation |

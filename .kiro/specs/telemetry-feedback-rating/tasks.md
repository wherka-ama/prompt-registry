# Implementation Tasks: Telemetry, Feedback & Rating System

## Phase 1: Core Infrastructure ✅ COMPLETED

### Task 1.1: Create Type Definitions ✅
- [x] Create `src/types/engagement.ts` with all type definitions
- [x] Add `HubEngagementConfig` to `src/types/hub.ts`
- [x] Validation helpers for all engagement types

### Task 1.2: Create Backend Interface ✅
- [x] Create `src/services/engagement/IEngagementBackend.ts`
- [x] Define complete interface contract
- [x] BaseEngagementBackend abstract class

### Task 1.3: Implement EngagementStorage ✅
- [x] Create `src/storage/EngagementStorage.ts`
- [x] Implement telemetry persistence
- [x] Implement ratings persistence
- [x] Implement feedback persistence
- [x] Write tests: `test/storage/EngagementStorage.test.ts` (31 tests)

### Task 1.4: Implement FileBackend ✅
- [x] Create `src/services/engagement/backends/FileBackend.ts`
- [x] Implement IEngagementBackend interface
- [x] Write tests: `test/services/engagement/backends/FileBackend.test.ts` (26 tests)

### Task 1.5: Implement EngagementService ✅
- [x] Create `src/services/engagement/EngagementService.ts`
- [x] Implement singleton pattern
- [x] Implement backend selection logic
- [x] Implement event emitters
- [x] Write tests: `test/services/engagement/EngagementService.test.ts` (29 tests)

### Task 1.6: Update Hub Configuration ✅
- [x] Add engagement config validation to `validateHubConfig`
- [x] Import HubEngagementConfig in hub.ts

### Tasks Deferred to Phase 2:
- TelemetryManager, RatingManager, FeedbackManager (convenience wrappers)
- EngagementCommands (VS Code command integration)
- Integration with RegistryManager events

## Phase 2: GitHub Discussions Backend & VS Code Integration

### Task 2.1: VoteService Implementation
- [ ] Create `src/services/engagement/VoteService.ts`
- [ ] Implement `voteOnCollection(discussionNumber, reaction)` using GitHub REST API
- [ ] Implement `voteOnResource(discussionNumber, commentId, reaction)` for granular voting
- [ ] Use VS Code GitHub authentication (`vscode.authentication.getSession`)
- [ ] Write tests: `test/services/engagement/VoteService.test.ts`

### Task 2.2: GitHub Discussions Backend
- [ ] Create `src/services/engagement/backends/GitHubDiscussionsBackend.ts`
- [ ] Implement IEngagementBackend interface
- [ ] Fetch reaction counts via GitHub GraphQL API
- [ ] Map discussions to bundles/collections
- [ ] Write tests with nock mocking

### Task 2.3: VS Code Commands for Voting
- [ ] Register `promptRegistry.voteUpCollection` command
- [ ] Register `promptRegistry.voteDownCollection` command
- [ ] Register `promptRegistry.voteUpResource` command
- [ ] Add commands to `package.json` contributions
- [ ] Write tests: `test/commands/VoteCommands.test.ts`

### Task 2.4: Rating Widget (WebView)
- [ ] Add rating display to bundle detail view
- [ ] Implement star rating component (👍/👎 or 1-5 stars)
- [ ] Add click-to-vote functionality
- [ ] Show vote count and Wilson score

### Task 2.5: Tree View Enhancement
- [ ] Show average rating in bundle tree items (e.g., "★ 4.2")
- [ ] Add rating/feedback context menu items
- [ ] Display vote count

### Task 2.6: Feedback Dialog
- [ ] Implement feedback input dialog
- [ ] Add optional rating with feedback
- [ ] Implement character limit (configurable)

## Phase 3: Rating Computation & Aggregation

### Task 3.1: Wilson Score Algorithm
- [ ] Create `src/utils/ratingAlgorithms.ts`
- [ ] Implement `wilsonLowerBound(up, down, z)` function
- [ ] Implement `bayesianSmoothing(up, n, m, k)` function
- [ ] Write unit tests with edge cases

### Task 3.2: GitHub Action for Rating Computation
- [ ] Create `.github/workflows/compute-ratings.yml`
- [ ] Create `scripts/compute-ratings.js`
- [ ] Fetch reaction counts via GraphQL
- [ ] Compute Wilson scores
- [ ] Aggregate resource → collection scores
- [ ] Write `ratings.json` to repo

### Task 3.3: Collections Mapping
- [ ] Define `collections.yaml` schema
- [ ] Map bundles to GitHub Discussion numbers
- [ ] Map resources to comment IDs (for granular voting)

### Task 3.4: Anti-Abuse Measures
- [ ] Implement account age filter (ignore < 7 days old)
- [ ] Create `blacklist.json` for excluded accounts
- [ ] Detect vote bursts (optional)

## Current Sprint: Phase 2

Phase 1 complete. Now implementing GitHub Discussions backend and VS Code voting integration.

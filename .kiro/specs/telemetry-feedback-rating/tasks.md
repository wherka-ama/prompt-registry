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

## Phase 2: UI Integration

### Task 2.1: Rating Widget
- [ ] Add rating display to bundle detail view (WebView)
- [ ] Implement star rating component
- [ ] Add click-to-rate functionality

### Task 2.2: Feedback Dialog
- [ ] Implement feedback input dialog
- [ ] Add optional rating with feedback
- [ ] Implement character limit

### Task 2.3: Tree View Enhancement
- [ ] Show average rating in bundle tree items
- [ ] Add rating/feedback context menu items

### Task 2.4: Settings UI
- [ ] Add privacy settings to VS Code settings
- [ ] Implement settings change handlers

## Phase 3: GitHub Backend (Future)

### Task 3.1: GitHub Issues Backend
- [ ] Create `src/services/engagement/backends/GitHubIssuesBackend.ts`
- [ ] Implement issue creation for ratings
- [ ] Implement comment parsing for feedback
- [ ] Handle authentication

### Task 3.2: Aggregation
- [ ] Implement rating aggregation from issues
- [ ] Cache aggregated data
- [ ] Handle rate limiting

## Current Sprint: Phase 1

Starting with TDD approach - write tests first, then implement.

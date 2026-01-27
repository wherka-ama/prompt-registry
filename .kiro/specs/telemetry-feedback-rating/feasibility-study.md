# Feasibility Study: Telemetry, Feedback & Rating System

## Executive Summary

This document analyzes design options for implementing telemetry collection, user feedback, and resource rating features for the Prompt Registry VS Code extension. The design prioritizes:

1. **Simplicity** - Minimal maintenance burden
2. **Extensibility** - Pluggable backend architecture
3. **Privacy** - Non-identifiable data collection by default
4. **Open Source Friendly** - Community-driven feedback mechanisms
5. **Security** - Safe data handling and transmission

## Requirements Analysis

### From GitHub Issues

| Issue | Feature | Priority | Key Requirements |
|-------|---------|----------|------------------|
| #98 | GitHub Project Backend | Critical | Unified interface for ratings/feedback/telemetry |
| #80 | Telemetry Collection | High | Non-identifiable data, private repo support |
| #25 | User Feedback | Low | View/provide feedback on resources |
| #20 | Resource Rating | Low | 1-5 star rating for bundles/profiles/hubs |

### Consolidated Requirements

1. **Telemetry**: Track bundle installs, activations, usage patterns (anonymized)
2. **Feedback**: Text comments on bundles with optional metadata
3. **Rating**: 1-5 star rating system for bundles
4. **Backend Flexibility**: Support file-based, GitHub Issues/Discussions, or custom backends
5. **Hub Configuration**: Backend selection configurable per-hub
6. **Privacy Controls**: User opt-in, data anonymization options

---

## Architecture Design

### Core Principle: Strategy Pattern with Hub-Driven Configuration

```
┌─────────────────────────────────────────────────────────────────┐
│                     Engagement Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ TelemetryMgr │  │ FeedbackMgr  │  │  RatingMgr   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│         └─────────────────┼─────────────────┘                   │
│                           ▼                                     │
│              ┌────────────────────────┐                         │
│              │  EngagementService     │ ◄── Unified Facade      │
│              └───────────┬────────────┘                         │
│                          │                                      │
│         ┌────────────────┼────────────────┐                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ IBackend    │  │ IBackend    │  │ IBackend    │             │
│  │ (File)      │  │ (GitHub)    │  │ (Custom)    │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User Action → Manager → EngagementService → Backend (from Hub Config)
                                              ↓
                                        Storage/API
```

---

## Backend Options Analysis

### Option 1: File-Based Storage (Default)

**Description**: Local JSON files in extension storage directory.

| Aspect | Details |
|--------|---------|
| **Pros** | Zero infrastructure, works offline, privacy-friendly, no auth needed |
| **Cons** | No aggregation across users, data stays local |
| **Use Case** | Personal tracking, offline environments, privacy-conscious users |
| **Complexity** | Low |

**Data Structure**:
```
globalStorage/
├── engagement/
│   ├── telemetry.json      # Local telemetry events
│   ├── ratings.json        # User's own ratings
│   └── feedback.json       # User's own feedback
```

### Option 2: GitHub Issues/Discussions Backend

**Description**: Use GitHub repository issues or discussions as storage.

| Aspect | Details |
|--------|---------|
| **Pros** | Community visible, no infrastructure, GitHub auth built-in, searchable |
| **Cons** | Requires GitHub account, rate limits, public by default |
| **Use Case** | Open source hubs, community feedback, public ratings |
| **Complexity** | Medium |

**Implementation**:
- One issue per bundle for ratings (labels for stars)
- Comments for feedback
- GitHub Actions for aggregation (optional)

**Issue Format**:
```markdown
Title: [Rating] bundle-id@version
Labels: rating:4, bundle:my-bundle
Body: 
- Bundle: my-bundle
- Version: 1.0.0
- Rating: ⭐⭐⭐⭐
- Comment: (optional)
```

### Option 3: GitHub Discussions Backend

**Description**: Use GitHub Discussions API for structured feedback.

| Aspect | Details |
|--------|---------|
| **Pros** | Better UX than issues, categories, reactions as ratings |
| **Cons** | Requires Discussions enabled, same auth requirements |
| **Use Case** | Community hubs with active discussion |
| **Complexity** | Medium |

### Option 4: Remote API Backend (Future)

**Description**: Custom REST/GraphQL API endpoint.

| Aspect | Details |
|--------|---------|
| **Pros** | Full control, aggregation, analytics |
| **Cons** | Requires infrastructure, maintenance |
| **Use Case** | Enterprise deployments, large organizations |
| **Complexity** | High |

---

## Recommended Design

### Phase 1: Core Infrastructure (This PR)

1. **Abstract Interfaces** - Define `IEngagementBackend` interface
2. **File Backend** - Implement local storage (default)
3. **Hub Configuration** - Add engagement config to hub schema
4. **Basic UI** - Rating stars in bundle detail view

### Phase 2: GitHub Backend (Future PR)

1. **GitHub Issues Backend** - Implement GitHub API integration
2. **Aggregation** - Read community ratings/feedback
3. **Display** - Show aggregated data in UI

### Phase 3: Analytics (Future PR)

1. **Telemetry Dashboard** - Local analytics view
2. **Export** - Export telemetry data
3. **Remote Backends** - API-based backends

---

## Interface Design

### Core Types

```typescript
// Engagement event types
type EngagementType = 'telemetry' | 'feedback' | 'rating';

// Telemetry event
interface TelemetryEvent {
    id: string;
    timestamp: string;
    eventType: TelemetryEventType;
    resourceType: 'bundle' | 'profile' | 'hub';
    resourceId: string;
    metadata?: Record<string, unknown>;
}

type TelemetryEventType = 
    | 'install' 
    | 'uninstall' 
    | 'activate' 
    | 'deactivate'
    | 'update'
    | 'view';

// Rating
interface Rating {
    id: string;
    resourceType: 'bundle' | 'profile' | 'hub';
    resourceId: string;
    score: 1 | 2 | 3 | 4 | 5;
    timestamp: string;
    version?: string;
}

// Feedback
interface Feedback {
    id: string;
    resourceType: 'bundle' | 'profile' | 'hub';
    resourceId: string;
    comment: string;
    timestamp: string;
    version?: string;
    rating?: 1 | 2 | 3 | 4 | 5;
}

// Aggregated data for display
interface ResourceEngagement {
    resourceId: string;
    averageRating?: number;
    ratingCount?: number;
    feedbackCount?: number;
    installCount?: number;
}
```

### Backend Interface

```typescript
interface IEngagementBackend {
    readonly type: string;
    
    // Initialization
    initialize(config: EngagementBackendConfig): Promise<void>;
    
    // Telemetry
    recordTelemetry(event: TelemetryEvent): Promise<void>;
    getTelemetry(filter?: TelemetryFilter): Promise<TelemetryEvent[]>;
    
    // Ratings
    submitRating(rating: Rating): Promise<void>;
    getRating(resourceId: string): Promise<Rating | undefined>;
    getAggregatedRatings(resourceId: string): Promise<ResourceEngagement>;
    
    // Feedback
    submitFeedback(feedback: Feedback): Promise<void>;
    getFeedback(resourceId: string): Promise<Feedback[]>;
    
    // Cleanup
    dispose(): void;
}

interface EngagementBackendConfig {
    type: 'file' | 'github-issues' | 'github-discussions' | 'api';
    options?: Record<string, unknown>;
}
```

### Hub Configuration Extension

```yaml
# hub.yml
version: "1.0.0"
metadata:
  name: "My Hub"
  # ...

# NEW: Engagement configuration
engagement:
  enabled: true
  backend:
    type: "github-issues"  # or "file", "github-discussions", "api"
    options:
      repository: "org/feedback-repo"  # For GitHub backends
      # apiUrl: "https://api.example.com"  # For API backend
  
  telemetry:
    enabled: true
    events:
      - install
      - uninstall
      - activate
  
  ratings:
    enabled: true
    allowAnonymous: false  # Require GitHub auth
  
  feedback:
    enabled: true
    requireRating: false   # Optional rating with feedback

sources:
  # ...
profiles:
  # ...
```

---

## Privacy & Security Considerations

### Data Collection Principles

1. **Opt-in by Default**: Telemetry disabled unless explicitly enabled
2. **No PII**: Never collect usernames, emails, or identifiable data
3. **Local First**: File backend stores data locally only
4. **Transparent**: Clear indication when data is sent externally
5. **User Control**: Easy to disable, export, or delete data

### Security Measures

1. **Token Handling**: Use VS Code's secret storage for API tokens
2. **HTTPS Only**: All remote backends must use HTTPS
3. **Input Validation**: Sanitize all user input (feedback text)
4. **Rate Limiting**: Client-side rate limiting for submissions
5. **Scope Limitation**: GitHub tokens only need minimal scopes

### Privacy Settings

```typescript
interface PrivacySettings {
    telemetryEnabled: boolean;
    shareRatingsPublicly: boolean;
    shareFeedbackPublicly: boolean;
    anonymizeData: boolean;
}
```

---

## UI/UX Design

### Rating Widget

```
┌─────────────────────────────────────┐
│ Rate this bundle                    │
│ ☆ ☆ ☆ ☆ ☆  (Click to rate)        │
│                                     │
│ Community: ★★★★☆ (4.2) · 23 ratings│
└─────────────────────────────────────┘
```

### Feedback Dialog

```
┌─────────────────────────────────────┐
│ Share Feedback                      │
│ ─────────────────────────────────── │
│ Your rating: ★★★★☆                 │
│                                     │
│ Comment (optional):                 │
│ ┌─────────────────────────────────┐ │
│ │ Great prompts for React dev...  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Cancel]              [Submit]      │
└─────────────────────────────────────┘
```

### Bundle Detail View Enhancement

```
┌─────────────────────────────────────┐
│ 📦 my-awesome-bundle v1.2.0        │
│ ─────────────────────────────────── │
│ ★★★★☆ 4.2 (23 ratings)            │
│                                     │
│ Description...                      │
│                                     │
│ [Install] [Rate ⭐] [Feedback 💬]   │
│                                     │
│ Recent Feedback:                    │
│ ├─ "Works great!" - ★★★★★         │
│ └─ "Needs docs" - ★★★☆☆           │
└─────────────────────────────────────┘
```

---

## Implementation Plan

### Files to Create

```
src/
├── types/
│   └── engagement.ts           # Type definitions
├── services/
│   ├── engagement/
│   │   ├── EngagementService.ts    # Unified facade
│   │   ├── TelemetryManager.ts     # Telemetry logic
│   │   ├── RatingManager.ts        # Rating logic
│   │   └── FeedbackManager.ts      # Feedback logic
│   └── backends/
│       ├── IEngagementBackend.ts   # Interface
│       ├── FileBackend.ts          # Local storage
│       └── GitHubIssuesBackend.ts  # GitHub (Phase 2)
├── storage/
│   └── EngagementStorage.ts    # File-based persistence
└── commands/
    └── EngagementCommands.ts   # VS Code commands
```

### Test Files

```
test/
├── services/
│   ├── engagement/
│   │   ├── EngagementService.test.ts
│   │   ├── TelemetryManager.test.ts
│   │   ├── RatingManager.test.ts
│   │   └── FeedbackManager.test.ts
│   └── backends/
│       ├── FileBackend.test.ts
│       └── GitHubIssuesBackend.test.ts
└── storage/
    └── EngagementStorage.test.ts
```

---

## Decision Matrix

| Criteria | File Backend | GitHub Issues | GitHub Discussions | Custom API |
|----------|-------------|---------------|-------------------|------------|
| Setup Complexity | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐ |
| Maintenance | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| Community Visibility | ⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Privacy | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Offline Support | ⭐⭐⭐⭐⭐ | ⭐ | ⭐ | ⭐ |
| Aggregation | ⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Open Source Friendly | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |

**Recommendation**: Start with **File Backend** as default, add **GitHub Issues** as first remote option.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| GitHub API rate limits | Medium | Cache responses, batch requests |
| Privacy concerns | High | Opt-in only, clear disclosure |
| Spam/abuse | Medium | Rate limiting, moderation for GitHub |
| Backend unavailability | Low | Graceful degradation, local fallback |
| Data loss | Medium | Export functionality, backup prompts |

---

## Success Metrics

1. **Adoption**: % of users with engagement features enabled
2. **Participation**: Ratings/feedback per bundle
3. **Quality Signal**: Correlation between ratings and installs
4. **Performance**: No noticeable impact on extension startup

---

## Conclusion

The proposed design provides a flexible, privacy-respecting engagement system that:

1. Works out-of-the-box with local storage
2. Scales to community feedback via GitHub
3. Supports enterprise needs via custom backends
4. Follows existing codebase patterns (adapters, storage, services)

**Next Step**: Implement Phase 1 with file backend and basic UI.

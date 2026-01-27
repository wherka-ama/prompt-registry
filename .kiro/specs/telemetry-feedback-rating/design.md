# Technical Design: Telemetry, Feedback & Rating System

## Overview

This document provides the detailed technical design for implementing the engagement system based on the feasibility study.

## Type Definitions

### File: `src/types/engagement.ts`

```typescript
/**
 * Engagement system types for Prompt Registry
 * Handles telemetry, feedback, and rating functionality
 */

// ============================================================================
// Telemetry Types
// ============================================================================

/**
 * Types of telemetry events that can be recorded
 */
export type TelemetryEventType =
    | 'bundle_install'
    | 'bundle_uninstall'
    | 'bundle_update'
    | 'bundle_view'
    | 'profile_activate'
    | 'profile_deactivate'
    | 'hub_import'
    | 'hub_sync'
    | 'search'
    | 'error';

/**
 * Resource types that can have engagement data
 */
export type EngagementResourceType = 'bundle' | 'profile' | 'hub';

/**
 * A telemetry event record
 */
export interface TelemetryEvent {
    /** Unique event ID */
    id: string;
    /** ISO timestamp */
    timestamp: string;
    /** Type of event */
    eventType: TelemetryEventType;
    /** Type of resource involved */
    resourceType: EngagementResourceType;
    /** Resource identifier */
    resourceId: string;
    /** Resource version (if applicable) */
    version?: string;
    /** Additional event metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Filter options for querying telemetry
 */
export interface TelemetryFilter {
    eventTypes?: TelemetryEventType[];
    resourceTypes?: EngagementResourceType[];
    resourceId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
}

// ============================================================================
// Rating Types
// ============================================================================

/**
 * Valid rating scores (1-5 stars)
 */
export type RatingScore = 1 | 2 | 3 | 4 | 5;

/**
 * A user rating for a resource
 */
export interface Rating {
    /** Unique rating ID */
    id: string;
    /** Type of resource being rated */
    resourceType: EngagementResourceType;
    /** Resource identifier */
    resourceId: string;
    /** Rating score (1-5) */
    score: RatingScore;
    /** ISO timestamp */
    timestamp: string;
    /** Resource version at time of rating */
    version?: string;
}

/**
 * Aggregated rating statistics
 */
export interface RatingStats {
    /** Resource identifier */
    resourceId: string;
    /** Average rating (1.0-5.0) */
    averageRating: number;
    /** Total number of ratings */
    ratingCount: number;
    /** Distribution of ratings */
    distribution: {
        1: number;
        2: number;
        3: number;
        4: number;
        5: number;
    };
}

// ============================================================================
// Feedback Types
// ============================================================================

/**
 * User feedback for a resource
 */
export interface Feedback {
    /** Unique feedback ID */
    id: string;
    /** Type of resource */
    resourceType: EngagementResourceType;
    /** Resource identifier */
    resourceId: string;
    /** Feedback comment text */
    comment: string;
    /** ISO timestamp */
    timestamp: string;
    /** Resource version at time of feedback */
    version?: string;
    /** Optional rating included with feedback */
    rating?: RatingScore;
}

// ============================================================================
// Backend Configuration Types
// ============================================================================

/**
 * Supported backend types
 */
export type EngagementBackendType = 
    | 'file' 
    | 'github-issues' 
    | 'github-discussions' 
    | 'api';

/**
 * Base backend configuration
 */
export interface EngagementBackendConfig {
    type: EngagementBackendType;
}

/**
 * File backend configuration
 */
export interface FileBackendConfig extends EngagementBackendConfig {
    type: 'file';
    /** Custom storage path (optional, defaults to extension storage) */
    storagePath?: string;
}

/**
 * GitHub Issues backend configuration
 */
export interface GitHubIssuesBackendConfig extends EngagementBackendConfig {
    type: 'github-issues';
    /** Repository in owner/repo format */
    repository: string;
    /** Labels to apply to issues */
    labels?: string[];
    /** Whether to use GitHub authentication */
    requireAuth?: boolean;
}

/**
 * GitHub Discussions backend configuration
 */
export interface GitHubDiscussionsBackendConfig extends EngagementBackendConfig {
    type: 'github-discussions';
    /** Repository in owner/repo format */
    repository: string;
    /** Discussion category */
    category?: string;
}

/**
 * Custom API backend configuration
 */
export interface ApiBackendConfig extends EngagementBackendConfig {
    type: 'api';
    /** API base URL */
    baseUrl: string;
    /** Authentication header name */
    authHeader?: string;
    /** Authentication token (or env var reference) */
    authToken?: string;
}

/**
 * Union of all backend configs
 */
export type BackendConfig = 
    | FileBackendConfig 
    | GitHubIssuesBackendConfig 
    | GitHubDiscussionsBackendConfig 
    | ApiBackendConfig;

// ============================================================================
// Hub Engagement Configuration
// ============================================================================

/**
 * Telemetry configuration in hub
 */
export interface TelemetryConfig {
    /** Whether telemetry is enabled */
    enabled: boolean;
    /** Which events to track */
    events?: TelemetryEventType[];
}

/**
 * Rating configuration in hub
 */
export interface RatingConfig {
    /** Whether ratings are enabled */
    enabled: boolean;
    /** Whether anonymous ratings are allowed */
    allowAnonymous?: boolean;
}

/**
 * Feedback configuration in hub
 */
export interface FeedbackConfig {
    /** Whether feedback is enabled */
    enabled: boolean;
    /** Whether rating is required with feedback */
    requireRating?: boolean;
    /** Maximum comment length */
    maxLength?: number;
}

/**
 * Complete engagement configuration for a hub
 */
export interface HubEngagementConfig {
    /** Whether engagement features are enabled */
    enabled: boolean;
    /** Backend configuration */
    backend: BackendConfig;
    /** Telemetry settings */
    telemetry?: TelemetryConfig;
    /** Rating settings */
    ratings?: RatingConfig;
    /** Feedback settings */
    feedback?: FeedbackConfig;
}

// ============================================================================
// Aggregated Engagement Data
// ============================================================================

/**
 * Combined engagement data for a resource
 */
export interface ResourceEngagement {
    resourceId: string;
    resourceType: EngagementResourceType;
    /** Rating statistics */
    ratings?: RatingStats;
    /** Recent feedback entries */
    recentFeedback?: Feedback[];
    /** Telemetry summary */
    telemetry?: {
        installCount: number;
        viewCount: number;
        lastActivity?: string;
    };
}

// ============================================================================
// Privacy Types
// ============================================================================

/**
 * User privacy preferences for engagement
 */
export interface EngagementPrivacySettings {
    /** Whether telemetry collection is enabled */
    telemetryEnabled: boolean;
    /** Whether to share ratings publicly (for remote backends) */
    shareRatingsPublicly: boolean;
    /** Whether to share feedback publicly (for remote backends) */
    shareFeedbackPublicly: boolean;
}

/**
 * Default privacy settings (privacy-preserving)
 */
export const DEFAULT_PRIVACY_SETTINGS: EngagementPrivacySettings = {
    telemetryEnabled: false,
    shareRatingsPublicly: false,
    shareFeedbackPublicly: false,
};
```

## Backend Interface

### File: `src/services/engagement/IEngagementBackend.ts`

```typescript
/**
 * Interface for engagement data backends
 * Implementations handle storage/retrieval of telemetry, ratings, and feedback
 */

import {
    TelemetryEvent,
    TelemetryFilter,
    Rating,
    RatingStats,
    Feedback,
    BackendConfig,
    ResourceEngagement,
    EngagementResourceType,
} from '../../types/engagement';

/**
 * Backend interface for engagement data storage
 */
export interface IEngagementBackend {
    /** Backend type identifier */
    readonly type: string;
    
    /** Whether the backend is initialized */
    readonly initialized: boolean;

    // ========================================================================
    // Lifecycle
    // ========================================================================
    
    /**
     * Initialize the backend with configuration
     * @param config Backend-specific configuration
     */
    initialize(config: BackendConfig): Promise<void>;
    
    /**
     * Clean up resources
     */
    dispose(): void;

    // ========================================================================
    // Telemetry Operations
    // ========================================================================
    
    /**
     * Record a telemetry event
     * @param event Telemetry event to record
     */
    recordTelemetry(event: TelemetryEvent): Promise<void>;
    
    /**
     * Retrieve telemetry events
     * @param filter Optional filter criteria
     * @returns Array of telemetry events
     */
    getTelemetry(filter?: TelemetryFilter): Promise<TelemetryEvent[]>;
    
    /**
     * Clear telemetry data
     * @param filter Optional filter to clear specific data
     */
    clearTelemetry(filter?: TelemetryFilter): Promise<void>;

    // ========================================================================
    // Rating Operations
    // ========================================================================
    
    /**
     * Submit or update a rating
     * @param rating Rating to submit
     */
    submitRating(rating: Rating): Promise<void>;
    
    /**
     * Get user's rating for a resource
     * @param resourceType Type of resource
     * @param resourceId Resource identifier
     * @returns User's rating or undefined
     */
    getRating(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<Rating | undefined>;
    
    /**
     * Get aggregated rating statistics
     * @param resourceType Type of resource
     * @param resourceId Resource identifier
     * @returns Aggregated rating stats
     */
    getAggregatedRatings(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<RatingStats | undefined>;
    
    /**
     * Delete user's rating
     * @param resourceType Type of resource
     * @param resourceId Resource identifier
     */
    deleteRating(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<void>;

    // ========================================================================
    // Feedback Operations
    // ========================================================================
    
    /**
     * Submit feedback
     * @param feedback Feedback to submit
     */
    submitFeedback(feedback: Feedback): Promise<void>;
    
    /**
     * Get feedback for a resource
     * @param resourceType Type of resource
     * @param resourceId Resource identifier
     * @param limit Maximum number of entries
     * @returns Array of feedback entries
     */
    getFeedback(
        resourceType: EngagementResourceType,
        resourceId: string,
        limit?: number
    ): Promise<Feedback[]>;
    
    /**
     * Delete feedback
     * @param feedbackId Feedback ID to delete
     */
    deleteFeedback(feedbackId: string): Promise<void>;

    // ========================================================================
    // Aggregation
    // ========================================================================
    
    /**
     * Get combined engagement data for a resource
     * @param resourceType Type of resource
     * @param resourceId Resource identifier
     * @returns Combined engagement data
     */
    getResourceEngagement(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<ResourceEngagement>;
}
```

## Service Layer Design

### EngagementService (Facade)

```typescript
/**
 * EngagementService - Unified facade for engagement features
 * 
 * Responsibilities:
 * - Backend selection based on hub configuration
 * - Privacy settings enforcement
 * - Event coordination
 */
export class EngagementService {
    private static instance: EngagementService;
    private backends: Map<string, IEngagementBackend>;
    private defaultBackend: IEngagementBackend;
    
    // Events
    private _onRatingSubmitted: vscode.EventEmitter<Rating>;
    private _onFeedbackSubmitted: vscode.EventEmitter<Feedback>;
    private _onTelemetryRecorded: vscode.EventEmitter<TelemetryEvent>;
    
    static getInstance(context?: vscode.ExtensionContext): EngagementService;
    
    // Backend management
    getBackendForHub(hubId: string): IEngagementBackend;
    registerBackend(hubId: string, config: BackendConfig): Promise<void>;
    
    // Delegated operations (route to appropriate backend)
    recordTelemetry(event: Omit<TelemetryEvent, 'id' | 'timestamp'>): Promise<void>;
    submitRating(rating: Omit<Rating, 'id' | 'timestamp'>): Promise<void>;
    submitFeedback(feedback: Omit<Feedback, 'id' | 'timestamp'>): Promise<void>;
    
    // Queries
    getResourceEngagement(resourceType, resourceId, hubId?): Promise<ResourceEngagement>;
}
```

### TelemetryManager

```typescript
/**
 * TelemetryManager - Handles telemetry event recording
 * 
 * Responsibilities:
 * - Event creation and validation
 * - Privacy filtering
 * - Batching (optional)
 */
export class TelemetryManager {
    constructor(private engagementService: EngagementService);
    
    // Convenience methods for common events
    recordBundleInstall(bundleId: string, version: string): Promise<void>;
    recordBundleUninstall(bundleId: string): Promise<void>;
    recordProfileActivate(profileId: string, hubId: string): Promise<void>;
    recordSearch(query: string, resultCount: number): Promise<void>;
    recordError(error: Error, context: string): Promise<void>;
}
```

### RatingManager

```typescript
/**
 * RatingManager - Handles rating operations
 * 
 * Responsibilities:
 * - Rating validation
 * - UI coordination
 * - Cache management
 */
export class RatingManager {
    constructor(private engagementService: EngagementService);
    
    // Rating operations
    rateBundle(bundleId: string, score: RatingScore): Promise<void>;
    rateProfile(profileId: string, hubId: string, score: RatingScore): Promise<void>;
    
    // Queries
    getUserRating(resourceType, resourceId): Promise<Rating | undefined>;
    getAverageRating(resourceType, resourceId): Promise<number | undefined>;
}
```

### FeedbackManager

```typescript
/**
 * FeedbackManager - Handles feedback operations
 * 
 * Responsibilities:
 * - Feedback validation and sanitization
 * - UI dialogs
 */
export class FeedbackManager {
    constructor(private engagementService: EngagementService);
    
    // Feedback operations
    submitBundleFeedback(bundleId: string, comment: string, rating?: RatingScore): Promise<void>;
    
    // UI
    showFeedbackDialog(resourceType, resourceId): Promise<Feedback | undefined>;
}
```

## Storage Layer

### File: `src/storage/EngagementStorage.ts`

```typescript
/**
 * EngagementStorage - File-based persistence for engagement data
 * 
 * Storage structure:
 * globalStorage/
 * └── engagement/
 *     ├── telemetry/
 *     │   └── events.json
 *     ├── ratings/
 *     │   └── user-ratings.json
 *     └── feedback/
 *         └── user-feedback.json
 */
export class EngagementStorage {
    constructor(private storagePath: string);
    
    // Telemetry
    async saveTelemetryEvent(event: TelemetryEvent): Promise<void>;
    async getTelemetryEvents(filter?: TelemetryFilter): Promise<TelemetryEvent[]>;
    async clearTelemetry(): Promise<void>;
    
    // Ratings
    async saveRating(rating: Rating): Promise<void>;
    async getRating(resourceType, resourceId): Promise<Rating | undefined>;
    async getAllRatings(): Promise<Rating[]>;
    async deleteRating(resourceType, resourceId): Promise<void>;
    
    // Feedback
    async saveFeedback(feedback: Feedback): Promise<void>;
    async getFeedback(resourceType, resourceId): Promise<Feedback[]>;
    async deleteFeedback(feedbackId: string): Promise<void>;
}
```

## Hub Configuration Schema Update

### Addition to `src/types/hub.ts`

```typescript
// Add to HubConfig interface
export interface HubConfig {
    // ... existing fields ...
    
    /** Engagement configuration (optional) */
    engagement?: HubEngagementConfig;
}
```

### Example Hub YAML

```yaml
version: "1.0.0"
metadata:
  name: "Community Hub"
  description: "Open source prompt bundles"
  maintainer: "community@example.com"
  updatedAt: "2025-01-27"

engagement:
  enabled: true
  backend:
    type: "github-issues"
    repository: "org/prompt-feedback"
    labels:
      - "prompt-registry"
      - "feedback"
  telemetry:
    enabled: true
    events:
      - bundle_install
      - bundle_uninstall
      - profile_activate
  ratings:
    enabled: true
    allowAnonymous: false
  feedback:
    enabled: true
    requireRating: false
    maxLength: 1000

sources:
  - id: main-source
    # ...

profiles:
  - id: default
    # ...
```

## Commands

### File: `src/commands/EngagementCommands.ts`

```typescript
/**
 * VS Code commands for engagement features
 */
export class EngagementCommands {
    constructor(
        private ratingManager: RatingManager,
        private feedbackManager: FeedbackManager
    );
    
    register(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand(
                'promptRegistry.rateBundle',
                this.rateBundle.bind(this)
            ),
            vscode.commands.registerCommand(
                'promptRegistry.submitFeedback',
                this.submitFeedback.bind(this)
            ),
            vscode.commands.registerCommand(
                'promptRegistry.viewFeedback',
                this.viewFeedback.bind(this)
            )
        );
    }
    
    private async rateBundle(bundleId: string): Promise<void>;
    private async submitFeedback(bundleId: string): Promise<void>;
    private async viewFeedback(bundleId: string): Promise<void>;
}
```

## Implementation Order

### Phase 1: Core Infrastructure

1. **Types** (`src/types/engagement.ts`)
2. **Backend Interface** (`src/services/engagement/IEngagementBackend.ts`)
3. **Storage** (`src/storage/EngagementStorage.ts`)
4. **File Backend** (`src/services/engagement/backends/FileBackend.ts`)
5. **EngagementService** (`src/services/engagement/EngagementService.ts`)
6. **Managers** (Telemetry, Rating, Feedback)
7. **Commands** (`src/commands/EngagementCommands.ts`)
8. **Hub Config Update** (types + validation)

### Phase 2: UI Integration

1. Rating widget in bundle detail view
2. Feedback dialog
3. Display aggregated ratings in tree view
4. Settings UI for privacy preferences

### Phase 3: GitHub Backend (Future)

1. GitHub Issues backend implementation
2. GitHub Discussions backend implementation
3. Aggregation from community data

## Test Strategy

Following TDD methodology:

1. Write interface tests first (contract tests)
2. Implement FileBackend with tests
3. Integration tests for EngagementService
4. UI component tests (if applicable)

See `test/AGENTS.md` for testing patterns.

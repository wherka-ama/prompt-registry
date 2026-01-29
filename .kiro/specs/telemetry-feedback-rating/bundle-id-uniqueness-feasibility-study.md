# Bundle ID Uniqueness in Engagement Data: Feasibility Study

## Problem Statement

The current engagement data schema (ratings.json and feedbacks.json) uses `bundleId` as the primary key for associating ratings and feedback with bundles. However, **bundle IDs are not globally unique** across different sources, leading to potential data collisions.

### Current Schema (Problematic)

```json
{
  "version": "1.0.0",
  "generated": "2025-01-29T10:00:00Z",
  "bundles": [
    {
      "bundleId": "react-helpers",  // ❌ Not unique across sources!
      "upvotes": 45,
      "downvotes": 3
    }
  ]
}
```

### The Core Issue

1. **Bundle ID is source-dependent**: A bundle with ID `react-helpers` from GitHub source A is different from `react-helpers` from GitHub source B
2. **Client-side computation**: The extension computes unique bundle IDs using `sourceId` + `bundleId` components
3. **Data mismatch**: Engagement data uses simple `bundleId`, but the client needs `sourceId` context to resolve correctly

## Current Architecture Analysis

### How Bundle IDs Work in the Extension

From `src/types/registry.ts`:
```typescript
export interface Bundle {
    id: string;           // Simple ID from manifest
    sourceId: string;     // Source providing this bundle
    // ... other fields
}
```

### Client-Side Bundle Resolution

The extension always works with bundles in the context of their source:

```typescript
// Example from RegistryManager
const queryBySourceAndBundleId = { 
    text: bundleRef.id, 
    sourceId: bundleRef.sourceId  // ✅ Source context required
};
```

### Engagement Data Loading

From `src/extension.ts`:
```typescript
const ratingsUrl = hubResult.config?.engagement?.ratings?.ratingsUrl;
if (ratingsUrl) {
    await ratingCache.refreshFromHub(hub.id, ratingsUrl);
}
```

The ratings are loaded **per hub**, which provides some context, but not enough for source-level disambiguation.

## Proposed Solutions

### Option 1: Composite Key (Recommended)

**Use `sourceId` + `bundleId` as the composite key in engagement data.**

#### Schema Change

```json
{
  "version": "1.0.0",
  "generated": "2025-01-29T10:00:00Z",
  "bundles": [
    {
      "sourceId": "awesome-copilot-official",
      "bundleId": "react-helpers",
      "upvotes": 45,
      "downvotes": 3,
      "wilsonScore": 0.89,
      "starRating": 4.5,
      "voteCount": 48,
      "confidence": "high"
    }
  ]
}
```

#### Pros
- ✅ **Globally unique**: `sourceId` + `bundleId` uniquely identifies a bundle
- ✅ **Matches client architecture**: Extension already uses this pattern
- ✅ **Clear semantics**: Explicit about which source the rating applies to
- ✅ **Hub-scoped sources**: Works well with hub-provided sources

#### Cons
- ⚠️ **Schema migration**: Requires updating existing ratings.json files
- ⚠️ **Harvesting complexity**: GitHub Discussions need to encode source information

#### Implementation Impact

**Files to Update:**
1. `src/services/engagement/RatingService.ts` - Update `BundleRating` interface
2. `src/services/engagement/RatingCache.ts` - Use composite key for lookups
3. `src/services/engagement/FeedbackService.ts` - Update `BundleFeedbackCollection` interface
4. `src/services/engagement/FeedbackCache.ts` - Use composite key for lookups
5. `lib/src/compute-ratings.ts` - Output sourceId in ratings.json
6. `lib/src/harvest-feedbacks.ts` - Output sourceId in feedbacks.json (to be created)
7. `schemas/ratings.schema.json` - Add sourceId as required field (if exists)
8. `docs/reference/hub-schema.md` - Update data file structure examples

**Code Example:**
```typescript
// RatingCache.ts
getRating(sourceId: string, bundleId: string): CachedRating | undefined {
    const key = `${sourceId}:${bundleId}`;
    return this.cache.get(key);
}
```

---

### Option 2: Hub-Scoped Bundle IDs

**Scope engagement data to the hub level, assuming bundle IDs are unique within a hub.**

#### Schema Change

```json
{
  "version": "1.0.0",
  "generated": "2025-01-29T10:00:00Z",
  "hubId": "my-company-hub",  // Hub context
  "bundles": [
    {
      "bundleId": "react-helpers",  // Unique within this hub
      "upvotes": 45,
      "downvotes": 3
    }
  ]
}
```

#### Pros
- ✅ **Simpler schema**: No composite keys needed
- ✅ **Hub-centric**: Aligns with hub-based distribution model
- ✅ **Less migration**: Existing data might work if hub-scoped

#### Cons
- ❌ **Assumption-based**: Assumes hub maintainers ensure unique IDs
- ❌ **Cross-hub conflicts**: Same bundle from different hubs can't be distinguished
- ❌ **Multi-source hubs**: Doesn't solve the problem for hubs with multiple sources
- ❌ **Client mismatch**: Extension still needs sourceId for resolution

---

### Option 3: Fully Qualified Bundle Identifier

**Use a URI-like format for globally unique bundle identification.**

#### Schema Change

```json
{
  "version": "1.0.0",
  "generated": "2025-01-29T10:00:00Z",
  "bundles": [
    {
      "bundleUri": "hub://my-company-hub/awesome-copilot-official/react-helpers",
      "upvotes": 45,
      "downvotes": 3
    }
  ]
}
```

#### Pros
- ✅ **Globally unique**: URI format ensures uniqueness
- ✅ **Extensible**: Can add version, etc. (e.g., `@1.0.0`)
- ✅ **Future-proof**: Works with any distribution model

#### Cons
- ❌ **Over-engineered**: Too complex for current needs
- ❌ **Parsing overhead**: Requires URI parsing/validation
- ❌ **Client changes**: Significant refactoring needed

---

### Option 4: Keep Simple ID + Source Mapping

**Keep simple bundleId in engagement data, provide separate source mapping.**

#### Schema Change

```json
{
  "version": "1.0.0",
  "generated": "2025-01-29T10:00:00Z",
  "sourceMapping": {
    "react-helpers": "awesome-copilot-official"
  },
  "bundles": [
    {
      "bundleId": "react-helpers",
      "upvotes": 45,
      "downvotes": 3
    }
  ]
}
```

#### Pros
- ✅ **Backward compatible**: Existing data still works
- ✅ **Optional migration**: Can add mapping incrementally

#### Cons
- ❌ **Doesn't solve collisions**: Still fails if two sources have same bundle ID
- ❌ **Mapping maintenance**: Extra data structure to maintain
- ❌ **Ambiguity**: What if mapping is missing?

---

## Recommendation: Option 1 (Composite Key)

### Rationale

1. **Matches Extension Architecture**: The extension already uses `sourceId` + `bundleId` everywhere
2. **Solves the Problem Completely**: No ambiguity, no collisions
3. **Clear Semantics**: Explicit about which source the engagement data applies to
4. **Minimal Complexity**: Simple to implement and understand

### Migration Path

#### Phase 1: Update Type Definitions
```typescript
// src/services/engagement/RatingService.ts
export interface BundleRating {
    sourceId: string;      // NEW: Required field
    bundleId: string;
    upvotes: number;
    downvotes: number;
    wilsonScore: number;
    starRating: number;
    voteCount: number;
    confidence: string;
}
```

#### Phase 2: Update Cache Lookups
```typescript
// src/services/engagement/RatingCache.ts
getRating(sourceId: string, bundleId: string): CachedRating | undefined {
    const key = `${sourceId}:${bundleId}`;
    return this.cache.get(key);
}

// Update all call sites
const rating = ratingCache.getRating(bundle.sourceId, bundle.id);
```

#### Phase 3: Update CLI Tools
```typescript
// lib/src/compute-ratings.ts
const output = {
    version: '1.0.0',
    generated: new Date().toISOString(),
    bundles: discussions.map(d => ({
        sourceId: d.sourceId,  // NEW: Extract from discussion metadata
        bundleId: d.bundleId,
        upvotes: d.upvotes,
        downvotes: d.downvotes,
        // ... rest of fields
    }))
};
```

#### Phase 4: Update Documentation
- Update `docs/reference/hub-schema.md` with new structure
- Update example ratings.json and feedbacks.json files
- Add migration guide for existing hub maintainers

### Backward Compatibility Strategy

**Support both formats during transition:**

```typescript
// RatingCache.ts
private parseRating(data: any): CachedRating {
    if (data.sourceId) {
        // New format with sourceId
        return { ...data, cachedAt: Date.now() };
    } else {
        // Legacy format without sourceId
        // Try to infer sourceId from hub context or use default
        this.logger.warn(`Rating for ${data.bundleId} missing sourceId, using default`);
        return { ...data, sourceId: 'unknown', cachedAt: Date.now() };
    }
}
```

---

## Implementation Checklist

### Core Services
- [ ] Update `BundleRating` interface to include `sourceId`
- [ ] Update `BundleFeedbackCollection` interface to include `sourceId`
- [ ] Update `RatingCache.getRating()` to accept `sourceId` parameter
- [ ] Update `FeedbackCache.getFeedbacks()` to accept `sourceId` parameter
- [ ] Update all call sites in `MarketplaceViewProvider`, `RegistryManager`, etc.

### CLI Tools
- [ ] Update `lib/src/compute-ratings.ts` to output `sourceId`
- [ ] Update `lib/src/harvest-feedbacks.ts` to output `sourceId` (when created)
- [ ] Add `sourceId` extraction logic from GitHub Discussions metadata

### Testing
- [ ] Update `RatingCache.test.ts` with sourceId in test data
- [ ] Update `FeedbackCache.test.ts` with sourceId in test data
- [ ] Add tests for composite key lookups
- [ ] Add tests for backward compatibility (legacy format)

### Documentation
- [ ] Update `docs/reference/hub-schema.md` with new structure
- [ ] Add migration guide for hub maintainers
- [ ] Update example files in documentation

### Schema Validation
- [ ] Update JSON schemas (if they exist) to require `sourceId`
- [ ] Update hub-config.schema.json examples

---

## Alternative Consideration: GitHub Discussions Metadata

### How to Encode Source Information in Discussions

When using GitHub Discussions as the engagement backend, we need to encode source information in the discussion metadata:

**Option A: Discussion Title**
```
[awesome-copilot-official] React Helpers - Feedback & Ratings
```

**Option B: Discussion Labels**
```
source:awesome-copilot-official
bundle:react-helpers
```

**Option C: Discussion Body (Structured)**
```markdown
# React Helpers

**Source**: awesome-copilot-official
**Bundle ID**: react-helpers
**Version**: 1.0.0

---
Discussion for feedback and ratings...
```

**Recommendation**: Use **Option C** (structured body) as it's most flexible and doesn't pollute titles/labels.

---

## Conclusion

**Adopt Option 1 (Composite Key)** with the following approach:

1. **Immediate**: Update type definitions to include `sourceId`
2. **Short-term**: Update cache lookups and call sites
3. **Medium-term**: Update CLI tools to output sourceId
4. **Long-term**: Deprecate legacy format support after 2-3 releases

This approach:
- ✅ Solves the uniqueness problem completely
- ✅ Aligns with existing extension architecture
- ✅ Provides clear migration path
- ✅ Maintains backward compatibility during transition
- ✅ Sets foundation for future enhancements

**Estimated Effort**: 2-3 days for full implementation and testing
**Risk Level**: Low (well-understood problem, clear solution)
**Breaking Change**: Yes, but with backward compatibility support

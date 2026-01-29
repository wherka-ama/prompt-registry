# Marketplace Rating Sort and Feedback Display

## Overview

Add comprehensive rating and feedback features to the marketplace:
1. Sort bundles by rating (ascending/descending)
2. Display ratings prominently on bundle tiles
3. Clickable ratings that show user feedbacks
4. Feedback display in bundle details page
5. Standardized feedback collection/storage structure

## Current State Analysis

### Existing Components

**MarketplaceViewProvider** (`src/ui/MarketplaceViewProvider.ts`):
- Has search, source filter, tag filter, installed filter
- Renders bundle tiles with inline rating display: `bundle.rating.displayText`
- Shows vote count and confidence in tooltip
- Uses `renderBundles()` function that applies filters sequentially
- No sorting mechanism currently implemented

**Rating Data Flow**:
- `RatingCache` fetches ratings from hub's `ratings.json` URL
- Bundle tiles receive rating data in `enhancedBundles` array
- Rating format: `{ displayText: string, voteCount: number, confidence: string }`

**Feedback Storage** (`src/storage/EngagementStorage.ts`):
- Already has `Feedback` type with: id, resourceType, resourceId, comment, timestamp, version, rating
- Methods: `saveFeedback()`, `getFeedback()`, `getAllFeedback()`, `deleteFeedback()`
- Storage location: `globalStorage/engagement/feedback.json`
- Max 1000 feedback entries (auto-trimmed)

### Gaps to Address

1. ❌ No sorting by rating implemented
2. ❌ No UI to display collected feedbacks
3. ❌ Rating display not prominent/clickable
4. ❌ No feedback harvesting from remote sources (GitHub Discussions)
5. ❌ No feedback.json structure for static hosting (like ratings.json)

## Implementation Plan

### Phase 1: Rating Sort in Marketplace

**Add Sort Controls**:
```html
<div class="filter-group">
    <label class="filter-label">Sort:</label>
    <select class="filter-select" id="sortSelect">
        <option value="name-asc">Name (A-Z)</option>
        <option value="name-desc">Name (Z-A)</option>
        <option value="rating-desc">Rating (High to Low)</option>
        <option value="rating-asc">Rating (Low to High)</option>
        <option value="recent">Recently Updated</option>
    </select>
</div>
```

**Sort Logic** (in `renderBundles()` after filtering):
```javascript
// Apply sorting
switch (selectedSort) {
    case 'rating-desc':
        filteredBundles.sort((a, b) => {
            const ratingA = a.rating?.wilsonScore ?? 0;
            const ratingB = b.rating?.wilsonScore ?? 0;
            return ratingB - ratingA;
        });
        break;
    case 'rating-asc':
        filteredBundles.sort((a, b) => {
            const ratingA = a.rating?.wilsonScore ?? 0;
            const ratingB = b.rating?.wilsonScore ?? 0;
            return ratingA - ratingB;
        });
        break;
    case 'name-asc':
        filteredBundles.sort((a, b) => a.name.localeCompare(b.name));
        break;
    case 'name-desc':
        filteredBundles.sort((a, b) => b.name.localeCompare(a.name));
        break;
    case 'recent':
        // Sort by version/update timestamp if available
        break;
}
```

### Phase 2: Enhanced Rating Display on Tiles

**Current Display** (inline in author line):
```html
<div class="bundle-author">
    by ${bundle.author} • v${bundle.version}${bundle.rating ? ' • ' + bundle.rating.displayText : ''}
</div>
```

**New Prominent Display**:
```html
<div class="bundle-header">
    <div class="bundle-title-row">
        <div class="bundle-title">${bundle.name}</div>
        ${bundle.rating ? `
            <button class="rating-badge clickable" 
                    onclick="showFeedbacks('${bundle.id}', event)" 
                    title="${bundle.rating.voteCount} votes (${bundle.rating.confidence} confidence)">
                <span class="rating-stars">${renderStars(bundle.rating.starRating)}</span>
                <span class="rating-score">${bundle.rating.wilsonScore.toFixed(1)}</span>
                <span class="rating-votes">(${bundle.rating.voteCount})</span>
            </button>
        ` : ''}
    </div>
    <div class="bundle-author">by ${bundle.author} • v${bundle.version}</div>
</div>
```

**Star Rendering Helper**:
```javascript
function renderStars(rating) {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    
    return '★'.repeat(fullStars) + 
           (hasHalfStar ? '⯨' : '') + 
           '☆'.repeat(emptyStars);
}
```

**CSS for Rating Badge**:
```css
.rating-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
}

.rating-badge.clickable {
    cursor: pointer;
    border: 1px solid transparent;
}

.rating-badge.clickable:hover {
    background: var(--vscode-list-hoverBackground);
    border-color: var(--vscode-focusBorder);
}

.rating-stars {
    color: #ffa500; /* Orange for stars */
    font-size: 14px;
}

.rating-score {
    font-weight: 600;
}

.rating-votes {
    opacity: 0.8;
    font-size: 11px;
}
```

### Phase 3: Feedback Display Modal

**Add Feedback Modal to HTML**:
```html
<div id="feedbackModal" class="modal" style="display: none;">
    <div class="modal-content">
        <div class="modal-header">
            <h2 id="feedbackModalTitle">User Feedbacks</h2>
            <button class="modal-close" onclick="closeFeedbackModal()">×</button>
        </div>
        <div class="modal-body">
            <div class="feedback-summary">
                <div class="rating-breakdown">
                    <div class="rating-overview">
                        <div class="rating-large">${averageRating}</div>
                        <div class="rating-stars-large">${renderStars(averageRating)}</div>
                        <div class="rating-count">${totalVotes} ratings</div>
                    </div>
                    <div class="rating-bars">
                        <!-- Distribution bars for 5-1 stars -->
                    </div>
                </div>
            </div>
            <div class="feedback-list" id="feedbackList">
                <!-- Feedback items will be populated here -->
            </div>
        </div>
    </div>
</div>
```

**Feedback Item Template**:
```html
<div class="feedback-item">
    <div class="feedback-header">
        <div class="feedback-rating">${renderStars(feedback.rating)}</div>
        <div class="feedback-meta">
            <span class="feedback-date">${formatDate(feedback.timestamp)}</span>
            ${feedback.version ? `<span class="feedback-version">v${feedback.version}</span>` : ''}
        </div>
    </div>
    <div class="feedback-comment">${escapeHtml(feedback.comment)}</div>
</div>
```

**JavaScript Handler**:
```javascript
async function showFeedbacks(bundleId, event) {
    event.stopPropagation();
    
    // Request feedback data from extension
    vscode.postMessage({ 
        type: 'getFeedbacks', 
        bundleId: bundleId 
    });
    
    // Show modal with loading state
    document.getElementById('feedbackModal').style.display = 'flex';
    document.getElementById('feedbackList').innerHTML = '<div class="loading">Loading feedbacks...</div>';
}

// Handle response from extension
window.addEventListener('message', event => {
    const message = event.data;
    
    if (message.type === 'feedbacksLoaded') {
        renderFeedbacks(message.bundleId, message.feedbacks, message.ratingStats);
    }
});
```

### Phase 4: Feedback Display in Bundle Details

**Add Expandable Feedback Section** (after bundle description):
```html
<div class="details-section">
    <div class="section-header" onclick="toggleSection('feedbacks')">
        <h3>User Feedbacks</h3>
        <span class="section-toggle" id="feedbacks-toggle">▾</span>
    </div>
    <div class="section-content" id="feedbacks-content">
        <div class="feedback-summary">
            <!-- Same rating breakdown as modal -->
        </div>
        <div class="feedback-list">
            <!-- Feedback items -->
        </div>
    </div>
</div>
```

### Phase 5: Feedback Harvesting and Storage

**Create `FeedbackHarvester` Service** (`src/services/engagement/FeedbackHarvester.ts`):
```typescript
export class FeedbackHarvester {
    /**
     * Harvest feedbacks from GitHub Discussions
     * Similar to compute-ratings.ts but for comments
     */
    async harvestFromGitHubDiscussions(
        repository: string,
        collectionsConfig: CollectionsConfig,
        token: string
    ): Promise<FeedbackCollection> {
        // Fetch discussion comments
        // Parse comment text for feedback
        // Extract rating from reactions or comment format
        // Return structured feedback data
    }
    
    /**
     * Export feedbacks to JSON for static hosting
     */
    async exportToJson(
        feedbacks: Feedback[],
        outputPath: string
    ): Promise<void> {
        const feedbacksByBundle = groupBy(feedbacks, 'resourceId');
        
        const output = {
            version: '1.0.0',
            generated: new Date().toISOString(),
            bundles: Object.entries(feedbacksByBundle).map(([bundleId, items]) => ({
                bundleId,
                feedbacks: items.map(f => ({
                    id: f.id,
                    rating: f.rating,
                    comment: f.comment,
                    timestamp: f.timestamp,
                    version: f.version
                }))
            }))
        };
        
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
    }
}
```

**Feedback JSON Structure** (`feedbacks.json`):
```json
{
    "version": "1.0.0",
    "generated": "2026-01-29T08:00:00Z",
    "bundles": [
        {
            "bundleId": "owner/repo/bundle-name",
            "feedbacks": [
                {
                    "id": "uuid",
                    "rating": 5,
                    "comment": "Excellent bundle! Very helpful prompts.",
                    "timestamp": "2026-01-20T10:30:00Z",
                    "version": "1.2.0"
                }
            ]
        }
    ]
}
```

**Add to Hub Config**:
```yaml
engagement:
  enabled: true
  ratings:
    enabled: true
    ratingsUrl: https://example.com/ratings.json
  feedback:
    enabled: true
    feedbackUrl: https://example.com/feedbacks.json  # New field
```

### Phase 6: CLI Tool for Feedback Harvesting

**Add to `lib/bin/harvest-feedbacks.js`**:
```javascript
#!/usr/bin/env node
const { harvestFeedbacks, parseArgs } = require('../dist/harvest-feedbacks');

async function main() {
    const args = process.argv.slice(2);
    const { configPath, outputPath } = parseArgs(args);
    
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        console.error('Error: GITHUB_TOKEN environment variable is required');
        process.exit(1);
    }
    
    try {
        await harvestFeedbacks(configPath, outputPath, token);
    } catch (error) {
        console.error('Fatal error:', error.message);
        process.exit(1);
    }
}

main();
```

**GitHub Workflow** (`.github/workflows/harvest-feedbacks.yml`):
```yaml
name: Harvest Feedbacks

on:
  schedule:
    - cron: '0 0 * * 0'  # Weekly on Sunday
  workflow_dispatch:

jobs:
  harvest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx harvest-feedbacks --config collections.yaml --output feedbacks.json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Commit feedbacks
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add feedbacks.json
          git commit -m "chore: update feedbacks [skip ci]" || exit 0
          git push
```

## Implementation Order

1. ✅ **Phase 1**: Add sort dropdown and logic (30 min)
2. ✅ **Phase 2**: Enhanced rating display on tiles (45 min)
3. ✅ **Phase 3**: Feedback modal implementation (1.5 hours)
4. ✅ **Phase 4**: Feedback section in details page (45 min)
5. ✅ **Phase 5**: Feedback harvesting service (2 hours)
6. ✅ **Phase 6**: CLI tool and workflow (1 hour)

**Total Estimated Time**: ~6.5 hours

## Testing Strategy

1. **Unit Tests**:
   - Sort logic with various rating scenarios
   - Feedback harvesting from mock GitHub API
   - JSON export/import

2. **Integration Tests**:
   - Full feedback flow: harvest → store → display
   - Rating sort with filters applied

3. **Manual Testing**:
   - Visual verification of rating badges
   - Modal interaction and responsiveness
   - Feedback display in details page

## Open Questions

1. **Feedback Moderation**: Do we need a way to flag/hide inappropriate feedback?
2. **Pagination**: Should feedback list be paginated for bundles with many feedbacks?
3. **Sorting Feedbacks**: Sort by date, rating, or helpfulness votes?
4. **Anonymous Feedback**: Allow anonymous submissions or require GitHub auth?
5. **Feedback Editing**: Can users edit their feedback after submission?

## Future Enhancements

- Feedback helpfulness voting (👍/👎)
- Verified purchase/install badge
- Response from bundle authors
- Feedback search/filter
- Export user's own feedbacks

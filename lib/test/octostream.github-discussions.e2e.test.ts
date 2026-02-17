/**
 * Real GitHub Discussions E2E for OctoStream.
 *
 * Opt-in only. This suite is skipped unless:
 * - OCTOSTREAM_ENABLE_GITHUB_E2E=true
 * - GITHUB_TOKEN is set
 * - OCTOSTREAM_TEST_OWNER is set
 * - OCTOSTREAM_TEST_REPO is set
 * - OCTOSTREAM_TEST_DISCUSSION_NUMBER is set
 *
 * Cursor behavior:
 * - Default prefix is stable: OCTOSTREAM_E2E (reuses the same cursor variable per discussion)
 * - Set OCTOSTREAM_CURSOR_PREFIX to override
 * - Set OCTOSTREAM_UNIQUE_CURSOR_PREFIX=true to generate a unique prefix per run
 */

import * as assert from 'assert';
import {
  GitHubDiscussionsClient,
  GitHubDiscussionEventSource,
  OctoStreamEngine,
  OctoStreamEvent,
} from '../src/octostream';
import { parseStarRatingFromComment } from '../src/compute-ratings';

interface GitHubE2EConfig {
  token: string;
  owner: string;
  repo: string;
  discussionNumber: number;
  cursorPrefix: string;
}

function getGitHubE2EConfig(): GitHubE2EConfig | null {
  if (process.env.OCTOSTREAM_ENABLE_GITHUB_E2E !== 'true') {
    return null;
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.OCTOSTREAM_TEST_OWNER;
  const repo = process.env.OCTOSTREAM_TEST_REPO;
  const discussionNumberRaw = process.env.OCTOSTREAM_TEST_DISCUSSION_NUMBER;

  if (!token || !owner || !repo || !discussionNumberRaw) {
    return null;
  }

  const discussionNumber = Number.parseInt(discussionNumberRaw, 10);
  if (!Number.isFinite(discussionNumber) || discussionNumber <= 0) {
    return null;
  }

  const useUniqueCursorPrefix = process.env.OCTOSTREAM_UNIQUE_CURSOR_PREFIX === 'true';
  const cursorPrefix = process.env.OCTOSTREAM_CURSOR_PREFIX
    ?? (useUniqueCursorPrefix
      ? `OCTOSTREAM_E2E_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
      : 'OCTOSTREAM_E2E');

  return {
    token,
    owner,
    repo,
    discussionNumber,
    cursorPrefix,
  };
}

interface AggregatedRatings {
  average: number;
  count: number;
}

interface CollectionsCollectionRating {
  source_id: string;
  discussion_number: number;
  up: number;
  down: number;
  wilson_score: number;
  bayesian_score: number;
  aggregated_score: number;
  star_rating: number;
  rating_count: number;
  confidence: string;
  resources: Record<string, unknown>;
}

interface CollectionsRatingsData {
  generated_at: string;
  repository: string;
  collections: Record<string, CollectionsCollectionRating>;
}

interface ExtensionBundleRating {
  sourceId: string;
  bundleId: string;
  upvotes: number;
  downvotes: number;
  wilsonScore: number;
  starRating: number;
  totalVotes: number;
  lastUpdated: string;
  discussionNumber: number;
  confidence: string;
}

interface ExtensionRatingsData {
  version: string;
  generatedAt: string;
  bundles: Record<string, ExtensionBundleRating>;
}

type RatingScore = 1 | 2 | 3 | 4 | 5;

function getConfidenceLevel(voteCount: number): string {
  if (voteCount >= 100) {
    return 'very_high';
  }
  if (voteCount >= 20) {
    return 'high';
  }
  if (voteCount >= 5) {
    return 'medium';
  }
  return 'low';
}

function toCollectionsRatingsData(
  bundleId: string,
  sourceId: string,
  aggregate: AggregatedRatings,
  discussionNumber: number,
  repository: string
): CollectionsRatingsData {
  const starRating = aggregate.average;
  const normalizedWilson = starRating > 0
    ? Math.round((((starRating - 1) / 4) * 1000)) / 1000
    : 0;

  return {
    generated_at: new Date().toISOString(),
    repository,
    collections: {
      [bundleId]: {
        source_id: sourceId,
        discussion_number: discussionNumber,
        up: 0,
        down: 0,
        wilson_score: normalizedWilson,
        bayesian_score: starRating,
        aggregated_score: normalizedWilson,
        star_rating: starRating,
        rating_count: aggregate.count,
        confidence: getConfidenceLevel(aggregate.count),
        resources: {},
      },
    },
  };
}

function convertCollectionsToBundleFormat(collectionsData: CollectionsRatingsData): ExtensionRatingsData {
  const bundles: Record<string, ExtensionBundleRating> = {};

  for (const [collectionId, collection] of Object.entries(collectionsData.collections)) {
    bundles[collectionId] = {
      sourceId: collection.source_id || 'unknown',
      bundleId: collectionId,
      upvotes: collection.up,
      downvotes: collection.down,
      wilsonScore: collection.wilson_score,
      starRating: collection.star_rating,
      totalVotes: collection.rating_count || 0,
      lastUpdated: collectionsData.generated_at,
      discussionNumber: collection.discussion_number,
      confidence: collection.confidence,
    };
  }

  return {
    version: '1.0.0',
    generatedAt: collectionsData.generated_at,
    bundles,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function postFeedbackComment(
  client: GitHubDiscussionsClient,
  discussionId: string,
  marker: string,
  feedback: string,
  rating?: RatingScore
): Promise<void> {
  const lines: string[] = [];

  if (rating) {
    lines.push(`Rating: ${'⭐'.repeat(rating)}`);
  }

  lines.push(`Feedback: ${feedback}`);
  lines.push('---');
  lines.push('Version: e2e-test');
  lines.push(`Run: ${marker}`);

  await client.addDiscussionComment(discussionId, lines.join('\n'));
}

async function collectMarkerEvents(
  source: GitHubDiscussionEventSource,
  marker: string,
  minEvents: number,
  maxAttempts: number = 6,
  delayMs: number = 500
): Promise<OctoStreamEvent[]> {
  const events: OctoStreamEvent[] = [];
  const seenEventIds = new Set<string>();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const engine = new OctoStreamEngine(source, {
      handle: async (event: OctoStreamEvent) => {
        if (!event.body.includes(marker)) {
          return;
        }

        if (!seenEventIds.has(event.id)) {
          seenEventIds.add(event.id);
          events.push(event);
        }
      },
    });

    await engine.run();

    if (events.length >= minEvents) {
      return events;
    }

    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }

  return events;
}

function computeLatestByAuthor(events: OctoStreamEvent[]): AggregatedRatings {
  const byAuthor = new Map<string, { createdAt: string; rating: number }>();

  for (const event of events) {
    const rating = parseStarRatingFromComment(event.body);
    if (rating === null) {
      continue;
    }

    const authorKey = event.author?.login ?? `anonymous_${event.createdAt}_${event.id}`;
    const existing = byAuthor.get(authorKey);
    if (!existing || event.createdAt > existing.createdAt) {
      byAuthor.set(authorKey, { createdAt: event.createdAt, rating });
    }
  }

  const ratings = Array.from(byAuthor.values()).map((entry) => entry.rating);
  if (ratings.length === 0) {
    return { average: 0, count: 0 };
  }

  const sum = ratings.reduce((acc, rating) => acc + rating, 0);
  return {
    average: Math.round((sum / ratings.length) * 10) / 10,
    count: ratings.length,
  };
}

const config = getGitHubE2EConfig();
const describeIfEnabled = config ? describe : describe.skip;

describeIfEnabled('OctoStream GitHub Discussions E2E', function () {
  this.timeout(180000);

  let discussionId: string;
  let source: GitHubDiscussionEventSource;
  let client: GitHubDiscussionsClient;
  let runMarker: string;

  before(async function () {
    if (!config) {
      this.skip();
      return;
    }

    client = new GitHubDiscussionsClient({
      token: config.token,
      owner: config.owner,
      repo: config.repo,
    });

    source = new GitHubDiscussionEventSource(
      client,
      config.discussionNumber,
      config.cursorPrefix
    );

    discussionId = await client.getDiscussionIdByNumber(config.discussionNumber);
    runMarker = `octostream-e2e-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    // Prime the cursor so the test run only processes newly posted comments.
    const primingEngine = new OctoStreamEngine(source, {
      handle: async () => undefined,
    });
    await primingEngine.run();

    const commentBody = [
      'Rating: ⭐⭐⭐⭐⭐',
      `Feedback: OctoStream E2E comment (${runMarker})`,
      '---',
      'Version: e2e-test',
      `Run: ${runMarker}`,
    ].join('\n');

    await client.addDiscussionComment(discussionId, commentBody);
  });

  it('E2E-02: should ingest a single new 5-star feedback comment', async () => {
    const markerEvents = await collectMarkerEvents(source, runMarker, 1);
    assert.strictEqual(markerEvents.length, 1, 'Expected exactly one event for this run marker');

    const aggregate = computeLatestByAuthor(markerEvents);
    assert.strictEqual(aggregate.average, 5, 'Expected 5.0 average for marker event(s)');
    assert.strictEqual(aggregate.count, 1, 'Expected one effective rating for marker event(s)');
  });

  it('E2E-03: should be idempotent on immediate rerun', async () => {
    const markerEventsOnRerun: OctoStreamEvent[] = [];

    const rerunEngine = new OctoStreamEngine(source, {
      handle: async (event: OctoStreamEvent) => {
        if (event.body.includes(runMarker)) {
          markerEventsOnRerun.push(event);
        }
      },
    });

    await rerunEngine.run();

    assert.strictEqual(
      markerEventsOnRerun.length,
      0,
      'Expected no marker events to be reprocessed on rerun'
    );
  });

  it('E2E-04: should simulate producer and consumer flow and aggregate to extension ratings format', async () => {
    const activeConfig = config as GitHubE2EConfig;
    const fullFlowMarker = `octostream-e2e-full-flow-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    // Producer simulation: multiple feedback events for the same run marker.
    await postFeedbackComment(client, discussionId, fullFlowMarker, 'Initial rating before update', 3);
    await sleep(1200);
    await postFeedbackComment(client, discussionId, fullFlowMarker, 'Updated after issue fix', 5);
    await postFeedbackComment(client, discussionId, fullFlowMarker, 'General comment without stars');

    const markerEvents = await collectMarkerEvents(source, fullFlowMarker, 3);
    assert.ok(markerEvents.length >= 3, 'Expected to ingest producer events for full-flow marker');

    const aggregate = computeLatestByAuthor(markerEvents);
    assert.strictEqual(aggregate.average, 5, 'Latest user rating should win in aggregate');
    assert.strictEqual(aggregate.count, 1, 'Expected one effective rating after deduplication by author');

    const bundleId = process.env.OCTOSTREAM_TEST_BUNDLE_ID || 'octostream-e2e-bundle';
    const sourceId = process.env.OCTOSTREAM_TEST_SOURCE_ID || 'octostream-e2e-source';

    const collectionsData = toCollectionsRatingsData(
      bundleId,
      sourceId,
      aggregate,
      activeConfig.discussionNumber,
      `${activeConfig.owner}/${activeConfig.repo}`
    );

    const extensionRatings = convertCollectionsToBundleFormat(collectionsData);
    const bundleRating = extensionRatings.bundles[bundleId];

    assert.ok(bundleRating, 'Expected converted bundle rating for extension format');
    assert.strictEqual(bundleRating.sourceId, sourceId);
    assert.strictEqual(bundleRating.bundleId, bundleId);
    assert.strictEqual(bundleRating.discussionNumber, activeConfig.discussionNumber);
    assert.strictEqual(bundleRating.starRating, 5);
    assert.strictEqual(bundleRating.totalVotes, 1);
    assert.strictEqual(bundleRating.confidence, 'low');
  });
});

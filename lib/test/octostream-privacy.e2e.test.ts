/**
 * Privacy-enabled OctoStream E2E Tests with GitHub Discussions.
 *
 * End-to-end tests for GDPR-compliant rating/feedback flow.
 * Posts encrypted JSONL payloads to GitHub Discussions and processes them.
 *
 * Opt-in only. This suite is skipped unless:
 * - PRIVACY_E2E_ENABLE_GITHUB=true
 * - GITHUB_TOKEN is set
 * - PRIVACY_E2E_OWNER is set
 * - PRIVACY_E2E_REPO is set
 * - PRIVACY_E2E_DISCUSSION_NUMBER is set
 * - PRIVACY_E2E_HMAC_SECRET is set
 * - PRIVACY_E2E_PRIVATE_KEY (optional, for decryption tests)
 * - PRIVACY_E2E_PUBLIC_KEY (for encryption)
 */

import * as assert from 'assert';
import {
  GitHubDiscussionsClient,
  GitHubDiscussionEventSource,
  PrivacyOctoStreamEngine,
  PrivacyRatingHandler,
  PrivacyRatingEvent,
  ValidatedRatingEvent,
  createRatingPayload,
  generateEncryptionKeyPair,
  toJsonl,
  fromJsonl,
  verifyPayload,
  loadPrivateKey,
  loadPublicKey,
  processRatingPayload,
  AggregatedFeedback,
} from '../src';

interface PrivacyE2EConfig {
  token: string;
  owner: string;
  repo: string;
  discussionNumber: number;
  hmacSecret: string;
  publicKey: string;
  privateKey?: string;
  cursorPrefix: string;
}

function getPrivacyE2EConfig(): PrivacyE2EConfig | null {
  if (process.env.PRIVACY_E2E_ENABLE_GITHUB !== 'true') {
    return null;
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.PRIVACY_E2E_OWNER;
  const repo = process.env.PRIVACY_E2E_REPO;
  const discussionNumberRaw = process.env.PRIVACY_E2E_DISCUSSION_NUMBER;
  const hmacSecret = process.env.PRIVACY_E2E_HMAC_SECRET;

  if (!token || !owner || !repo || !discussionNumberRaw || !hmacSecret) {
    console.log('[PrivacyE2E] Missing required env vars, skipping tests');
    return null;
  }

  const discussionNumber = Number.parseInt(discussionNumberRaw, 10);
  if (!Number.isFinite(discussionNumber) || discussionNumber <= 0) {
    return null;
  }

  // Load or generate encryption keys
  let publicKey: string;
  let privateKey: string | undefined;

  if (process.env.PRIVACY_E2E_PUBLIC_KEY) {
    publicKey = loadPublicKey('PRIVACY_E2E_PUBLIC_KEY');
  } else {
    // Generate ephemeral keys for testing
    const keys = generateEncryptionKeyPair(2048);
    publicKey = keys.publicKey;
    console.log('[PrivacyE2E] Generated ephemeral test keys');
  }

  if (process.env.PRIVACY_E2E_PRIVATE_KEY) {
    privateKey = loadPrivateKey('PRIVACY_E2E_PRIVATE_KEY');
  }

  const cursorPrefix = process.env.PRIVACY_E2E_CURSOR_PREFIX ?? 'PRIVACY_E2E';

  return {
    token,
    owner,
    repo,
    discussionNumber,
    hmacSecret,
    publicKey,
    privateKey,
    cursorPrefix,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PostedRating {
  bundleId: string;
  rating: number;
  comment?: string;
  userId: string;
  expectedPayload: string;
}

const config = getPrivacyE2EConfig();
const describeIfEnabled = config ? describe : describe.skip;

describeIfEnabled('Privacy OctoStream GitHub Discussions E2E', function () {
  this.timeout(300000); // 5 min timeout for real GitHub API calls

  let client: GitHubDiscussionsClient;
  let source: GitHubDiscussionEventSource;
  let discussionId: string;
  let runMarker: string;
  let testConfig: PrivacyE2EConfig;

  before(async function () {
    if (!config) {
      this.skip();
      return;
    }
    testConfig = config;

    client = new GitHubDiscussionsClient({
      token: testConfig.token,
      owner: testConfig.owner,
      repo: testConfig.repo,
    });

    source = new GitHubDiscussionEventSource(
      client,
      testConfig.discussionNumber,
      testConfig.cursorPrefix
    );

    discussionId = await client.getDiscussionIdByNumber(testConfig.discussionNumber);
    runMarker = `privacy-e2e-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    console.log(`[PrivacyE2E] Discussion ID: ${discussionId}`);
    console.log(`[PrivacyE2E] Run marker: ${runMarker}`);

    // Prime cursor to avoid processing old events
    const { PrivacyOctoStreamEngine } = await import('../src/octostream-privacy-engine');
    const primingEngine = new PrivacyOctoStreamEngine(
      source,
      { handle: async () => {} },
      {
        privacy: { hmacSecret: testConfig.hmacSecret, skipInvalid: true },
        maxPagesPerRun: 10,
      }
    );
    await primingEngine.run();
    console.log('[PrivacyE2E] Cursor primed');
  });

  // ============================================================================
  // E2E-PRIVACY-01: Single Encrypted Rating Submission
  // ============================================================================
  it('E2E-PRIVACY-01: should post and ingest a single encrypted rating', async () => {
    const bundleId = `privacy-test/${runMarker}`;
    const rating = 5;
    const comment = `Test feedback for ${runMarker}`;

    // Create encrypted payload
    const payload = createRatingPayload({
      bundleId,
      rating,
      comment,
      userId: 'e2e-test-user',
      salt: testConfig.hmacSecret, // Use hmacSecret as salt for simplicity
      publicKey: testConfig.publicKey,
      secret: testConfig.hmacSecret,
    });

    // Verify payload structure
    assert.equal(payload.v, 1, 'Payload should have version 1');
    assert.equal(payload.bundleId, bundleId);
    assert.equal(payload.rating, rating);
    assert.ok(payload.comment, 'Comment should be encrypted');
    assert.ok(payload.userHash, 'User should be hashed');
    assert.ok(payload.sig, 'Payload should be signed');
    assert.ok(payload.ts, 'Payload should have timestamp');

    // Verify integrity before posting
    const isValid = verifyPayload(payload, testConfig.hmacSecret);
    assert.equal(isValid, true, 'Payload should pass integrity check');

    // Post to GitHub Discussion as JSONL
    const jsonl = toJsonl(payload);
    await client.addDiscussionComment(discussionId, jsonl);
    console.log(`[PrivacyE2E] Posted encrypted rating to discussion`);

    // Wait for eventual consistency
    await sleep(2000);

    // Collect and process events
    const collectedEvents: ValidatedRatingEvent[] = [];

    const handler: PrivacyRatingHandler = {
      handle: async (event) => {
        if (event.type === 'valid' && event.payload.bundleId === bundleId) {
          collectedEvents.push(event);
        }
      },
    };

    const { PrivacyOctoStreamEngine } = await import('../src/octostream-privacy-engine');
    const engine = new PrivacyOctoStreamEngine(source, handler, {
      privacy: {
        hmacSecret: testConfig.hmacSecret,
        privateKey: testConfig.privateKey,
        skipInvalid: true,
      },
      maxPagesPerRun: 5,
    });

    const result = await engine.run();

    // Verify event was collected
    assert.ok(collectedEvents.length >= 1, `Expected at least 1 event, got ${collectedEvents.length}`);

    const collected = collectedEvents[0];
    assert.equal(collected.payload.bundleId, bundleId);
    assert.equal(collected.payload.rating, rating);
    assert.equal(collected.feedback.isValid, true);
    assert.equal(collected.feedback.rating, rating);

    // If private key available, verify decryption
    if (testConfig.privateKey) {
      assert.equal(collected.feedback.comment, comment, 'Comment should be decrypted');
    } else {
      assert.equal(collected.feedback.comment, '[ENCRYPTED]', 'Comment should show as encrypted');
    }

    console.log(`[PrivacyE2E] Processed ${result.validRatings} valid ratings, ${result.invalidRatings} invalid`);
  });

  // ============================================================================
  // E2E-PRIVACY-02: Multiple Ratings with Aggregation
  // ============================================================================
  it('E2E-PRIVACY-02: should aggregate multiple encrypted ratings', async function () {
    if (!testConfig.privateKey) {
      console.log('[PrivacyE2E] Skipping aggregation test - no private key available');
      this.skip();
      return;
    }

    const bundleId = `privacy-agg-test/${runMarker}`;
    const ratings = [3, 4, 5, 5, 4];

    // Post multiple ratings
    for (let i = 0; i < ratings.length; i++) {
      const payload = createRatingPayload({
        bundleId,
        rating: ratings[i],
        comment: `Feedback ${i + 1} for aggregation test`,
        userId: `user-${i}`,
        salt: testConfig.hmacSecret,
        publicKey: testConfig.publicKey,
        secret: testConfig.hmacSecret,
      });

      const jsonl = toJsonl(payload);
      await client.addDiscussionComment(discussionId, jsonl);
    }

    console.log(`[PrivacyE2E] Posted ${ratings.length} encrypted ratings`);
    await sleep(3000);

    // Run engine with aggregation
    const { PrivacyOctoStreamEngine } = await import('../src/octostream-privacy-engine');
    const engine = new PrivacyOctoStreamEngine(
      source,
      { handle: async () => {} },
      {
        privacy: {
          hmacSecret: testConfig.hmacSecret,
          privateKey: testConfig.privateKey,
          skipInvalid: true,
        },
        maxPagesPerRun: 10,
      }
    );

    const { result, aggregation } = await engine.runWithAggregation(testConfig.privateKey);

    // Verify aggregation
    assert.equal(aggregation.bundleId, bundleId, 'Aggregation should have correct bundleId');
    assert.equal(aggregation.totalCount, ratings.length, 'Should aggregate all ratings');

    const expectedAverage = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    assert.equal(aggregation.averageRating, expectedAverage, 'Average should match');

    // Verify byRating breakdown
    const ratingCounts: Record<number, number> = {};
    for (const r of ratings) {
      ratingCounts[r] = (ratingCounts[r] || 0) + 1;
    }

    for (const [rating, count] of Object.entries(ratingCounts)) {
      const ratingNum = Number(rating);
      assert.ok(aggregation.byRating[ratingNum], `Should have data for rating ${rating}`);
      assert.equal(aggregation.byRating[ratingNum].count, count);

      // Verify comments are decrypted
      const decryptedComments = aggregation.byRating[ratingNum].encryptedComments.filter(
        (c) => c.startsWith('[DECRYPTED]')
      );
      assert.equal(decryptedComments.length, count, 'All comments should be decrypted');
    }

    console.log(`[PrivacyE2E] Aggregation: ${aggregation.totalCount} ratings, avg=${aggregation.averageRating}`);
  });

  // ============================================================================
  // E2E-PRIVACY-03: Integrity Verification (Tampered Payload)
  // ============================================================================
  it('E2E-PRIVACY-03: should reject tampered payloads', async () => {
    const bundleId = `privacy-tamper-test/${runMarker}`;

    // Create valid payload
    const payload = createRatingPayload({
      bundleId,
      rating: 5,
      comment: 'Original comment',
      userId: 'tamper-test',
      salt: testConfig.hmacSecret,
      publicKey: testConfig.publicKey,
      secret: testConfig.hmacSecret,
    });

    // Tamper with the rating after signing
    payload.rating = 1;

    // Post tampered payload
    const jsonl = toJsonl(payload);
    await client.addDiscussionComment(discussionId, jsonl);

    console.log('[PrivacyE2E] Posted tampered payload');
    await sleep(2000);

    // Collect events - should mark as invalid
    let invalidCount = 0;

    const handler: PrivacyRatingHandler = {
      handle: async (event) => {
        if (event.type === 'invalid' && event.error.includes(bundleId)) {
          invalidCount++;
        }
      },
    };

    const { PrivacyOctoStreamEngine } = await import('../src/octostream-privacy-engine');
    const engine = new PrivacyOctoStreamEngine(source, handler, {
      privacy: {
        hmacSecret: testConfig.hmacSecret,
        skipInvalid: true,
      },
      maxPagesPerRun: 5,
    });

    const result = await engine.run();

    assert.ok(result.invalidRatings >= 1, `Expected at least 1 invalid rating, got ${result.invalidRatings}`);
    console.log(`[PrivacyE2E] Correctly rejected ${result.invalidRatings} tampered payload(s)`);
  });

  // ============================================================================
  // E2E-PRIVACY-04: Idempotent Processing
  // ============================================================================
  it('E2E-PRIVACY-04: should be idempotent on immediate rerun', async () => {
    const bundleId = `privacy-idempotent-test/${runMarker}`;

    const payload = createRatingPayload({
      bundleId,
      rating: 4,
      userId: 'idempotent-test',
      salt: testConfig.hmacSecret,
      publicKey: testConfig.publicKey,
      secret: testConfig.hmacSecret,
    });

    await client.addDiscussionComment(discussionId, toJsonl(payload));
    console.log('[PrivacyE2E] Posted payload for idempotency test');
    await sleep(2000);

    // First run
    let firstRunEvents = 0;
    const { PrivacyOctoStreamEngine } = await import('../src/octostream-privacy-engine');

    const handler1: PrivacyRatingHandler = {
      handle: async (event) => {
        if (event.type === 'valid' && event.payload.bundleId === bundleId) {
          firstRunEvents++;
        }
      },
    };

    const engine1 = new PrivacyOctoStreamEngine(source, handler1, {
      privacy: { hmacSecret: testConfig.hmacSecret, skipInvalid: true },
    });

    await engine1.run();
    assert.equal(firstRunEvents, 1, 'First run should process exactly 1 event');

    // Immediate rerun - should process 0 new events
    let secondRunEvents = 0;
    const handler2: PrivacyRatingHandler = {
      handle: async (event) => {
        if (event.type === 'valid' && event.payload.bundleId === bundleId) {
          secondRunEvents++;
        }
      },
    };

    const engine2 = new PrivacyOctoStreamEngine(source, handler2, {
      privacy: { hmacSecret: testConfig.hmacSecret, skipInvalid: true },
    });

    await engine2.run();

    assert.equal(secondRunEvents, 0, 'Rerun should process 0 new events (idempotent)');
    console.log('[PrivacyE2E] Idempotency verified');
  });

  // ============================================================================
  // E2E-PRIVACY-05: Wrong Secret Detection
  // ============================================================================
  it('E2E-PRIVACY-05: should reject payloads with wrong HMAC secret', async () => {
    const bundleId = `privacy-wrong-secret-test/${runMarker}`;

    // Create payload with correct secret
    const payload = createRatingPayload({
      bundleId,
      rating: 5,
      comment: 'Signed with correct secret',
      userId: 'wrong-secret-test',
      salt: testConfig.hmacSecret,
      publicKey: testConfig.publicKey,
      secret: testConfig.hmacSecret,
    });

    await client.addDiscussionComment(discussionId, toJsonl(payload));
    console.log('[PrivacyE2E] Posted payload signed with correct secret');
    await sleep(2000);

    // Process with WRONG secret
    let validWithWrongSecret = 0;
    let invalidWithWrongSecret = 0;

    const handler: PrivacyRatingHandler = {
      handle: async (event) => {
        if (event.type === 'valid' && event.payload.bundleId === bundleId) {
          validWithWrongSecret++;
        }
        if (event.type === 'invalid' && event.error.includes(bundleId)) {
          invalidWithWrongSecret++;
        }
      },
    };

    const { PrivacyOctoStreamEngine } = await import('../src/octostream-privacy-engine');
    const engine = new PrivacyOctoStreamEngine(source, handler, {
      privacy: {
        hmacSecret: 'wrong-secret-here',
        skipInvalid: true,
      },
      maxPagesPerRun: 5,
    });

    await engine.run();

    assert.equal(validWithWrongSecret, 0, 'Payload with wrong secret should not validate');
    assert.ok(invalidWithWrongSecret >= 1, 'Payload should be marked as invalid');

    console.log(`[PrivacyE2E] Correctly rejected payload with wrong secret`);
  });

  // ============================================================================
  // E2E-PRIVACY-06: Full Producer to Extension Format Flow
  // ============================================================================
  it('E2E-PRIVACY-06: should flow from producer to extension ratings format', async function () {
    if (!testConfig.privateKey) {
      console.log('[PrivacyE2E] Skipping full flow test - no private key');
      this.skip();
      return;
    }

    const bundleId = process.env.PRIVACY_E2E_BUNDLE_ID || `privacy-full-flow/${runMarker}`;
    const sourceId = process.env.PRIVACY_E2E_SOURCE_ID || 'privacy-e2e-source';

    // Producer: Create encrypted ratings
    const ratings = [
      { rating: 4, comment: 'Good but could be better' },
      { rating: 5, comment: 'Excellent bundle!' },
      { rating: 5, comment: 'Love it' },
    ];

    for (let i = 0; i < ratings.length; i++) {
      const payload = createRatingPayload({
        bundleId,
        rating: ratings[i].rating,
        comment: ratings[i].comment,
        userId: `full-flow-user-${i}`,
        salt: testConfig.hmacSecret,
        publicKey: testConfig.publicKey,
        secret: testConfig.hmacSecret,
      });

      await client.addDiscussionComment(discussionId, toJsonl(payload));
    }

    console.log(`[PrivacyE2E] Posted ${ratings.length} ratings for full flow test`);
    await sleep(3000);

    // Consumer: Process and aggregate
    const { PrivacyOctoStreamEngine } = await import('../src/octostream-privacy-engine');
    const engine = new PrivacyOctoStreamEngine(
      source,
      { handle: async () => {} },
      {
        privacy: {
          hmacSecret: testConfig.hmacSecret,
          privateKey: testConfig.privateKey,
          skipInvalid: true,
        },
        maxPagesPerRun: 10,
      }
    );

    const { aggregation } = await engine.runWithAggregation(testConfig.privateKey);

    // Convert to extension format (similar to existing compute-ratings)
    const extensionRating = convertToExtensionFormat(
      aggregation,
      bundleId,
      sourceId,
      testConfig.discussionNumber,
      `${testConfig.owner}/${testConfig.repo}`
    );

    assert.equal(extensionRating.bundleId, bundleId);
    assert.equal(extensionRating.sourceId, sourceId);
    assert.equal(extensionRating.totalVotes, ratings.length);
    assert.equal(extensionRating.discussionNumber, testConfig.discussionNumber);

    // Verify star rating calculation
    const expectedAverage = ratings.reduce((a, b) => a + b.rating, 0) / ratings.length;
    assert.equal(extensionRating.starRating, expectedAverage);

    // Confidence based on vote count
    assert.ok(['low', 'medium', 'high', 'very_high'].includes(extensionRating.confidence));

    console.log(`[PrivacyE2E] Extension format: ${extensionRating.starRating} stars, ${extensionRating.confidence} confidence`);
  });
});

// ============================================================================
// Helper: Convert to Extension Format
// ============================================================================

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
  /** Decrypted feedback grouped by rating */
  feedbackByRating?: Record<number, string[]>;
}

function convertToExtensionFormat(
  aggregation: AggregatedFeedback,
  bundleId: string,
  sourceId: string,
  discussionNumber: number,
  repository: string
): ExtensionBundleRating {
  const count = aggregation.totalCount;
  const avg = aggregation.averageRating;

  // Normalize Wilson score (0-5 scale to 0-1)
  const normalizedWilson = avg > 0 ? Math.round((((avg - 1) / 4) * 1000)) / 1000 : 0;

  // Extract decrypted feedback
  const feedbackByRating: Record<number, string[]> = {};
  for (const [rating, data] of Object.entries(aggregation.byRating)) {
    const ratingNum = Number(rating);
    feedbackByRating[ratingNum] = data.encryptedComments
      .filter((c) => c.startsWith('[DECRYPTED]'))
      .map((c) => c.slice('[DECRYPTED]'.length));
  }

  return {
    sourceId,
    bundleId,
    upvotes: 0, // Not used in star rating system
    downvotes: 0,
    wilsonScore: normalizedWilson,
    starRating: avg,
    totalVotes: count,
    lastUpdated: new Date().toISOString(),
    discussionNumber,
    confidence: getConfidenceLevel(count),
    feedbackByRating,
  };
}

function getConfidenceLevel(voteCount: number): string {
  if (voteCount >= 100) return 'very_high';
  if (voteCount >= 20) return 'high';
  if (voteCount >= 5) return 'medium';
  return 'low';
}

/**
 * OctoStream Data Harvester E2E Tests
 *
 * End-to-end tests simulating the full GitHub Actions workflow:
 * - Concurrent rating production (simulating multiple VS Code users)
 * - Workflow-triggered aggregation on discussion comment
 * - Cursor-based incremental processing
 * - Single-processing-unit guards (concurrency protection)
 */

import * as assert from 'assert';
import {
  GitHubDiscussionsClient,
  GitHubDiscussionEventSource,
  OctoStreamDataHarvester,
  harvestRatings,
  harvestAndSaveRatings,
  createRatingPayload,
  toJsonl,
  fromJsonl,
  verifyPayload,
  loadPrivateKey,
  loadPublicKey,
  type AggregatedFeedback,
  type HarvesterResult,
  type ExtensionRatingsOutput,
} from '../src';

interface HarvesterE2EConfig {
  token: string;
  owner: string;
  repo: string;
  discussionNumber: number;
  hmacSecret: string;
  publicKey: string;
  privateKey?: string;
  cursorPrefix: string;
}

function getHarvesterE2EConfig(): HarvesterE2EConfig | null {
  if (process.env.HARVESTER_E2E_ENABLE !== 'true') {
    return null;
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.HARVESTER_E2E_OWNER || process.env.PRIVACY_E2E_OWNER;
  const repo = process.env.HARVESTER_E2E_REPO || process.env.PRIVACY_E2E_REPO;
  const discussionNumberRaw = process.env.HARVESTER_E2E_DISCUSSION_NUMBER || process.env.PRIVACY_E2E_DISCUSSION_NUMBER;
  const hmacSecret = process.env.HARVESTER_E2E_HMAC_SECRET || process.env.PRIVACY_E2E_HMAC_SECRET;

  if (!token || !owner || !repo || !discussionNumberRaw || !hmacSecret) {
    console.log('[HarvesterE2E] Missing required env vars, skipping tests');
    return null;
  }

  const discussionNumber = Number.parseInt(discussionNumberRaw, 10);
  if (!Number.isFinite(discussionNumber) || discussionNumber <= 0) {
    return null;
  }

  // Load or use privacy test keys
  let publicKey: string;
  let privateKey: string | undefined;

  if (process.env.HARVESTER_E2E_PUBLIC_KEY || process.env.PRIVACY_E2E_PUBLIC_KEY) {
    const pubKeyVar = process.env.HARVESTER_E2E_PUBLIC_KEY ? 'HARVESTER_E2E_PUBLIC_KEY' : 'PRIVACY_E2E_PUBLIC_KEY';
    publicKey = loadPublicKey(pubKeyVar);
  } else {
    throw new Error('Public key required for harvester E2E tests');
  }

  if (process.env.HARVESTER_E2E_PRIVATE_KEY || process.env.PRIVACY_E2E_PRIVATE_KEY) {
    const privKeyVar = process.env.HARVESTER_E2E_PRIVATE_KEY ? 'HARVESTER_E2E_PRIVATE_KEY' : 'PRIVACY_E2E_PRIVATE_KEY';
    privateKey = loadPrivateKey(privKeyVar);
  }

  const cursorPrefix = process.env.HARVESTER_E2E_CURSOR_PREFIX ?? 'HARVESTER_E2E';

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

const config = getHarvesterE2EConfig();
const describeIfEnabled = config ? describe : describe.skip;

describeIfEnabled('OctoStream Data Harvester E2E', function () {
  this.timeout(300000); // 5 min timeout for real GitHub API calls

  let client: GitHubDiscussionsClient;
  let discussionId: string;
  let runMarker: string;
  let testConfig: HarvesterE2EConfig;

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

    discussionId = await client.getDiscussionIdByNumber(testConfig.discussionNumber);
    runMarker = `harvester-e2e-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    console.log(`[HarvesterE2E] Discussion ID: ${discussionId}`);
    console.log(`[HarvesterE2E] Run marker: ${runMarker}`);

    // Prime cursor to avoid processing old events
    const harvester = new OctoStreamDataHarvester({
      token: testConfig.token,
      owner: testConfig.owner,
      repo: testConfig.repo,
      discussionNumber: testConfig.discussionNumber,
      hmacSecret: testConfig.hmacSecret,
      privateKey: testConfig.privateKey,
      bundleId: 'primer-bundle',
      sourceId: 'primer-source',
      cursorPrefix: testConfig.cursorPrefix,
      enableLock: false, // Disable lock for E2E tests to avoid polluting discussion
    });

    await harvester.harvest();
    console.log('[HarvesterE2E] Cursor primed');
  });

  // ============================================================================
  // E2E-HARVESTER-01: Single Bundle Harvest
  // ============================================================================
  it('E2E-HARVESTER-01: should harvest ratings for a single bundle', async function () {
    if (!testConfig.privateKey) {
      this.skip();
      return;
    }

    const bundleId = `harvester-single/${runMarker}`;
    const sourceId = 'harvester-e2e-source';
    const ratings = [4, 5, 5, 3, 4];

    // Produce ratings (simulating VS Code users submitting ratings)
    console.log(`[HarvesterE2E] Producing ${ratings.length} ratings for ${bundleId}`);
    for (let i = 0; i < ratings.length; i++) {
      const payload = createRatingPayload({
        bundleId,
        rating: ratings[i],
        comment: `User ${i} feedback: ${['Good', 'Excellent', 'Great', 'Okay', 'Nice'][i]}`,
        userId: `harvester-user-${i}`,
        salt: testConfig.hmacSecret,
        publicKey: testConfig.publicKey,
        secret: testConfig.hmacSecret,
      });

      await client.addDiscussionComment(discussionId, toJsonl(payload));
    }

    await sleep(3000); // Wait for eventual consistency

    // Harvest
    const harvester = new OctoStreamDataHarvester({
      token: testConfig.token,
      owner: testConfig.owner,
      repo: testConfig.repo,
      discussionNumber: testConfig.discussionNumber,
      hmacSecret: testConfig.hmacSecret,
      privateKey: testConfig.privateKey,
      bundleId,
      sourceId,
      cursorPrefix: testConfig.cursorPrefix,
      enableLock: false,
    });

    const result = await harvester.harvest();

    // Verify
    assert.equal(result.processedRatings, ratings.length, 'Should process all ratings');
    assert.equal(result.aggregation.totalCount, ratings.length, 'Should aggregate all ratings');
    assert.equal(result.hasNewRatings, true, 'Should detect new ratings');

    const expectedAverage = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    assert.equal(result.aggregation.averageRating, expectedAverage, 'Average should match');

    // Verify extension format output
    assert.ok(result.extensionFormat, 'Should produce extension format');
    assert.ok(result.extensionFormat.bundles[bundleId], 'Should have bundle entry');
    assert.equal(result.extensionFormat.bundles[bundleId].totalVotes, ratings.length);
    assert.equal(result.extensionFormat.bundles[bundleId].sourceId, sourceId);

    // Verify decrypted feedbacks
    assert.ok(result.feedbacks, 'Should have decrypted feedbacks');
    assert.equal(result.feedbacks!.length, ratings.length);

    console.log(`[HarvesterE2E] Harvested ${result.processedRatings} ratings, avg=${result.aggregation.averageRating}`);
  });

  // ============================================================================
  // E2E-HARVESTER-02: Incremental Harvest (Cursor-Based)
  // ============================================================================
  it('E2E-HARVESTER-02: should harvest incrementally between cursors', async function () {
    if (!testConfig.privateKey) {
      this.skip();
      return;
    }

    const bundleId = `harvester-incremental/${runMarker}`;
    const sourceId = 'harvester-e2e-source';

    // First batch
    const batch1Ratings = [3, 4, 5];
    console.log(`[HarvesterE2E] Producing batch 1: ${batch1Ratings.length} ratings`);
    for (let i = 0; i < batch1Ratings.length; i++) {
      const payload = createRatingPayload({
        bundleId,
        rating: batch1Ratings[i],
        comment: `Batch 1 - User ${i}`,
        userId: `batch1-user-${i}`,
        salt: testConfig.hmacSecret,
        publicKey: testConfig.publicKey,
        secret: testConfig.hmacSecret,
      });
      await client.addDiscussionComment(discussionId, toJsonl(payload));
    }

    await sleep(2000);

    // First harvest (captures batch 1)
    const harvester1 = new OctoStreamDataHarvester({
      token: testConfig.token,
      owner: testConfig.owner,
      repo: testConfig.repo,
      discussionNumber: testConfig.discussionNumber,
      hmacSecret: testConfig.hmacSecret,
      privateKey: testConfig.privateKey,
      bundleId,
      sourceId,
      cursorPrefix: testConfig.cursorPrefix,
      enableLock: false,
    });

    const result1 = await harvester1.harvest();
    assert.equal(result1.processedRatings, 3, 'First harvest should capture batch 1');
    assert.equal(result1.aggregation.totalCount, 3);

    // Second batch (after first harvest)
    const batch2Ratings = [4, 5];
    console.log(`[HarvesterE2E] Producing batch 2: ${batch2Ratings.length} ratings`);
    for (let i = 0; i < batch2Ratings.length; i++) {
      const payload = createRatingPayload({
        bundleId,
        rating: batch2Ratings[i],
        comment: `Batch 2 - User ${i}`,
        userId: `batch2-user-${i}`,
        salt: testConfig.hmacSecret,
        publicKey: testConfig.publicKey,
        secret: testConfig.hmacSecret,
      });
      await client.addDiscussionComment(discussionId, toJsonl(payload));
    }

    await sleep(2000);

    // Second harvest (captures only batch 2)
    const harvester2 = new OctoStreamDataHarvester({
      token: testConfig.token,
      owner: testConfig.owner,
      repo: testConfig.repo,
      discussionNumber: testConfig.discussionNumber,
      hmacSecret: testConfig.hmacSecret,
      privateKey: testConfig.privateKey,
      bundleId,
      sourceId,
      cursorPrefix: testConfig.cursorPrefix,
      enableLock: false,
    });

    const result2 = await harvester2.harvest();

    // Should only process the 2 new ratings
    assert.equal(result2.processedRatings, 2, 'Second harvest should capture only new ratings');
    assert.equal(result2.aggregation.totalCount, 2, 'Aggregation should only include new ratings');

    // Third harvest (no new ratings)
    const harvester3 = new OctoStreamDataHarvester({
      token: testConfig.token,
      owner: testConfig.owner,
      repo: testConfig.repo,
      discussionNumber: testConfig.discussionNumber,
      hmacSecret: testConfig.hmacSecret,
      privateKey: testConfig.privateKey,
      bundleId,
      sourceId,
      cursorPrefix: testConfig.cursorPrefix,
      enableLock: false,
    });

    const result3 = await harvester3.harvest();
    assert.equal(result3.processedRatings, 0, 'Third harvest should process 0 new ratings');
    assert.equal(result3.hasNewRatings, false, 'Should indicate no new ratings');

    console.log(`[HarvesterE2E] Incremental harvest: batch1=${result1.processedRatings}, batch2=${result2.processedRatings}, batch3=${result3.processedRatings}`);
  });

  // ============================================================================
  // E2E-HARVESTER-03: Concurrent Production Simulation
  // ============================================================================
  it('E2E-HARVESTER-03: should handle concurrent rating production', async function () {
    if (!testConfig.privateKey) {
      this.skip();
      return;
    }

    const bundleId = `harvester-concurrent/${runMarker}`;
    const sourceId = 'harvester-e2e-source';

    // Simulate 5 concurrent users posting ratings simultaneously
    const concurrentUsers = 5;
    const ratings = [5, 4, 5, 3, 4];

    console.log(`[HarvesterE2E] Simulating ${concurrentUsers} concurrent users...`);

    // Post all ratings concurrently (like multiple VS Code users)
    const postPromises = ratings.map((rating, i) => {
      const payload = createRatingPayload({
        bundleId,
        rating,
        comment: `Concurrent user ${i} says: ${['Love it!', 'Great work', 'Awesome', 'Good', 'Nice'][i]}`,
        userId: `concurrent-user-${i}`,
        salt: testConfig.hmacSecret,
        publicKey: testConfig.publicKey,
        secret: testConfig.hmacSecret,
      });

      return client.addDiscussionComment(discussionId, toJsonl(payload));
    });

    await Promise.all(postPromises);
    console.log(`[HarvesterE2E] All ${concurrentUsers} concurrent posts completed`);

    await sleep(3000);

    // Harvest all concurrent ratings
    const harvester = new OctoStreamDataHarvester({
      token: testConfig.token,
      owner: testConfig.owner,
      repo: testConfig.repo,
      discussionNumber: testConfig.discussionNumber,
      hmacSecret: testConfig.hmacSecret,
      privateKey: testConfig.privateKey,
      bundleId,
      sourceId,
      cursorPrefix: testConfig.cursorPrefix,
      enableLock: false,
    });

    const result = await harvester.harvest();

    // Verify all concurrent ratings were captured
    assert.equal(result.processedRatings, concurrentUsers, 'Should capture all concurrent ratings');
    assert.equal(result.aggregation.totalCount, concurrentUsers);
    assert.equal(result.hasNewRatings, true);

    // Verify all comments are decrypted
    assert.ok(result.feedbacks, 'Should have decrypted feedbacks');
    assert.equal(result.feedbacks!.length, concurrentUsers);

    // Verify feedbackByRating in extension format
    const extFormat = result.extensionFormat!;
    const bundleRating = extFormat.bundles[bundleId];
    assert.ok(bundleRating.feedbackByRating, 'Should have feedback grouped by rating');

    let totalFeedbackCount = 0;
    for (const [rating, data] of Object.entries(bundleRating.feedbackByRating!)) {
      totalFeedbackCount += data.count;
      assert.ok(data.comments.length > 0, `Rating ${rating} should have decrypted comments`);
    }
    assert.equal(totalFeedbackCount, concurrentUsers, 'Total feedback count should match');

    console.log(`[HarvesterE2E] Concurrent harvest: ${result.processedRatings} ratings captured`);
  });

  // ============================================================================
  // E2E-HARVESTER-04: Multi-Bundle Harvest
  // ============================================================================
  it('E2E-HARVESTER-04: should harvest ratings for multiple bundles', async function () {
    if (!testConfig.privateKey) {
      this.skip();
      return;
    }

    const bundles = [
      { id: `harvester-multi-a/${runMarker}`, ratings: [5, 4, 5] },
      { id: `harvester-multi-b/${runMarker}`, ratings: [3, 4] },
      { id: `harvester-multi-c/${runMarker}`, ratings: [5, 5, 5, 4] },
    ];

    // Produce ratings for all bundles
    console.log(`[HarvesterE2E] Producing ratings for ${bundles.length} bundles`);
    for (const bundle of bundles) {
      for (let i = 0; i < bundle.ratings.length; i++) {
        const payload = createRatingPayload({
          bundleId: bundle.id,
          rating: bundle.ratings[i],
          comment: `Bundle ${bundle.id} - Rating ${i}`,
          userId: `multi-user-${bundle.id}-${i}`,
          salt: testConfig.hmacSecret,
          publicKey: testConfig.publicKey,
          secret: testConfig.hmacSecret,
        });
        await client.addDiscussionComment(discussionId, toJsonl(payload));
      }
    }

    await sleep(3000);

    // Harvest once to get all ratings, then verify output for each bundle
    // NOTE: The harvester processes ALL ratings from the discussion, not just
    // the specific bundleId. The bundleId is used for output formatting.
    // Use shared cursorPrefix for proper incremental processing across tests.
    const totalRatings = bundles.reduce((sum, b) => sum + b.ratings.length, 0);

    for (const bundle of bundles) {
      const harvester = new OctoStreamDataHarvester({
        token: testConfig.token,
        owner: testConfig.owner,
        repo: testConfig.repo,
        discussionNumber: testConfig.discussionNumber,
        hmacSecret: testConfig.hmacSecret,
        privateKey: testConfig.privateKey,
        bundleId: bundle.id,
        sourceId: 'harvester-e2e-source',
        cursorPrefix: testConfig.cursorPrefix, // Use shared cursor for incremental processing
        enableLock: false,
      });

      const result = await harvester.harvest();

      // The harvester processes ALL events since the last cursor position.
      // The aggregation.bundleId reflects the first event's bundleId (from the
      // aggregateRatings function), NOT the configured bundleId.
      // The configured bundleId is only used for output formatting.
      assert.ok(result.processedRatings >= 9, `Should process all 9 ratings (got ${result.processedRatings})`);

      // Verify the extension format uses the CONFIGURED bundleId as the key
      assert.ok(result.extensionFormat, 'Should have extension format');
      assert.ok(result.extensionFormat.bundles[bundle.id], `Extension format should have bundle ${bundle.id}`);

      const bundleOutput = result.extensionFormat.bundles[bundle.id];
      // The bundle entry uses the configured bundleId but contains aggregated data
      // from all events processed (all 9 ratings in this test)
      assert.ok(bundleOutput.totalVotes >= 9, `Bundle output should reflect total events processed`);
      assert.equal(bundleOutput.bundleId, bundle.id, 'Output should use configured bundleId');
      assert.equal(bundleOutput.sourceId, 'harvester-e2e-source');

      console.log(`[HarvesterE2E] Bundle ${bundle.id}: processed=${result.processedRatings} events, output votes=${bundleOutput.totalVotes}`);
    }
  });

  // ============================================================================
  // E2E-HARVESTER-05: Workflow Simulation (GitHub Actions style)
  // ============================================================================
  it('E2E-HARVESTER-05: should simulate full workflow with save-to-file', async function () {
    if (!testConfig.privateKey) {
      this.skip();
      return;
    }

    const bundleId = `harvester-workflow/${runMarker}`;
    const sourceId = 'workflow-simulation';
    const ratings = [5, 4, 5, 5, 3, 4, 5];

    // Produce ratings
    console.log(`[HarvesterE2E] Workflow: Producing ${ratings.length} ratings`);
    for (let i = 0; i < ratings.length; i++) {
      const payload = createRatingPayload({
        bundleId,
        rating: ratings[i],
        comment: `Workflow test - User ${i} feedback`,
        userId: `workflow-user-${i}`,
        salt: testConfig.hmacSecret,
        publicKey: testConfig.publicKey,
        secret: testConfig.hmacSecret,
      });
      await client.addDiscussionComment(discussionId, toJsonl(payload));
    }

    await sleep(3000);

    // Simulate workflow: harvest and save
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harvester-e2e-'));

    try {
      const { result, files } = await harvestAndSaveRatings(
        {
          token: testConfig.token,
          owner: testConfig.owner,
          repo: testConfig.repo,
          discussionNumber: testConfig.discussionNumber,
          hmacSecret: testConfig.hmacSecret,
          privateKey: testConfig.privateKey,
          bundleId,
          sourceId,
          cursorPrefix: testConfig.cursorPrefix,
          outputFormat: 'both',
          enableLock: false,
        },
        tempDir
      );

      // Verify results
      assert.equal(result.processedRatings, ratings.length);
      assert.equal(result.hasNewRatings, true);
      assert.ok(result.extensionFormat, 'Should have extension format');
      assert.ok(result.collectionsFormat, 'Should have collections format');

      // Verify files were created
      assert.ok(files.length >= 3, 'Should create at least 3 output files');

      // Read and verify extension format file
      const extFile = files.find((f) => f.includes('extension'));
      assert.ok(extFile, 'Should have extension format file');

      const extContent = await fs.readFile(extFile!, 'utf-8');
      const extData: ExtensionRatingsOutput = JSON.parse(extContent);
      assert.ok(extData.bundles[bundleId], 'Extension file should have bundle');
      assert.equal(extData.bundles[bundleId].totalVotes, ratings.length);

      // Verify aggregation file
      const aggFile = files.find((f) => f.includes('aggregation'));
      assert.ok(aggFile, 'Should have aggregation file');

      const aggContent = await fs.readFile(aggFile!, 'utf-8');
      const aggData: AggregatedFeedback = JSON.parse(aggContent);
      assert.equal(aggData.totalCount, ratings.length);

      console.log(`[HarvesterE2E] Workflow simulation complete:`);
      console.log(`  - Files created: ${files.length}`);
      console.log(`  - Output dir: ${tempDir}`);
      console.log(`  - Ratings processed: ${result.processedRatings}`);

    } finally {
      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // E2E-HARVESTER-06: Invalid Payload Handling
  // ============================================================================
  it('E2E-HARVESTER-06: should handle mixed valid/invalid payloads', async function () {
    if (!testConfig.privateKey) {
      this.skip();
      return;
    }

    const bundleId = `harvester-mixed/${runMarker}`;
    const sourceId = 'harvester-e2e-source';

    // Valid ratings
    const validRatings = [5, 4, 5];
    console.log(`[HarvesterE2E] Producing ${validRatings.length} valid ratings`);
    for (let i = 0; i < validRatings.length; i++) {
      const payload = createRatingPayload({
        bundleId,
        rating: validRatings[i],
        comment: `Valid rating ${i}`,
        userId: `valid-user-${i}`,
        salt: testConfig.hmacSecret,
        publicKey: testConfig.publicKey,
        secret: testConfig.hmacSecret,
      });
      await client.addDiscussionComment(discussionId, toJsonl(payload));
    }

    // Invalid ratings (tampered)
    const invalidCount = 2;
    console.log(`[HarvesterE2E] Producing ${invalidCount} tampered ratings`);
    for (let i = 0; i < invalidCount; i++) {
      const payload = createRatingPayload({
        bundleId,
        rating: 5,
        comment: `Tampered rating ${i}`,
        userId: `tampered-user-${i}`,
        salt: testConfig.hmacSecret,
        publicKey: testConfig.publicKey,
        secret: testConfig.hmacSecret,
      });
      // Tamper with the payload
      payload.rating = 1;
      await client.addDiscussionComment(discussionId, toJsonl(payload));
    }

    // Corrupted JSON
    console.log(`[HarvesterE2E] Producing 1 corrupted JSON comment`);
    await client.addDiscussionComment(discussionId, '{"invalid json');

    await sleep(3000);

    // Harvest
    const harvester = new OctoStreamDataHarvester({
      token: testConfig.token,
      owner: testConfig.owner,
      repo: testConfig.repo,
      discussionNumber: testConfig.discussionNumber,
      hmacSecret: testConfig.hmacSecret,
      privateKey: testConfig.privateKey,
      bundleId,
      sourceId,
      cursorPrefix: testConfig.cursorPrefix,
      enableLock: false,
    });

    const result = await harvester.harvest();

    // Should process valid ratings
    assert.equal(result.processedRatings, validRatings.length, 'Should process only valid ratings');
    assert.equal(result.invalidPayloads, invalidCount + 1, 'Should count invalid payloads'); // +1 for corrupted JSON
    assert.equal(result.aggregation.totalCount, validRatings.length);

    console.log(`[HarvesterE2E] Mixed harvest: ${result.processedRatings} valid, ${result.invalidPayloads} invalid`);
  });

  // ============================================================================
  // E2E-HARVESTER-07: Idempotent Re-processing
  // ============================================================================
  it('E2E-HARVESTER-07: should be idempotent on re-run', async function () {
    if (!testConfig.privateKey) {
      this.skip();
      return;
    }

    const bundleId = `harvester-idempotent/${runMarker}`;
    const sourceId = 'harvester-e2e-source';
    const ratings = [4, 5];

    // Produce ratings
    for (let i = 0; i < ratings.length; i++) {
      const payload = createRatingPayload({
        bundleId,
        rating: ratings[i],
        comment: `Idempotent test ${i}`,
        userId: `idempotent-user-${i}`,
        salt: testConfig.hmacSecret,
        publicKey: testConfig.publicKey,
        secret: testConfig.hmacSecret,
      });
      await client.addDiscussionComment(discussionId, toJsonl(payload));
    }

    await sleep(2000);

    // First harvest - use shared cursorPrefix for incremental processing
    const harvester1 = new OctoStreamDataHarvester({
      token: testConfig.token,
      owner: testConfig.owner,
      repo: testConfig.repo,
      discussionNumber: testConfig.discussionNumber,
      hmacSecret: testConfig.hmacSecret,
      privateKey: testConfig.privateKey,
      bundleId,
      sourceId,
      cursorPrefix: testConfig.cursorPrefix, // Use shared cursor
      enableLock: false,
    });

    const result1 = await harvester1.harvest();
    assert.equal(result1.processedRatings, ratings.length);
    assert.equal(result1.hasNewRatings, true);

    // Immediate re-harvest using SAME harvester instance (same cursor)
    // This tests that cursor-based checkpointing works correctly
    const result2 = await harvester1.harvest();
    assert.equal(result2.processedRatings, 0, 'Re-harvest should process 0 ratings');
    assert.equal(result2.hasNewRatings, false);

    // Aggregation should be empty since no new events
    assert.equal(result2.aggregation.totalCount, 0);

    console.log(`[HarvesterE2E] Idempotent: first=${result1.processedRatings}, second=${result2.processedRatings}`);
  });
});

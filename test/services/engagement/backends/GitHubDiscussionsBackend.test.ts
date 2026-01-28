/**
 * Tests for GitHubDiscussionsBackend
 * GitHub Discussions-based engagement backend
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import nock from 'nock';
import { GitHubDiscussionsBackend } from '../../../../src/services/engagement/backends/GitHubDiscussionsBackend';
import { GitHubDiscussionsBackendConfig, Rating, TelemetryEvent, Feedback } from '../../../../src/types/engagement';

suite('GitHubDiscussionsBackend', () => {
    let sandbox: sinon.SinonSandbox;
    let backend: GitHubDiscussionsBackend;
    let authStub: sinon.SinonStub;
    let tempDir: string;

    const mockConfig: GitHubDiscussionsBackendConfig = {
        type: 'github-discussions',
        repository: 'test-owner/test-repo',
        category: 'Feedback'
    };

    const mockSession = {
        accessToken: 'mock-token',
        account: { id: '123', label: 'testuser' },
        id: 'session-id',
        scopes: ['repo']
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Create temp directory for tests
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-discussions-test-'));
        backend = new GitHubDiscussionsBackend(tempDir);

        // Mock VS Code authentication
        authStub = sandbox.stub(vscode.authentication, 'getSession').resolves(mockSession as any);
    });

    teardown(async () => {
        sandbox.restore();
        nock.cleanAll();
        if (backend.initialized) {
            backend.dispose();
        }
        // Clean up temp directory
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('initialize()', () => {
        test('should initialize with valid config', async () => {
            await backend.initialize(mockConfig);
            assert.strictEqual(backend.initialized, true);
        });

        test('should throw error for invalid config type', async () => {
            await assert.rejects(
                backend.initialize({ type: 'file', storagePath: '/tmp' } as any),
                /Invalid config type/
            );
        });

        test('should throw error for invalid repository format', async () => {
            await assert.rejects(
                backend.initialize({ ...mockConfig, repository: 'invalid' }),
                /Invalid repository format/
            );
        });
    });

    suite('dispose()', () => {
        test('should clean up resources', async () => {
            await backend.initialize(mockConfig);
            backend.dispose();
            assert.strictEqual(backend.initialized, false);
        });
    });

    suite('setDiscussionMapping()', () => {
        test('should set mapping for resource', async () => {
            await backend.initialize(mockConfig);
            backend.setDiscussionMapping('bundle-1', 42);
            // Mapping is internal, but we can verify it works via submitRating
        });

        test('should set mapping with comment ID', async () => {
            await backend.initialize(mockConfig);
            backend.setDiscussionMapping('bundle-1', 42, 101);
        });
    });

    suite('Telemetry Operations (delegated to local)', () => {
        test('should record telemetry event', async () => {
            await backend.initialize(mockConfig);

            const event: TelemetryEvent = {
                id: 'event-1',
                timestamp: new Date().toISOString(),
                eventType: 'bundle_install',
                resourceType: 'bundle',
                resourceId: 'test-bundle'
            };

            await backend.recordTelemetry(event);
            const events = await backend.getTelemetry({ resourceId: 'test-bundle' });
            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].id, 'event-1');
        });

        test('should clear telemetry', async () => {
            await backend.initialize(mockConfig);

            const event: TelemetryEvent = {
                id: 'event-1',
                timestamp: new Date().toISOString(),
                eventType: 'bundle_view',
                resourceType: 'bundle',
                resourceId: 'test-bundle'
            };

            await backend.recordTelemetry(event);
            await backend.clearTelemetry();
            const events = await backend.getTelemetry();
            assert.strictEqual(events.length, 0);
        });
    });

    suite('Rating Operations', () => {
        test('should fall back to local storage when no mapping exists', async () => {
            await backend.initialize(mockConfig);

            const rating: Rating = {
                id: 'rating-1',
                resourceType: 'bundle',
                resourceId: 'unmapped-bundle',
                score: 4,
                timestamp: new Date().toISOString()
            };

            await backend.submitRating(rating);
            const retrieved = await backend.getRating('bundle', 'unmapped-bundle');
            assert.ok(retrieved);
            assert.strictEqual(retrieved.score, 4);
        });

        test('should submit rating via GitHub API when mapping exists', async () => {
            await backend.initialize(mockConfig);
            backend.setDiscussionMapping('bundle-1', 42);

            // Mock GitHub API calls
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/discussions/42/reactions')
                .reply(200, []);

            nock('https://api.github.com')
                .post('/repos/test-owner/test-repo/discussions/42/reactions')
                .reply(201, { id: 1, content: '+1' });

            const rating: Rating = {
                id: 'rating-1',
                resourceType: 'bundle',
                resourceId: 'bundle-1',
                score: 5,
                timestamp: new Date().toISOString()
            };

            await backend.submitRating(rating);

            // Verify vote is cached
            const retrieved = await backend.getRating('bundle', 'bundle-1');
            assert.ok(retrieved);
            assert.strictEqual(retrieved.score, 5);
        });

        test('should handle GitHub API errors gracefully', async () => {
            await backend.initialize(mockConfig);
            backend.setDiscussionMapping('bundle-1', 42);

            // Mock GitHub API error
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/discussions/42/reactions')
                .reply(500, { message: 'Internal Server Error' });

            const rating: Rating = {
                id: 'rating-1',
                resourceType: 'bundle',
                resourceId: 'bundle-1',
                score: 4,
                timestamp: new Date().toISOString()
            };

            // Should not throw - falls back to local storage
            await backend.submitRating(rating);
        });

        test('should delete rating', async () => {
            await backend.initialize(mockConfig);

            const rating: Rating = {
                id: 'rating-1',
                resourceType: 'bundle',
                resourceId: 'test-bundle',
                score: 3,
                timestamp: new Date().toISOString()
            };

            await backend.submitRating(rating);
            await backend.deleteRating('bundle', 'test-bundle');
            const retrieved = await backend.getRating('bundle', 'test-bundle');
            assert.strictEqual(retrieved, undefined);
        });
    });

    suite('Feedback Operations (delegated to local)', () => {
        test('should submit and retrieve feedback', async () => {
            await backend.initialize(mockConfig);

            const feedback: Feedback = {
                id: 'feedback-1',
                resourceType: 'bundle',
                resourceId: 'test-bundle',
                comment: 'Great bundle!',
                timestamp: new Date().toISOString()
            };

            await backend.submitFeedback(feedback);
            const retrieved = await backend.getFeedback('bundle', 'test-bundle');
            assert.strictEqual(retrieved.length, 1);
            assert.strictEqual(retrieved[0].comment, 'Great bundle!');
        });

        test('should delete feedback', async () => {
            await backend.initialize(mockConfig);

            const feedback: Feedback = {
                id: 'feedback-1',
                resourceType: 'bundle',
                resourceId: 'test-bundle',
                comment: 'Test feedback',
                timestamp: new Date().toISOString()
            };

            await backend.submitFeedback(feedback);
            await backend.deleteFeedback('feedback-1');
            const retrieved = await backend.getFeedback('bundle', 'test-bundle');
            assert.strictEqual(retrieved.length, 0);
        });
    });

    suite('getResourceEngagement()', () => {
        test('should aggregate engagement data', async () => {
            await backend.initialize(mockConfig);

            // Add some data
            await backend.recordTelemetry({
                id: 'event-1',
                timestamp: new Date().toISOString(),
                eventType: 'bundle_install',
                resourceType: 'bundle',
                resourceId: 'test-bundle'
            });

            await backend.submitFeedback({
                id: 'feedback-1',
                resourceType: 'bundle',
                resourceId: 'test-bundle',
                comment: 'Nice!',
                timestamp: new Date().toISOString()
            });

            const engagement = await backend.getResourceEngagement('bundle', 'test-bundle');

            assert.strictEqual(engagement.resourceId, 'test-bundle');
            assert.strictEqual(engagement.resourceType, 'bundle');
            assert.strictEqual(engagement.telemetry?.installCount, 1);
            assert.ok(engagement.recentFeedback);
            assert.strictEqual(engagement.recentFeedback.length, 1);
        });
    });

    suite('Error Handling', () => {
        test('should throw when not initialized', async () => {
            await assert.rejects(
                backend.recordTelemetry({
                    id: 'event-1',
                    timestamp: new Date().toISOString(),
                    eventType: 'bundle_view',
                    resourceType: 'bundle',
                    resourceId: 'test'
                }),
                /not initialized/
            );
        });
    });
});

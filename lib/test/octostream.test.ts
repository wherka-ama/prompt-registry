/**
 * Tests for OctoStream primitives.
 */

import * as assert from 'assert';
import {
  OctoStreamEngine,
  OctoStreamEvent,
  OctoStreamEventSource,
  OctoStreamPage,
  OctoStreamDeadLetterSink,
  OctoStreamDeadLetterRecord,
  OctoStreamMetrics,
  withRetry,
  createRepoVariableName,
  buildDiscussionConcurrencyGroup,
  shardForKey,
  selectShardDiscussion,
  generateSyntheticPayload,
  simulateTraffic,
  GitHubDiscussionEventSource,
  GitHubDiscussionDeadLetterSink,
} from '../src/octostream';

describe('OctoStream', () => {
  describe('withRetry()', () => {
    it('should retry until operation succeeds', async () => {
      let attempts = 0;
      let retryCallbacks = 0;

      const result = await withRetry(
        async () => {
          attempts += 1;
          if (attempts < 3) {
            throw new Error('temporary failure');
          }
          return 'ok';
        },
        {
          retries: 3,
          onRetry: () => {
            retryCallbacks += 1;
          },
        }
      );

      assert.strictEqual(result, 'ok');
      assert.strictEqual(attempts, 3);
      assert.strictEqual(retryCallbacks, 2);
    });

    it('should throw when retries is less than 1', async () => {
      await assert.rejects(async () => {
        await withRetry(async () => 'ok', { retries: 0 });
      }, /retries must be greater than or equal to 1/);
    });
  });

  describe('OctoStreamMetrics', () => {
    it('should track counters and timing snapshot', () => {
      const metrics = new OctoStreamMetrics();

      metrics.increment('events_processed');
      metrics.increment('events_processed');
      metrics.recordTiming(10);
      metrics.recordTiming(30);

      const snapshot = metrics.snapshot();

      assert.strictEqual(snapshot.counters.events_processed, 2);
      assert.strictEqual(snapshot.totalEventsMeasured, 2);
      assert.strictEqual(snapshot.avgProcessingMs, 20);
      assert.strictEqual(snapshot.maxProcessingMs, 30);
    });
  });

  describe('helpers', () => {
    it('should build repository variable name with normalization', () => {
      const result = createRepoVariableName('discussion-prefix', 42);
      assert.strictEqual(result, 'DISCUSSION_PREFIX_42_CURSOR');
    });

    it('should build concurrency group', () => {
      assert.strictEqual(buildDiscussionConcurrencyGroup(123), 'discussion-123');
    });

    it('should route key to deterministic shard', () => {
      const shard = shardForKey('event-abc', 4);
      assert.ok(shard >= 0 && shard < 4);

      const selected = selectShardDiscussion('event-abc', [101, 102, 103, 104]);
      assert.ok([101, 102, 103, 104].includes(selected));
    });

    it('should reject invalid shard inputs', () => {
      assert.throws(() => shardForKey('x', 0), /shardCount must be greater than 0/);
      assert.throws(
        () => selectShardDiscussion('x', []),
        /discussionNumbers must contain at least one discussion number/
      );
    });
  });

  describe('payload and traffic simulation', () => {
    it('should generate valid synthetic payload JSON', () => {
      const payload = generateSyntheticPayload({
        commands: ['deploy service-a'],
        metadata: { env: 'test' },
        timestamp: '2026-01-01T00:00:00.000Z',
      });

      const parsed = JSON.parse(payload) as {
        id: string;
        command: string;
        timestamp: string;
        metadata?: Record<string, unknown>;
      };

      assert.ok(typeof parsed.id === 'string' && parsed.id.length > 0);
      assert.strictEqual(parsed.command, 'deploy service-a');
      assert.strictEqual(parsed.timestamp, '2026-01-01T00:00:00.000Z');
      assert.strictEqual(parsed.metadata?.env, 'test');
    });

    it('should simulate burst traffic', async () => {
      const sentBodies: string[] = [];

      const result = await simulateTraffic({
        discussionId: 'D_test',
        sendComment: async (_discussionId: string, body: string) => {
          sentBodies.push(body);
        },
        ratePerSecond: 0,
        durationSeconds: 0,
        burstSize: 3,
      });

      assert.strictEqual(result.sent, 3);
      assert.strictEqual(sentBodies.length, 3);
    });

    it('should validate traffic simulation inputs', async () => {
      await assert.rejects(async () => {
        await simulateTraffic({
          discussionId: 'D_test',
          sendComment: async () => undefined,
          ratePerSecond: -1,
          durationSeconds: 0,
        });
      }, /ratePerSecond must be >= 0/);

      await assert.rejects(async () => {
        await simulateTraffic({
          discussionId: 'D_test',
          sendComment: async () => undefined,
          ratePerSecond: 0,
          durationSeconds: 10,
        });
      }, /ratePerSecond must be > 0 when durationSeconds > 0/);

      await assert.rejects(async () => {
        await simulateTraffic({
          discussionId: 'D_test',
          sendComment: async () => undefined,
          ratePerSecond: 1,
          durationSeconds: -1,
        });
      }, /durationSeconds must be >= 0/);
    });
  });

  describe('OctoStreamEngine', () => {
    function event(id: string, body: string): OctoStreamEvent {
      return {
        id,
        body,
        createdAt: '2026-01-01T00:00:00.000Z',
        author: { login: 'octo' },
      };
    }

    class InMemorySource implements OctoStreamEventSource {
      public committed: string[] = [];
      private index = 0;

      constructor(
        private readonly pages: OctoStreamPage[],
        private readonly initialCursor: string | null = null
      ) {}

      async getCursor(): Promise<string | null> {
        return this.initialCursor;
      }

      async fetchPage(_cursor: string | null): Promise<OctoStreamPage> {
        if (this.index >= this.pages.length) {
          return {
            nodes: [],
            endCursor: null,
            hasNextPage: false,
          };
        }

        const page = this.pages[this.index];
        this.index += 1;
        return page;
      }

      async commitCursor(cursor: string): Promise<void> {
        this.committed.push(cursor);
      }
    }

    it('should process pages and commit cursor after each page', async () => {
      const source = new InMemorySource([
        {
          nodes: [event('1', 'first'), event('2', 'second')],
          endCursor: 'CURSOR_1',
          hasNextPage: true,
        },
        {
          nodes: [event('3', 'third')],
          endCursor: 'CURSOR_2',
          hasNextPage: false,
        },
      ]);

      const handled: string[] = [];
      const engine = new OctoStreamEngine(source, {
        handle: async (e: OctoStreamEvent) => {
          handled.push(e.id);
        },
      });

      const result = await engine.run();

      assert.deepStrictEqual(handled, ['1', '2', '3']);
      assert.deepStrictEqual(source.committed, ['CURSOR_1', 'CURSOR_2']);
      assert.strictEqual(result.processedEvents, 3);
      assert.strictEqual(result.processedPages, 2);
      assert.strictEqual(result.failures, 0);
      assert.strictEqual(result.lastCommittedCursor, 'CURSOR_2');
      assert.strictEqual(result.exhaustedByMaxPages, false);
      assert.strictEqual(result.metrics.counters.events_processed, 3);
      assert.strictEqual(result.metrics.counters.cursor_commits, 2);
    });

    it('should continue processing and send dead-letter records when continueOnError is true', async () => {
      const source = new InMemorySource([
        {
          nodes: [event('1', 'ok'), event('2', 'bad')],
          endCursor: 'CURSOR_A',
          hasNextPage: false,
        },
      ]);

      const deadLetters: OctoStreamDeadLetterRecord[] = [];
      const deadLetterSink: OctoStreamDeadLetterSink = {
        send: async (record: OctoStreamDeadLetterRecord) => {
          deadLetters.push(record);
        },
      };

      const engine = new OctoStreamEngine(
        source,
        {
          handle: async (e: OctoStreamEvent) => {
            if (e.id === '2') {
              throw new Error('handler failure');
            }
          },
        },
        {
          continueOnError: true,
          deadLetterSink,
          retryCount: 1,
        }
      );

      const result = await engine.run();

      assert.strictEqual(result.processedEvents, 1);
      assert.strictEqual(result.failures, 1);
      assert.deepStrictEqual(source.committed, ['CURSOR_A']);
      assert.strictEqual(deadLetters.length, 1);
      assert.strictEqual(deadLetters[0].event.id, '2');
      assert.strictEqual(deadLetters[0].error, 'handler failure');
    });

    it('should fail fast when continueOnError is false', async () => {
      const source = new InMemorySource([
        {
          nodes: [event('1', 'bad')],
          endCursor: 'CURSOR_FAIL',
          hasNextPage: false,
        },
      ]);

      const engine = new OctoStreamEngine(
        source,
        {
          handle: async () => {
            throw new Error('stop now');
          },
        },
        {
          continueOnError: false,
          retryCount: 1,
        }
      );

      await assert.rejects(async () => {
        await engine.run();
      }, /stop now/);

      assert.deepStrictEqual(source.committed, []);
    });

    it('should stop when maxPagesPerRun is reached', async () => {
      const source = new InMemorySource([
        {
          nodes: [event('1', 'first')],
          endCursor: 'CURSOR_1',
          hasNextPage: true,
        },
        {
          nodes: [event('2', 'second')],
          endCursor: 'CURSOR_2',
          hasNextPage: false,
        },
      ]);

      const handled: string[] = [];
      const engine = new OctoStreamEngine(
        source,
        {
          handle: async (e: OctoStreamEvent) => {
            handled.push(e.id);
          },
        },
        {
          maxPagesPerRun: 1,
        }
      );

      const result = await engine.run();

      assert.deepStrictEqual(handled, ['1']);
      assert.deepStrictEqual(source.committed, ['CURSOR_1']);
      assert.strictEqual(result.exhaustedByMaxPages, true);
      assert.strictEqual(result.lastCommittedCursor, 'CURSOR_1');
    });
  });

  describe('GitHub discussion adapters', () => {
    it('should use repository variable and cached discussion id in event source', async () => {
      let discussionIdCalls = 0;
      const variableReads: string[] = [];
      const committed: Array<{ name: string; value: string }> = [];

      const mockApi = {
        getDiscussionIdByNumber: async (_discussionNumber: number): Promise<string> => {
          discussionIdCalls += 1;
          return 'D_discussion';
        },
        fetchDiscussionCommentsPage: async (_discussionId: string, _cursor: string | null): Promise<OctoStreamPage> => {
          return {
            nodes: [],
            endCursor: null,
            hasNextPage: false,
          };
        },
        getRepositoryVariable: async (name: string): Promise<string | null> => {
          variableReads.push(name);
          return 'CURSOR_START';
        },
        upsertRepositoryVariable: async (name: string, value: string): Promise<void> => {
          committed.push({ name, value });
        },
        addDiscussionComment: async (): Promise<string> => 'C1',
      };

      const source = new GitHubDiscussionEventSource(mockApi, 42, 'discussion-prefix');

      const cursor = await source.getCursor();
      assert.strictEqual(cursor, 'CURSOR_START');
      assert.deepStrictEqual(variableReads, ['DISCUSSION_PREFIX_42_CURSOR']);

      await source.fetchPage(null);
      await source.fetchPage('CURSOR_START');
      assert.strictEqual(discussionIdCalls, 1, 'discussion id should be cached');

      await source.commitCursor('CURSOR_NEXT');
      assert.deepStrictEqual(committed, [
        { name: 'DISCUSSION_PREFIX_42_CURSOR', value: 'CURSOR_NEXT' },
      ]);
    });

    it('should format dead-letter records as discussion comments', async () => {
      const posted: string[] = [];

      const sink = new GitHubDiscussionDeadLetterSink(
        {
          addDiscussionComment: async (_discussionId: string, body: string): Promise<string> => {
            posted.push(body);
            return 'C_DLQ';
          },
        },
        'D_dead_letter'
      );

      await sink.send({
        event: {
          id: 'event-1',
          body: '{"hello":"world"}',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        error: 'boom',
        attemptCount: 3,
        timestamp: '2026-01-01T00:01:00.000Z',
      });

      assert.strictEqual(posted.length, 1);
      assert.ok(posted[0].includes('OctoStream Dead Letter Event'));
      assert.ok(posted[0].includes('"event-1"'));
      assert.ok(posted[0].includes('"boom"'));
    });
  });
});

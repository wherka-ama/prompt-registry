/**
 * OctoStream core primitives.
 *
 * GitHub Discussions append-only event stream processing with cursor checkpointing,
 * retry, dead-letter support, sharding helpers, and simulation utilities.
 */

import axios from 'axios';
import { createHash, randomUUID } from 'crypto';

// ============================================================================
// Core event contracts
// ============================================================================

export interface OctoStreamEventAuthor {
  login: string;
}

export interface OctoStreamEvent {
  id: string;
  body: string;
  createdAt: string;
  author?: OctoStreamEventAuthor | null;
}

export interface OctoStreamPage {
  nodes: OctoStreamEvent[];
  endCursor: string | null;
  hasNextPage: boolean;
}

export interface OctoStreamEventSource {
  getCursor(): Promise<string | null>;
  fetchPage(cursor: string | null): Promise<OctoStreamPage>;
  commitCursor(cursor: string): Promise<void>;
}

export interface OctoStreamEventHandler {
  handle(event: OctoStreamEvent): Promise<void>;
}

export interface OctoStreamDeadLetterRecord {
  event: OctoStreamEvent;
  error: string;
  attemptCount: number;
  timestamp: string;
}

export interface OctoStreamDeadLetterSink {
  send(record: OctoStreamDeadLetterRecord): Promise<void>;
}

// ============================================================================
// Observability
// ============================================================================

export type OctoStreamLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type OctoStreamLogger = (
  level: OctoStreamLogLevel,
  message: string,
  context?: Record<string, unknown>
) => void;

/**
 * Structured JSON logger suitable for CI logs and machine parsing.
 */
export const jsonConsoleLogger: OctoStreamLogger = (
  level,
  message,
  context?: Record<string, unknown>
): void => {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ?? {}),
  };

  console.log(JSON.stringify(payload));
};

export interface OctoStreamMetricsSnapshot {
  counters: Record<string, number>;
  avgProcessingMs: number;
  maxProcessingMs: number;
  totalEventsMeasured: number;
}

export class OctoStreamMetrics {
  private counters: Record<string, number> = {};
  private timings: number[] = [];

  increment(name: string, value: number = 1): void {
    this.counters[name] = (this.counters[name] || 0) + value;
  }

  recordTiming(ms: number): void {
    this.timings.push(ms);
  }

  snapshot(): OctoStreamMetricsSnapshot {
    const total = this.timings.length;
    const avg = total > 0
      ? this.timings.reduce((sum, timing) => sum + timing, 0) / total
      : 0;
    const max = total > 0 ? Math.max(...this.timings) : 0;

    return {
      counters: { ...this.counters },
      avgProcessingMs: avg,
      maxProcessingMs: max,
      totalEventsMeasured: total,
    };
  }
}

// ============================================================================
// Retry utilities
// ============================================================================

export interface RetryOptions {
  retries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Retries an async operation with optional delay/backoff.
 * `retries` means max attempts (default 3).
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? 3;
  if (retries < 1) {
    throw new Error('retries must be greater than or equal to 1');
  }

  const backoffFactor = options.backoffFactor ?? 1;
  let delayMs = options.initialDelayMs ?? 0;

  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt >= retries) {
        break;
      }

      options.onRetry?.(attempt, error);
      await sleep(delayMs);
      delayMs = Math.ceil(delayMs * backoffFactor);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(errorToMessage(lastError));
}

// ============================================================================
// Engine
// ============================================================================

export interface OctoStreamEngineOptions {
  retryCount?: number;
  retryDelayMs?: number;
  retryBackoffFactor?: number;
  continueOnError?: boolean;
  maxPagesPerRun?: number;
  logger?: OctoStreamLogger;
  metrics?: OctoStreamMetrics;
  deadLetterSink?: OctoStreamDeadLetterSink;
}

export interface OctoStreamRunResult {
  processedEvents: number;
  processedPages: number;
  failures: number;
  lastCommittedCursor: string | null;
  exhaustedByMaxPages: boolean;
  metrics: OctoStreamMetricsSnapshot;
}

export class OctoStreamEngine {
  constructor(
    private readonly source: OctoStreamEventSource,
    private readonly handler: OctoStreamEventHandler,
    private readonly options: OctoStreamEngineOptions = {}
  ) {}

  async run(): Promise<OctoStreamRunResult> {
    const logger = this.options.logger ?? jsonConsoleLogger;
    const metrics = this.options.metrics ?? new OctoStreamMetrics();
    const retryCount = this.options.retryCount ?? 3;
    const retryDelayMs = this.options.retryDelayMs ?? 0;
    const retryBackoffFactor = this.options.retryBackoffFactor ?? 1;
    const continueOnError = this.options.continueOnError ?? false;
    const maxPagesPerRun = this.options.maxPagesPerRun ?? Number.POSITIVE_INFINITY;

    let processedEvents = 0;
    let processedPages = 0;
    let failures = 0;
    let exhaustedByMaxPages = false;
    let shouldContinue = true;

    let cursor = await this.source.getCursor();
    let lastCommittedCursor = cursor;

    logger('INFO', 'OctoStream run started', {
      initialCursor: cursor,
      maxPagesPerRun,
      continueOnError,
      retryCount,
    });

    while (shouldContinue) {
      if (processedPages >= maxPagesPerRun) {
        exhaustedByMaxPages = true;
        shouldContinue = false;
        continue;
      }

      const page = await this.source.fetchPage(cursor);

      if (page.nodes.length === 0) {
        shouldContinue = false;
        continue;
      }

      if (!page.endCursor) {
        throw new Error('Received a non-empty page without endCursor');
      }

      for (const event of page.nodes) {
        const startedAt = Date.now();

        try {
          await withRetry(
            async () => this.handler.handle(event),
            {
              retries: retryCount,
              initialDelayMs: retryDelayMs,
              backoffFactor: retryBackoffFactor,
              onRetry: (attempt, error) => {
                logger('WARN', 'Retrying event processing', {
                  attempt,
                  eventId: event.id,
                  error: errorToMessage(error),
                });
              },
            }
          );

          processedEvents += 1;
          metrics.increment('events_processed');
        } catch (error) {
          failures += 1;
          metrics.increment('events_failed');

          logger('ERROR', 'Event processing failed', {
            eventId: event.id,
            error: errorToMessage(error),
          });

          if (this.options.deadLetterSink) {
            try {
              await this.options.deadLetterSink.send({
                event,
                error: errorToMessage(error),
                attemptCount: retryCount,
                timestamp: new Date().toISOString(),
              });
              metrics.increment('dead_letter_sent');
            } catch (deadLetterError) {
              metrics.increment('dead_letter_failed');
              logger('ERROR', 'Dead-letter sink failed', {
                eventId: event.id,
                error: errorToMessage(deadLetterError),
              });
            }
          }

          if (!continueOnError) {
            throw error instanceof Error ? error : new Error(errorToMessage(error));
          }
        } finally {
          metrics.recordTiming(Date.now() - startedAt);
        }
      }

      await this.source.commitCursor(page.endCursor);
      metrics.increment('cursor_commits');

      cursor = page.endCursor;
      lastCommittedCursor = page.endCursor;
      processedPages += 1;

      if (!page.hasNextPage) {
        shouldContinue = false;
      }
    }

    metrics.increment('runs_total');
    if (failures > 0) {
      metrics.increment('runs_with_failures');
    }

    logger('INFO', 'OctoStream run completed', {
      processedEvents,
      processedPages,
      failures,
      exhaustedByMaxPages,
      lastCommittedCursor,
    });

    return {
      processedEvents,
      processedPages,
      failures,
      lastCommittedCursor,
      exhaustedByMaxPages,
      metrics: metrics.snapshot(),
    };
  }
}

// ============================================================================
// Naming/scaling helpers
// ============================================================================

/**
 * Builds repository variable names in the canonical format:
 * <PREFIX>_<DISCUSSION_NUMBER>_CURSOR
 */
export function createRepoVariableName(prefix: string, discussionNumber: number): string {
  const normalizedPrefix = (prefix || 'DISCUSSION')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_') || 'DISCUSSION';

  return `${normalizedPrefix}_${discussionNumber}_CURSOR`;
}

/**
 * Helper for GitHub Actions workflow `concurrency.group` values.
 */
export function buildDiscussionConcurrencyGroup(discussionNumber: number): string {
  return `discussion-${discussionNumber}`;
}

/**
 * Deterministic shard index for a key.
 */
export function shardForKey(key: string, shardCount: number): number {
  if (shardCount <= 0) {
    throw new Error('shardCount must be greater than 0');
  }

  const hash = createHash('sha256').update(key).digest();
  return hash[0] % shardCount;
}

/**
 * Selects a discussion number based on key + list of shard discussions.
 */
export function selectShardDiscussion(key: string, discussionNumbers: number[]): number {
  if (discussionNumbers.length === 0) {
    throw new Error('discussionNumbers must contain at least one discussion number');
  }

  const index = shardForKey(key, discussionNumbers.length);
  return discussionNumbers[index];
}

// ============================================================================
// Simulation helpers
// ============================================================================

const DEFAULT_COMMAND_POOL = [
  'deploy service-a',
  'rebuild cache',
  'invalidate cdn',
  'trigger nightly',
  'sync metadata',
];

export interface SyntheticPayloadOptions {
  commands?: string[];
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

/**
 * Generates synthetic event payload as a JSON string.
 */
export function generateSyntheticPayload(options: SyntheticPayloadOptions = {}): string {
  const commands = options.commands && options.commands.length > 0
    ? options.commands
    : DEFAULT_COMMAND_POOL;

  const command = commands[Math.floor(Math.random() * commands.length)];

  return JSON.stringify({
    id: randomUUID(),
    command,
    timestamp: options.timestamp ?? new Date().toISOString(),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  });
}

export interface SimulateTrafficOptions {
  discussionId: string;
  sendComment: (discussionId: string, body: string) => Promise<void>;
  ratePerSecond: number;
  durationSeconds: number;
  burstSize?: number;
  payloadFactory?: () => string;
}

export interface SimulateTrafficResult {
  sent: number;
  durationMs: number;
}

/**
 * Simulates traffic by sending comments at a controlled rate + optional burst.
 */
export async function simulateTraffic(
  options: SimulateTrafficOptions
): Promise<SimulateTrafficResult> {
  if (options.durationSeconds < 0) {
    throw new Error('durationSeconds must be >= 0');
  }

  if ((options.burstSize ?? 0) < 0) {
    throw new Error('burstSize must be >= 0');
  }

  if (options.ratePerSecond < 0) {
    throw new Error('ratePerSecond must be >= 0');
  }

  if (options.durationSeconds > 0 && options.ratePerSecond <= 0) {
    throw new Error('ratePerSecond must be > 0 when durationSeconds > 0');
  }

  const startedAt = Date.now();
  const payloadFactory = options.payloadFactory ?? (() => generateSyntheticPayload());
  let sent = 0;

  if (options.durationSeconds > 0) {
    const intervalMs = 1000 / options.ratePerSecond;
    const endTime = Date.now() + options.durationSeconds * 1000;

    while (Date.now() < endTime) {
      await options.sendComment(options.discussionId, payloadFactory());
      sent += 1;
      await sleep(intervalMs);
    }
  }

  const burstSize = options.burstSize ?? 0;
  if (burstSize > 0) {
    await Promise.all(
      Array.from({ length: burstSize }).map(async () => {
        await options.sendComment(options.discussionId, payloadFactory());
      })
    );
    sent += burstSize;
  }

  return {
    sent,
    durationMs: Date.now() - startedAt,
  };
}

// ============================================================================
// GitHub Discussions adapter
// ============================================================================

interface GraphQLErrorItem {
  message?: string;
}

interface GraphQLResponse<TData> {
  data?: TData;
  errors?: GraphQLErrorItem[];
}

function graphQLErrorMessage(errors?: GraphQLErrorItem[]): string {
  if (!errors || errors.length === 0) {
    return 'Unknown GraphQL error';
  }

  return errors.map((item) => item.message || 'Unknown error').join('; ');
}

function isAxiosStatus(error: unknown, statusCode: number): boolean {
  return axios.isAxiosError(error) && error.response?.status === statusCode;
}

export interface GitHubDiscussionsApi {
  getDiscussionIdByNumber(discussionNumber: number): Promise<string>;
  fetchDiscussionCommentsPage(discussionId: string, cursor: string | null): Promise<OctoStreamPage>;
  getRepositoryVariable(name: string): Promise<string | null>;
  upsertRepositoryVariable(name: string, value: string): Promise<void>;
  addDiscussionComment(discussionId: string, body: string): Promise<string>;
}

export interface GitHubDiscussionsClientOptions {
  token: string;
  owner: string;
  repo: string;
  apiBaseUrl?: string;
  graphqlUrl?: string;
}

/**
 * Lightweight GitHub Discussions + repo variable API client.
 */
export class GitHubDiscussionsClient implements GitHubDiscussionsApi {
  private readonly apiBaseUrl: string;
  private readonly graphqlUrl: string;

  constructor(private readonly options: GitHubDiscussionsClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl ?? 'https://api.github.com';
    this.graphqlUrl = options.graphqlUrl ?? 'https://api.github.com/graphql';
  }

  private get restHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.options.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private get graphQLHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.options.token}`,
      'Content-Type': 'application/json',
    };
  }

  private async graphQLRequest<TData>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<TData> {
    const response = await axios.post<GraphQLResponse<TData>>(
      this.graphqlUrl,
      { query, variables },
      { headers: this.graphQLHeaders }
    );

    if (response.data.errors && response.data.errors.length > 0) {
      throw new Error(graphQLErrorMessage(response.data.errors));
    }

    if (!response.data.data) {
      throw new Error('GitHub GraphQL response did not contain data');
    }

    return response.data.data;
  }

  async getDiscussionIdByNumber(discussionNumber: number): Promise<string> {
    interface ResponseData {
      repository?: {
        discussion?: {
          id: string;
        } | null;
      } | null;
    }

    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          discussion(number: $number) {
            id
          }
        }
      }
    `;

    const data = await this.graphQLRequest<ResponseData>(query, {
      owner: this.options.owner,
      repo: this.options.repo,
      number: discussionNumber,
    });

    const discussionId = data.repository?.discussion?.id;
    if (!discussionId) {
      throw new Error(`Discussion #${discussionNumber} not found in ${this.options.owner}/${this.options.repo}`);
    }

    return discussionId;
  }

  async fetchDiscussionCommentsPage(
    discussionId: string,
    cursor: string | null
  ): Promise<OctoStreamPage> {
    interface ResponseData {
      node?: {
        comments?: {
          nodes: OctoStreamEvent[];
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
        };
      };
    }

    const query = `
      query($discussionId: ID!, $cursor: String) {
        node(id: $discussionId) {
          ... on Discussion {
            comments(first: 100, after: $cursor) {
              nodes {
                id
                body
                createdAt
                author {
                  login
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }
    `;

    const data = await this.graphQLRequest<ResponseData>(query, {
      discussionId,
      cursor,
    });

    const comments = data.node?.comments;
    if (!comments) {
      return {
        nodes: [],
        endCursor: cursor,
        hasNextPage: false,
      };
    }

    return {
      nodes: comments.nodes ?? [],
      endCursor: comments.pageInfo.endCursor,
      hasNextPage: comments.pageInfo.hasNextPage,
    };
  }

  async getRepositoryVariable(name: string): Promise<string | null> {
    const encodedName = encodeURIComponent(name);
    const url = `${this.apiBaseUrl}/repos/${this.options.owner}/${this.options.repo}/actions/variables/${encodedName}`;

    try {
      const response = await axios.get<{ name: string; value: string }>(url, {
        headers: this.restHeaders,
      });

      return response.data.value;
    } catch (error) {
      if (isAxiosStatus(error, 404)) {
        return null;
      }

      throw error;
    }
  }

  async upsertRepositoryVariable(name: string, value: string): Promise<void> {
    const encodedName = encodeURIComponent(name);
    const updateUrl = `${this.apiBaseUrl}/repos/${this.options.owner}/${this.options.repo}/actions/variables/${encodedName}`;

    try {
      await axios.patch(
        updateUrl,
        { name, value },
        { headers: this.restHeaders }
      );
      return;
    } catch (error) {
      if (!isAxiosStatus(error, 404)) {
        throw error;
      }
    }

    const createUrl = `${this.apiBaseUrl}/repos/${this.options.owner}/${this.options.repo}/actions/variables`;
    await axios.post(
      createUrl,
      { name, value },
      { headers: this.restHeaders }
    );
  }

  async addDiscussionComment(discussionId: string, body: string): Promise<string> {
    interface ResponseData {
      addDiscussionComment?: {
        comment?: {
          id: string;
        };
      };
    }

    const mutation = `
      mutation($discussionId: ID!, $body: String!) {
        addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
          comment {
            id
          }
        }
      }
    `;

    const data = await this.graphQLRequest<ResponseData>(mutation, {
      discussionId,
      body,
    });

    const commentId = data.addDiscussionComment?.comment?.id;
    if (!commentId) {
      throw new Error('GitHub did not return created comment id');
    }

    return commentId;
  }
}

export class GitHubDiscussionEventSource implements OctoStreamEventSource {
  private discussionIdCache: string | null = null;
  private cursorCache: string | null = null;
  private cursorCacheInitialized = false;
  private readonly variableName: string;

  constructor(
    private readonly client: GitHubDiscussionsApi,
    private readonly discussionNumber: number,
    variablePrefix: string = 'DISCUSSION'
  ) {
    this.variableName = createRepoVariableName(variablePrefix, discussionNumber);
  }

  private async getDiscussionId(): Promise<string> {
    if (!this.discussionIdCache) {
      this.discussionIdCache = await this.client.getDiscussionIdByNumber(this.discussionNumber);
    }

    return this.discussionIdCache;
  }

  async getCursor(): Promise<string | null> {
    if (this.cursorCacheInitialized) {
      return this.cursorCache;
    }

    const cursor = await this.client.getRepositoryVariable(this.variableName);
    this.cursorCache = cursor;
    this.cursorCacheInitialized = true;
    return cursor;
  }

  async fetchPage(cursor: string | null): Promise<OctoStreamPage> {
    const discussionId = await this.getDiscussionId();
    return this.client.fetchDiscussionCommentsPage(discussionId, cursor);
  }

  async commitCursor(cursor: string): Promise<void> {
    await this.client.upsertRepositoryVariable(this.variableName, cursor);
    this.cursorCache = cursor;
    this.cursorCacheInitialized = true;
  }
}

/**
 * Sends dead-letter records as discussion comments to a dedicated DLQ discussion.
 */
export class GitHubDiscussionDeadLetterSink implements OctoStreamDeadLetterSink {
  constructor(
    private readonly client: Pick<GitHubDiscussionsApi, 'addDiscussionComment'>,
    private readonly deadLetterDiscussionId: string
  ) {}

  async send(record: OctoStreamDeadLetterRecord): Promise<void> {
    const body = [
      'OctoStream Dead Letter Event',
      '',
      '```json',
      JSON.stringify(record, null, 2),
      '```',
    ].join('\n');

    await this.client.addDiscussionComment(this.deadLetterDiscussionId, body);
  }
}

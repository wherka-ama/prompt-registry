/**
 * Privacy-enabled OctoStream integration.
 *
 * Combines OctoStream engine with GDPR-compliant rating/feedback processing.
 * Processes encrypted JSONL payloads from GitHub Discussions by default.
 */

import {
  OctoStreamEngine,
  OctoStreamEvent,
  OctoStreamEventHandler,
  OctoStreamEventSource,
  OctoStreamEngineOptions,
  OctoStreamRunResult,
  OctoStreamMetrics,
  jsonConsoleLogger,
} from './octostream';

import {
  RatingPayload,
  processRatingPayload,
  verifyPayload,
  fromJsonl,
  aggregateRatings,
  DecryptedFeedback,
  AggregatedFeedback,
} from './octostream-privacy';

// ============================================================================
// Configuration
// ============================================================================

export interface PrivacyEngineConfig {
  /** HMAC secret for payload integrity verification */
  hmacSecret: string;
  /** RSA private key for comment decryption (optional, for processing jobs) */
  privateKey?: string;
  /** Skip invalid payloads (default: true) */
  skipInvalid?: boolean;
  /** Logger function */
  logger?: typeof jsonConsoleLogger;
}

export interface PrivacyEngineOptions extends OctoStreamEngineOptions {
  privacy: PrivacyEngineConfig;
}

// ============================================================================
// Event Types
// ============================================================================

export interface ValidatedRatingEvent {
  type: 'valid';
  payload: RatingPayload;
  feedback: DecryptedFeedback;
  rawEvent: OctoStreamEvent;
}

export interface InvalidRatingEvent {
  type: 'invalid';
  error: string;
  rawBody: string;
  rawEvent: OctoStreamEvent;
}

export type PrivacyRatingEvent = ValidatedRatingEvent | InvalidRatingEvent;

// ============================================================================
// Event Handler
// ============================================================================

export interface PrivacyRatingHandler {
  handle(event: PrivacyRatingEvent): Promise<void>;
}

/**
 * Validates and processes encrypted rating payloads from OctoStream events.
 * Handles JSONL parsing, integrity verification, and optional decryption.
 */
export class PrivacyRatingEventHandler implements OctoStreamEventHandler {
  private validCount = 0;
  private invalidCount = 0;

  constructor(
    private readonly handler: PrivacyRatingHandler,
    private readonly config: PrivacyEngineConfig
  ) {}

  async handle(event: OctoStreamEvent): Promise<void> {
    const logger = this.config.logger ?? jsonConsoleLogger;

    // Each comment body should be a JSONL line
    const rawBody = event.body.trim();

    if (!rawBody) {
      this.invalidCount++;
      await this.handler.handle({
        type: 'invalid',
        error: 'Empty event body',
        rawBody,
        rawEvent: event,
      });
      return;
    }

    try {
      // Parse JSONL
      const payload = fromJsonl(rawBody);

      // Verify schema version (forward compatibility)
      if (payload.v !== 1) {
        this.invalidCount++;
        await this.handler.handle({
          type: 'invalid',
          error: `Unsupported schema version: ${payload.v}`,
          rawBody,
          rawEvent: event,
        });
        return;
      }

      // Verify HMAC signature (integrity)
      if (!verifyPayload(payload, this.config.hmacSecret)) {
        this.invalidCount++;
        await this.handler.handle({
          type: 'invalid',
          error: `Payload integrity verification failed for bundle ${payload.bundleId} (tampered or wrong secret)`,
          rawBody,
          rawEvent: event,
        });
        return;
      }

      // Process and optionally decrypt
      const feedback = processRatingPayload({
        payload,
        secret: this.config.hmacSecret,
        privateKey: this.config.privateKey,
      });

      this.validCount++;
      await this.handler.handle({
        type: 'valid',
        payload,
        feedback,
        rawEvent: event,
      });

    } catch (error) {
      // JSON parse error or other processing error
      this.invalidCount++;

      const errorMsg = error instanceof Error ? error.message : String(error);
      logger('WARN', 'Failed to process rating payload', {
        eventId: event.id,
        error: errorMsg,
        bodyPreview: rawBody.slice(0, 100),
      });

      await this.handler.handle({
        type: 'invalid',
        error: `Processing error: ${errorMsg}`,
        rawBody,
        rawEvent: event,
      });

      if (!this.config.skipInvalid) {
        throw error;
      }
    }
  }

  getStats(): { valid: number; invalid: number } {
    return { valid: this.validCount, invalid: this.invalidCount };
  }

  resetStats(): void {
    this.validCount = 0;
    this.invalidCount = 0;
  }
}

// ============================================================================
// Privacy Engine
// ============================================================================

export interface PrivacyEngineRunResult extends OctoStreamRunResult {
  /** Number of successfully validated rating events */
  validRatings: number;
  /** Number of invalid rating events */
  invalidRatings: number;
  /** Aggregated feedback statistics (if aggregation was performed) */
  aggregatedFeedback?: AggregatedFeedback;
}

/**
 * Privacy-enabled OctoStream engine that processes encrypted rating payloads by default.
 * Wraps the standard OctoStreamEngine with privacy-compliant handlers.
 */
export class PrivacyOctoStreamEngine {
  private readonly engine: OctoStreamEngine;
  private readonly privacyHandler: PrivacyRatingEventHandler;
  private collectedEvents: PrivacyRatingEvent[] = [];

  constructor(
    source: OctoStreamEventSource,
    handler: PrivacyRatingHandler,
    options: PrivacyEngineOptions
  ) {
    this.privacyHandler = new PrivacyRatingEventHandler(handler, options.privacy);
    this.engine = new OctoStreamEngine(source, this.privacyHandler, options);
  }

  /**
   * Runs the privacy-enabled engine, processing encrypted payloads.
   * Collects events for optional aggregation.
   */
  async run(): Promise<PrivacyEngineRunResult> {
    const result = await this.engine.run();
    const stats = this.privacyHandler.getStats();

    return {
      ...result,
      validRatings: stats.valid,
      invalidRatings: stats.invalid,
    };
  }

  /**
   * Runs the engine with built-in aggregation.
   * Returns both raw events and aggregated statistics.
   */
  async runWithAggregation(privateKey?: string): Promise<{
    result: PrivacyEngineRunResult;
    events: PrivacyRatingEvent[];
    aggregation: AggregatedFeedback;
  }> {
    this.collectedEvents = [];

    const collectingHandler: PrivacyRatingHandler = {
      handle: async (event) => {
        this.collectedEvents.push(event);
      },
    };

    // Temporarily replace handler
    const originalHandler = (this.privacyHandler as unknown as { handler: PrivacyRatingHandler }).handler;
    (this.privacyHandler as unknown as { handler: PrivacyRatingHandler }).handler = collectingHandler;

    const result = await this.run();

    // Restore handler
    (this.privacyHandler as unknown as { handler: PrivacyRatingHandler }).handler = originalHandler;

    // Aggregate valid events - use collected feedback (which has decrypted comments)
    const validFeedbacks = this.collectedEvents
      .filter((e): e is ValidatedRatingEvent => e.type === 'valid')
      .map((e) => e.feedback);

    const aggregation = aggregateRatings({
      feedbacks: validFeedbacks,
      secret: this.getHmacSecret(),
      includeDecryptedComments: true,
      privateKey,
    });

    return {
      result: { ...result, aggregatedFeedback: aggregation },
      events: this.collectedEvents,
      aggregation,
    };
  }

  private getHmacSecret(): string {
    // Access the config through the handler
    return (this.privacyHandler as unknown as { config: PrivacyEngineConfig }).config.hmacSecret;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick-run function for privacy-enabled processing.
 * Fetches events from source, validates and decrypts them.
 */
export async function processPrivacyRatings(
  source: OctoStreamEventSource,
  handler: PrivacyRatingHandler,
  hmacSecret: string,
  options?: Omit<PrivacyEngineOptions, 'privacy'>
): Promise<PrivacyEngineRunResult> {
  const engine = new PrivacyOctoStreamEngine(source, handler, {
    ...options,
    privacy: { hmacSecret, skipInvalid: true },
  });

  return engine.run();
}

/**
 * Quick-run function with aggregation.
 * Processes ratings and returns aggregated statistics.
 */
export async function processAndAggregatePrivacyRatings(
  source: OctoStreamEventSource,
  hmacSecret: string,
  privateKey: string,
  options?: Omit<PrivacyEngineOptions, 'privacy'>
): Promise<{
  result: PrivacyEngineRunResult;
  events: PrivacyRatingEvent[];
  aggregation: AggregatedFeedback;
}> {
  const engine = new PrivacyOctoStreamEngine(
    source,
    { handle: async () => {} }, // Dummy handler, we collect internally
    {
      ...options,
      privacy: { hmacSecret, privateKey, skipInvalid: true },
    }
  );

  return engine.runWithAggregation(privateKey);
}

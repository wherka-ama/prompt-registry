/**
 * Compatibility shim — the canonical GitHub REST client now lives at
 * `lib/src/github/client.ts`. This module preserves the legacy
 * `GitHubApiClient` constructor shape (`{ token: string, ... }`) so
 * harvester code keeps working while the migration completes.
 *
 * `GitHubApiClient` is now a thin wrapper around `GitHubClient` from
 * `lib/src/github/`. All behavior — retries, ETag, rate-limit
 * handling, observability — is identical.
 * @module primitive-index/hub/github-api-client
 */
import {
  type ClientEvent,
  type EtaggedResult,
  type FetchLike,
  GitHubClient,
} from '../../github/client';
import {
  staticTokenProvider,
} from '../../github/token';

/** Subset of {@link GitHubClient} options preserved for back-compat. */
export interface GitHubApiClientOptions {
  /** GitHub token (legacy shape — single literal token). */
  token: string;
  /** Base URL, defaults to https://api.github.com */
  baseUrl?: string;
  /** User-Agent. */
  userAgent?: string;
  /** Injected fetch for tests. */
  fetch?: FetchLike;
  /** Max retries. Default 4. */
  maxRetries?: number;
  /** Initial backoff (ms). */
  backoffBaseMs?: number;
  /** Jitter (ms). */
  jitterMs?: number;
  /** Max single sleep (ms). */
  maxSleepMs?: number;
  /** Observability hook. */
  onEvent?: (event: ClientEvent) => void;
}

/**
 * Legacy wrapper around {@link GitHubClient}. Construct it with a
 * single `token` string; internally we wrap it as a static
 * TokenProvider and delegate every method to a {@link GitHubClient}.
 *
 * **New code should use {@link GitHubClient} from `lib/src/github`
 * directly.** This wrapper exists only to keep the harvester
 * imports working without churn while the migration proceeds.
 */

export class GitHubApiClient {
  private readonly client: GitHubClient;

  public constructor(opts: GitHubApiClientOptions) {
    // Preserve legacy User-Agent default so harvester logs and any
    // GitHub-side analytics keyed on `primitive-index/1.0` keep
    // working. Callers can still override.
    const userAgent = opts.userAgent
      ?? 'primitive-index/1.0 (+https://github.com/AmadeusITGroup/prompt-registry)';
    this.client = new GitHubClient({
      tokens: staticTokenProvider(opts.token),
      baseUrl: opts.baseUrl,
      userAgent,
      fetch: opts.fetch,
      maxRetries: opts.maxRetries,
      backoffBaseMs: opts.backoffBaseMs,
      jitterMs: opts.jitterMs,
      maxSleepMs: opts.maxSleepMs,
      onEvent: opts.onEvent
    });
  }

  /** Latest rate-limit headers seen. */
  public get lastRateLimit(): GitHubClient['lastRateLimit'] {
    return this.client.lastRateLimit;
  }

  /**
   * GET returning parsed JSON.
   * @param pathOrUrl Path or URL.
   * @param extraHeaders Optional extra headers.
   */
  public async getJson<T>(pathOrUrl: string, extraHeaders?: Record<string, string>): Promise<T> {
    return this.client.getJson<T>(pathOrUrl, extraHeaders);
  }

  /**
   * GET returning raw text.
   * @param pathOrUrl Path or URL.
   * @param extraHeaders Optional extra headers.
   */
  public async getText(pathOrUrl: string, extraHeaders?: Record<string, string>): Promise<string> {
    return this.client.getText(pathOrUrl, extraHeaders);
  }

  /**
   * GET with If-None-Match.
   * @param pathOrUrl Path or URL.
   * @param etag Previous ETag.
   */
  public async getJsonWithEtag<T>(pathOrUrl: string, etag?: string): Promise<EtaggedResult<T>> {
    return this.client.getJsonWithEtag<T>(pathOrUrl, etag);
  }
}

export { type ClientEvent, type FetchLike, type EtaggedResult } from '../../github/client';
export { GitHubApiError } from '../../github/errors';

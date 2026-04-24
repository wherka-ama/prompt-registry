/**
 * Thin GitHub REST client tailored for the hub harvester.
 *
 * Design goals:
 *   - Single funnel for every request so quotas, retries and conditional
 *     requests are handled once, not scattered across the codebase.
 *   - Injectable `fetch` implementation so unit tests never touch the
 *     network and can drive every branch deterministically.
 *   - No runtime dependency — relies on the built-in `fetch`/`Response`
 *     available in Node.js ≥18 and in browsers/webviews.
 *
 * What it handles:
 *   - Authorization + User-Agent + GitHub Accept header on every call.
 *   - Retries transient 5xx with exponential backoff + jitter, capped at
 *     `maxRetries` attempts and `maxSleepMs` per nap.
 *   - Retries secondary rate-limit (403 with Retry-After).
 *   - Honours primary rate-limit: on 403 + `x-ratelimit-remaining: 0`
 *     sleeps until `x-ratelimit-reset` (clamped by `maxSleepMs`).
 *   - ETag-based conditional requests via `getJsonWithEtag()` — the most
 *     effective GitHub quota saver because 304 responses don't count
 *     against the rate budget for many endpoints.
 */

export type FetchLike = (req: Request) => Promise<Response>;

export interface GitHubApiClientOptions {
  /** GitHub token (any form accepted: ghp_, gho_, github_pat_, etc). */
  token: string;
  /** Base URL, defaults to https://api.github.com */
  baseUrl?: string;
  /** User-Agent to send; defaults to a sensible harvester ident. */
  userAgent?: string;
  /** Injected fetch for tests. Defaults to globalThis.fetch. */
  fetch?: FetchLike;
  /** Max number of retries after a transient failure. Default 4. */
  maxRetries?: number;
  /** Initial backoff in ms; each retry doubles it. Default 250. */
  backoffBaseMs?: number;
  /** Random jitter added to each backoff. Default 250. */
  jitterMs?: number;
  /** Upper bound on any single sleep (rate-limit or backoff). Default 60_000. */
  maxSleepMs?: number;
  /** Optional hook for observability (called per attempt). */
  onEvent?: (event: ClientEvent) => void;
}

export interface ClientEvent {
  kind: 'request' | 'retry' | 'rate-limit' | 'success' | 'give-up';
  url: string;
  attempt: number;
  status?: number;
  sleepMs?: number;
  retryReason?: string;
}

export interface EtaggedOk<T> {
  status: 'ok';
  value: T;
  etag: string | undefined;
}
export interface EtaggedNotModified {
  status: 'notModified';
}
export type EtaggedResult<T> = EtaggedOk<T> | EtaggedNotModified;

const DEFAULT_UA = 'primitive-index/1.0 (+https://github.com/AmadeusITGroup/prompt-registry)';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* eslint-disable @typescript-eslint/member-ordering -- public API kept at top for readability. */
export class GitHubApiClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly jitterMs: number;
  private readonly maxSleepMs: number;
  private readonly onEvent: (e: ClientEvent) => void;
  /**
   * Latest rate-limit headers seen from GitHub; handy for post-run
   * reporting ("you have X of Y left until Z"). Updated on every
   * response regardless of status code.
   */
  public lastRateLimit: {
    limit: number | undefined;
    remaining: number | undefined;
    resetAt: Date | undefined;
    used: number | undefined;
  } = { limit: undefined, remaining: undefined, resetAt: undefined, used: undefined };

  public constructor(opts: GitHubApiClientOptions) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl ?? 'https://api.github.com';
    this.userAgent = opts.userAgent ?? DEFAULT_UA;
    this.fetchImpl = opts.fetch ?? (((req: Request) => fetch(req)) as FetchLike);
    this.maxRetries = opts.maxRetries ?? 4;
    this.backoffBaseMs = opts.backoffBaseMs ?? 250;
    this.jitterMs = opts.jitterMs ?? 250;
    this.maxSleepMs = opts.maxSleepMs ?? 60_000;
    this.onEvent = opts.onEvent ?? (() => undefined);
  }

  /**
   * GET returning parsed JSON. Throws on non-2xx after retries.
   * @param pathOrUrl
   * @param extraHeaders
   */
  public async getJson<T>(pathOrUrl: string, extraHeaders?: Record<string, string>): Promise<T> {
    const res = await this.request('GET', pathOrUrl, extraHeaders);
    return res.json() as Promise<T>;
  }

  /**
   * GET returning raw text. Used for raw blob contents.
   * @param pathOrUrl
   * @param extraHeaders
   */
  public async getText(pathOrUrl: string, extraHeaders?: Record<string, string>): Promise<string> {
    const res = await this.request('GET', pathOrUrl, extraHeaders);
    return res.text();
  }

  /**
   * GET with an If-None-Match guard; on 304 returns { status: 'notModified' }.
   * The returned etag (when ok) should be stored by the caller and passed
   * back on the next call.
   * @param pathOrUrl
   * @param etag
   */
  public async getJsonWithEtag<T>(pathOrUrl: string, etag?: string): Promise<EtaggedResult<T>> {
    const headers: Record<string, string> = {};
    if (etag) {
      headers['if-none-match'] = etag;
    }
    const res = await this.request('GET', pathOrUrl, headers, { allowStatus: [304] });
    if (res.status === 304) {
      return { status: 'notModified' };
    }
    const value = (await res.json()) as T;
    return { status: 'ok', value, etag: res.headers.get('etag') ?? undefined };
  }

  private async request(
    method: string,
    pathOrUrl: string,
    extraHeaders?: Record<string, string>,
    opts?: { allowStatus?: number[] }
  ): Promise<Response> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : this.baseUrl + pathOrUrl;
    const headers = new Headers({
      authorization: `Bearer ${this.token}`,
      'user-agent': this.userAgent,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28'
    });
    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) {
        headers.set(k, v);
      }
    }

    let attempt = 0;
    let lastStatus = 0;
    let lastBody = '';
    while (attempt <= this.maxRetries) {
      attempt += 1;
      const req = new Request(url, { method, headers });
      this.onEvent({ kind: 'request', url, attempt });
      const res = await this.fetchImpl(req);
      lastStatus = res.status;
      this.captureRateLimit(res);
      if (res.status < 400 || (opts?.allowStatus?.includes(res.status))) {
        this.onEvent({ kind: 'success', url, attempt, status: res.status });
        return res;
      }
      // Capture a short body for diagnostics, but don't let a huge payload OOM us.
      lastBody = (await res.clone().text()).slice(0, 500);
      const classification = classifyError(res, lastBody);
      if (classification.kind === 'fatal' || attempt > this.maxRetries) {
        this.onEvent({ kind: 'give-up', url, attempt, status: res.status });
        throw new GitHubApiError(`GitHub ${res.status} after ${attempt - 1} retries: ${url} — ${lastBody}`, res.status, lastBody);
      }
      const sleepMs = this.computeSleep(classification, attempt, res);
      this.onEvent({
        kind: classification.kind === 'rate-limit' ? 'rate-limit' : 'retry',
        url, attempt, status: res.status, sleepMs,
        retryReason: classification.reason
      });
      await sleep(Math.min(sleepMs, this.maxSleepMs));
    }
    throw new GitHubApiError(`GitHub ${lastStatus} after ${this.maxRetries} retries: ${url}`, lastStatus, lastBody);
  }

  private captureRateLimit(res: Response): void {
    const limit = Number(res.headers.get('x-ratelimit-limit'));
    const remaining = Number(res.headers.get('x-ratelimit-remaining'));
    const used = Number(res.headers.get('x-ratelimit-used'));
    const resetUnix = Number(res.headers.get('x-ratelimit-reset'));
    this.lastRateLimit = {
      limit: Number.isFinite(limit) ? limit : undefined,
      remaining: Number.isFinite(remaining) ? remaining : undefined,
      used: Number.isFinite(used) ? used : undefined,
      resetAt: Number.isFinite(resetUnix) ? new Date(resetUnix * 1000) : undefined
    };
  }

  private computeSleep(
    classification: Classification,
    attempt: number,
    res: Response
  ): number {
    if (classification.kind === 'rate-limit') {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      if (Number.isFinite(reset) && reset > 0) {
        const waitMs = Math.max(0, reset * 1000 - Date.now()) + 250;
        return Math.min(Math.max(waitMs, 100), this.maxSleepMs);
      }
      const ra = Number(res.headers.get('retry-after'));
      if (Number.isFinite(ra) && ra >= 0) {
        return Math.max(ra * 1000, 100);
      }
      return this.maxSleepMs;
    }
    if (classification.kind === 'secondary-rate-limit') {
      const ra = Number(res.headers.get('retry-after'));
      const base = Number.isFinite(ra) && ra >= 0 ? ra * 1000 : this.backoffBaseMs * 2 ** (attempt - 1);
      return Math.max(base, 100);
    }
    // transient 5xx
    const back = this.backoffBaseMs * 2 ** (attempt - 1);
    const jitter = this.jitterMs > 0 ? Math.floor(Math.random() * this.jitterMs) : 0;
    return back + jitter;
  }
}

interface Classification {
  kind: 'transient' | 'rate-limit' | 'secondary-rate-limit' | 'fatal';
  reason: string;
}

function classifyError(res: Response, body: string): Classification {
  if (res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      return { kind: 'rate-limit', reason: 'primary rate limit' };
    }
    if (/secondary rate limit/i.test(body) || res.headers.get('retry-after')) {
      return { kind: 'secondary-rate-limit', reason: 'secondary rate limit' };
    }
    // Forbidden without a rate-limit signal — likely auth/permission, don't retry.
    return { kind: 'fatal', reason: 'forbidden' };
  }
  if (res.status === 408 || res.status === 429 || res.status >= 500) {
    return { kind: 'transient', reason: `status ${res.status}` };
  }
  return { kind: 'fatal', reason: `status ${res.status}` };
}

export class GitHubApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

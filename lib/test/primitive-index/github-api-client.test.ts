/**
 * Tests for the GitHubApiClient wrapper.
 *
 * The wrapper exists so every hub-harvester network call goes through a
 * single place that:
 *   - adds Authorization + User-Agent consistently
 *   - honours GitHub rate limits (both primary and secondary/403)
 *   - retries with exponential + jittered backoff on transient 5xx
 *   - supports conditional requests via ETag (not re-downloading unchanged
 *     trees/blobs — the most effective quota saver GitHub offers)
 *
 * The tests drive the behaviour via an injected fetch, so there is no real
 * network traffic.
 */
import * as assert from 'node:assert';
import {
  type FetchLike,
  GitHubApiClient,
} from '../../src/primitive-index/hub/github-api-client';

function mockResponse(init: {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}): Response {
  const { status = 200, headers = {}, body = {} } = init;
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    {
      status,
      headers: { 'content-type': 'application/json', ...headers }
    }
  );
}

describe('primitive-index / github-api-client', () => {
  it('sends Authorization + User-Agent + default accept headers', async () => {
    const calls: Request[] = [];
    const fetch: FetchLike = async (req) => {
      calls.push(req);
      return mockResponse({ body: { ok: true } });
    };
    const client = new GitHubApiClient({ token: 'ghp_test', fetch });
    const r = await client.getJson<{ ok: boolean }>('/user');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].headers.get('authorization'), 'Bearer ghp_test');
    assert.match(calls[0].headers.get('user-agent') ?? '', /primitive-index\//);
    assert.match(calls[0].headers.get('accept') ?? '', /application\/vnd\.github/);
  });

  it('retries 5xx with bounded attempts and exponential backoff', async () => {
    let attempt = 0;
    const fetch: FetchLike = async () => {
      attempt += 1;
      if (attempt < 3) {
        return mockResponse({ status: 502, body: { message: 'bad gateway' } });
      }
      return mockResponse({ body: { ok: true } });
    };
    const client = new GitHubApiClient({
      token: 't',
      fetch,
      maxRetries: 4,
      backoffBaseMs: 1,
      jitterMs: 0
    });
    const r = await client.getJson<{ ok: boolean }>('/foo');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(attempt, 3);
  });

  it('respects primary rate-limit: 403 + x-ratelimit-remaining=0 sleeps until reset', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 1;
    let attempt = 0;
    const fetch: FetchLike = async () => {
      attempt += 1;
      if (attempt === 1) {
        return mockResponse({
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(resetAt)
          },
          body: { message: 'API rate limit exceeded' }
        });
      }
      return mockResponse({ body: { ok: true } });
    };
    const start = Date.now();
    const client = new GitHubApiClient({
      token: 't',
      fetch,
      maxRetries: 3,
      backoffBaseMs: 1,
      jitterMs: 0,
      maxSleepMs: 2000
    });
    const r = await client.getJson<{ ok: boolean }>('/foo');
    const elapsed = Date.now() - start;
    assert.strictEqual(r.ok, true);
    assert.ok(attempt === 2, `attempts=${attempt}`);
    assert.ok(elapsed >= 100, `should have slept, got ${elapsed}ms`);
  });

  it('retries secondary rate-limit (403 with Retry-After)', async () => {
    let attempt = 0;
    const fetch: FetchLike = async () => {
      attempt += 1;
      if (attempt === 1) {
        return mockResponse({
          status: 403,
          headers: { 'retry-after': '0' },
          body: { message: 'secondary rate limit' }
        });
      }
      return mockResponse({ body: { ok: true } });
    };
    const client = new GitHubApiClient({ token: 't', fetch, maxRetries: 3, backoffBaseMs: 1, jitterMs: 0 });
    const r = await client.getJson<{ ok: boolean }>('/foo');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(attempt, 2);
  });

  it('gives up after maxRetries and throws a classified error', async () => {
    const fetch: FetchLike = async () => mockResponse({ status: 500, body: { message: 'oops' } });
    const client = new GitHubApiClient({ token: 't', fetch, maxRetries: 2, backoffBaseMs: 1, jitterMs: 0 });
    await assert.rejects(
      client.getJson('/foo'),
      (err: Error) => /after 2 retries/.test(err.message) && /500/.test(err.message)
    );
  });

  it('supports If-None-Match: returns notModified on 304 without refetch', async () => {
    let attempt = 0;
    const fetch: FetchLike = async (req) => {
      attempt += 1;
      if (req.headers.get('if-none-match') === 'etag-abc') {
        return new Response(null, { status: 304 });
      }
      return mockResponse({ headers: { etag: 'etag-abc' }, body: { ok: true } });
    };
    const client = new GitHubApiClient({ token: 't', fetch });
    const first = await client.getJsonWithEtag<{ ok: boolean }>('/foo');
    assert.strictEqual(first.status, 'ok');
    assert.strictEqual(first.etag, 'etag-abc');
    const second = await client.getJsonWithEtag<{ ok: boolean }>('/foo', first.etag);
    assert.strictEqual(second.status, 'notModified');
    assert.strictEqual(attempt, 2);
  });

  it('4xx (other than 403 rate limit) is raised immediately (no retry)', async () => {
    let attempt = 0;
    const fetch: FetchLike = async () => {
      attempt += 1;
      return mockResponse({ status: 404, body: { message: 'Not Found' } });
    };
    const client = new GitHubApiClient({ token: 't', fetch, maxRetries: 3, backoffBaseMs: 1, jitterMs: 0 });
    await assert.rejects(client.getJson('/nope'), /404/);
    assert.strictEqual(attempt, 1);
  });
});

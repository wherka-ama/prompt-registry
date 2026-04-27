/**
 * Tests for `lib/src/github/client.ts` — GitHubClient.
 *
 * Drives every branch via a fake `fetch`:
 *   - happy path: 200 -> getJson / getText
 *   - ETag conditional: 304 with cached value
 *   - retry on transient 5xx (counts attempts, observes backoff)
 *   - retry on secondary rate-limit (Retry-After honoured)
 *   - primary rate-limit: x-ratelimit-remaining=0 -> sleep until reset
 *   - fatal 4xx: 401, 404, 422 -> immediate throw with body
 *   - rate-limit telemetry capture from headers
 *   - observability events fire in correct order
 *   - max-retries cap respected
 *   - User-Agent + Accept + auth header sent on every request
 */
import {
  strict as assert,
} from 'node:assert';
import {
  describe,
  it,
} from 'mocha';
import {
  type FetchLike,
  GitHubClient,
} from '../../src/github/client';
import {
  GitHubApiError,
} from '../../src/github/errors';
import type {
  ClientEvent,
} from '../../src/github/events';
import {
  staticTokenProvider,
} from '../../src/github/token';

interface FakeStep {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

const fakeFetch = (steps: FakeStep[]): { fetch: FetchLike; calls: Request[] } => {
  const calls: Request[] = [];
  let i = 0;
  const fetch: FetchLike = (req: Request): Promise<Response> => {
    calls.push(req);
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    const headers = new Headers(step.headers ?? {});
    // Status 304 (and other null-body statuses) must be constructed with null body.
    const nullBodyStatus = step.status === 304 || step.status === 204 || step.status === 205;
    return Promise.resolve(new Response(nullBodyStatus ? null : (step.body ?? ''), {
      status: step.status,
      headers
    }));
  };
  return { fetch, calls };
};

const newClient = (
  steps: FakeStep[],
  events?: ClientEvent[],
  overrides: Partial<ConstructorParameters<typeof GitHubClient>[0]> = {}
): { client: GitHubClient; calls: Request[] } => {
  const { fetch, calls } = fakeFetch(steps);
  const client = new GitHubClient({
    tokens: staticTokenProvider('test-token'),
    fetch,
    backoffBaseMs: 1,
    jitterMs: 0,
    maxSleepMs: 10,
    sleep: () => Promise.resolve(), // skip real waits
    onEvent: events === undefined
      ? undefined
      : (e): void => {
        events.push(e);
      },
    ...overrides
  });
  return { client, calls };
};

describe('github/client GitHubClient', () => {
  describe('getJson', () => {
    it('returns parsed JSON on 200', async () => {
      const { client } = newClient([
        { status: 200, body: '{"ok":true}', headers: { 'content-type': 'application/json' } }
      ]);
      const r = await client.getJson<{ ok: boolean }>('/x');
      assert.deepEqual(r, { ok: true });
    });

    it('attaches Authorization, Accept, User-Agent, X-GitHub-Api-Version headers', async () => {
      const { client, calls } = newClient([{ status: 200, body: '{}' }]);
      await client.getJson('/x');
      const h = calls[0].headers;
      assert.equal(h.get('authorization'), 'Bearer test-token');
      assert.equal(h.get('accept'), 'application/vnd.github+json');
      assert.equal(h.get('x-github-api-version'), '2022-11-28');
      assert.match(h.get('user-agent') ?? '', /prompt-registry/i);
    });

    it('joins relative paths against api.github.com', async () => {
      const { client, calls } = newClient([{ status: 200, body: '{}' }]);
      await client.getJson('/repos/foo/bar');
      assert.equal(calls[0].url, 'https://api.github.com/repos/foo/bar');
    });

    it('passes absolute URLs through unchanged', async () => {
      const { client, calls } = newClient([{ status: 200, body: '{}' }]);
      await client.getJson('https://api.github.com/explicit');
      assert.equal(calls[0].url, 'https://api.github.com/explicit');
    });

    it('throws GitHubApiError on 404', async () => {
      const { client } = newClient([{ status: 404, body: 'not found' }]);
      await assert.rejects(
        () => client.getJson('/x'),
        (err: Error) =>
          err instanceof GitHubApiError
          && (err).status === 404
          && (err).body.includes('not found')
      );
    });

    it('does NOT retry on 401 (fatal auth error)', async () => {
      const { client, calls } = newClient([
        { status: 401, body: 'bad creds' },
        { status: 200, body: '{}' }
      ]);
      await assert.rejects(() => client.getJson('/x'), GitHubApiError);
      assert.equal(calls.length, 1);
    });
  });

  describe('retry on transient 5xx', () => {
    it('succeeds after one 503 retry', async () => {
      const { client, calls } = newClient([
        { status: 503, body: 'gateway' },
        { status: 200, body: '{"ok":1}' }
      ]);
      const r = await client.getJson<{ ok: number }>('/x');
      assert.deepEqual(r, { ok: 1 });
      assert.equal(calls.length, 2);
    });

    it('retries 408 / 429 / 500 / 502 / 503 / 504', async () => {
      for (const code of [408, 429, 500, 502, 503, 504]) {
        const { client, calls } = newClient([
          { status: code, body: 'x' },
          { status: 200, body: '{}' }
        ]);
        await client.getJson('/x');
        assert.equal(calls.length, 2, `status ${String(code)} should retry`);
      }
    });

    it('gives up after maxRetries', async () => {
      const { client, calls } = newClient(
        [{ status: 503, body: 'down' }],
        undefined,
        { maxRetries: 2 }
      );
      await assert.rejects(() => client.getJson('/x'), GitHubApiError);
      // 1 initial + 2 retries = 3 calls.
      assert.equal(calls.length, 3);
    });

    it('emits retry events with attempt + sleepMs', async () => {
      const events: ClientEvent[] = [];
      const { client } = newClient(
        [{ status: 503, body: 'x' }, { status: 200, body: '{}' }],
        events
      );
      await client.getJson('/x');
      const kinds = events.map((e) => e.kind);
      assert.deepEqual(kinds, ['request', 'retry', 'request', 'success']);
      assert.ok(typeof events[1].sleepMs === 'number' && events[1].sleepMs >= 0);
    });
  });

  describe('rate-limit handling', () => {
    it('sleeps until x-ratelimit-reset on 403 with remaining=0', async () => {
      const reset = Math.floor(Date.now() / 1000) + 1;
      const events: ClientEvent[] = [];
      const { client } = newClient(
        [
          {
            status: 403,
            body: 'rate limit',
            headers: {
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': String(reset)
            }
          },
          { status: 200, body: '{}' }
        ],
        events,
        { maxSleepMs: 100_000 }
      );
      await client.getJson('/x');
      const rl = events.find((e) => e.kind === 'rate-limit');
      assert.ok(rl !== undefined, 'rate-limit event missing');
      assert.equal(rl.reason, 'primary rate limit');
    });

    it('honours Retry-After on secondary rate limit (403 + body match)', async () => {
      const events: ClientEvent[] = [];
      const { client } = newClient(
        [
          {
            status: 403,
            body: 'You have exceeded a secondary rate limit',
            headers: { 'retry-after': '1' }
          },
          { status: 200, body: '{}' }
        ],
        events
      );
      await client.getJson('/x');
      const rl = events.find((e) => e.kind === 'rate-limit');
      assert.ok(rl !== undefined);
      assert.equal(rl.reason, 'secondary rate limit');
    });

    it('treats 403 without rate-limit signals as fatal', async () => {
      const { client, calls } = newClient([
        { status: 403, body: 'forbidden — repo private' }
      ]);
      await assert.rejects(() => client.getJson('/x'), GitHubApiError);
      assert.equal(calls.length, 1);
    });
  });

  describe('rate-limit telemetry', () => {
    it('captures lastRateLimit on every response', async () => {
      const reset = Math.floor(Date.now() / 1000) + 60;
      const { client } = newClient([
        {
          status: 200,
          body: '{}',
          headers: {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-used': '1',
            'x-ratelimit-reset': String(reset)
          }
        }
      ]);
      await client.getJson('/x');
      assert.equal(client.lastRateLimit.limit, 5000);
      assert.equal(client.lastRateLimit.remaining, 4999);
      assert.equal(client.lastRateLimit.used, 1);
      assert.ok(client.lastRateLimit.resetAt instanceof Date);
    });

    it('leaves telemetry undefined when headers missing', async () => {
      const { client } = newClient([{ status: 200, body: '{}' }]);
      await client.getJson('/x');
      assert.equal(client.lastRateLimit.limit, undefined);
    });
  });

  describe('getJsonWithEtag', () => {
    it('returns ok with etag on 200', async () => {
      const { client } = newClient([
        { status: 200, body: '{"v":1}', headers: { etag: '"abc"' } }
      ]);
      const r = await client.getJsonWithEtag<{ v: number }>('/x');
      assert.equal(r.status, 'ok');
      if (r.status === 'ok') {
        assert.deepEqual(r.value, { v: 1 });
        assert.equal(r.etag, '"abc"');
      }
    });

    it('returns notModified on 304', async () => {
      const { client, calls } = newClient([{ status: 304 }]);
      const r = await client.getJsonWithEtag('/x', '"abc"');
      assert.equal(r.status, 'notModified');
      assert.equal(calls[0].headers.get('if-none-match'), '"abc"');
    });

    it('emits a not-modified event on 304', async () => {
      const events: ClientEvent[] = [];
      const { client } = newClient([{ status: 304 }], events);
      await client.getJsonWithEtag('/x', '"abc"');
      assert.ok(events.some((e) => e.kind === 'not-modified'));
    });
  });

  describe('getText', () => {
    it('returns raw text body', async () => {
      const { client } = newClient([{ status: 200, body: 'hello world' }]);
      assert.equal(await client.getText('/x'), 'hello world');
    });
  });

  describe('unauthenticated mode', () => {
    it('omits Authorization when no token resolves', async () => {
      const { fetch, calls } = fakeFetch([{ status: 200, body: '{}' }]);
      const client = new GitHubClient({
        tokens: staticTokenProvider(''), // returns null
        fetch,
        backoffBaseMs: 1,
        jitterMs: 0,
        maxSleepMs: 10,
        sleep: () => Promise.resolve()
      });
      await client.getJson('/x');
      assert.equal(calls[0].headers.get('authorization'), null);
    });
  });
});

/**
 * Phase 5 spillover / Iter 18 — HttpClient + TokenProvider tests.
 *
 * Validates the `envTokenProvider` host filter and provides a small
 * RecordingHttpClient test double that subsequent iterations will
 * compose against `GitHubBundleResolver` and `HttpsBundleDownloader`
 * without spinning up real sockets.
 */
import * as assert from 'node:assert';
import {
  envTokenProvider,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
  NULL_TOKEN_PROVIDER,
} from '../../src/install/http';

/**
 * Recording HttpClient that returns canned responses keyed on URL +
 * method. Logs every request for assertions.
 */
export class RecordingHttpClient implements HttpClient {
  public readonly seen: HttpRequest[] = [];

  public constructor(
    private readonly responders: Record<string, HttpResponse | ((req: HttpRequest) => HttpResponse)>
  ) {}

  public fetch(req: HttpRequest): Promise<HttpResponse> {
    this.seen.push(req);
    const key = `${req.method ?? 'GET'} ${req.url}`;
    const responder = this.responders[key];
    if (responder === undefined) {
      return Promise.reject(new Error(`RecordingHttpClient: no responder for ${key}`));
    }
    return Promise.resolve(typeof responder === 'function' ? responder(req) : responder);
  }
}

/**
 * Minimal helper to build an HttpResponse without ceremony.
 * @param body
 * @param headers
 */
export const okResponse = (body: string | Uint8Array, headers: Record<string, string> = {}): HttpResponse => ({
  statusCode: 200,
  body: typeof body === 'string' ? new TextEncoder().encode(body) : body,
  finalUrl: 'https://recorded',
  headers
});

describe('Phase 5 spillover / iter 18 - HttpClient + TokenProvider', () => {
  describe('NULL_TOKEN_PROVIDER', () => {
    it('always returns null', async () => {
      assert.strictEqual(await NULL_TOKEN_PROVIDER.getToken('github.com'), null);
    });
  });

  describe('envTokenProvider', () => {
    it('returns the token for github.com hosts', async () => {
      const tp = envTokenProvider({ GITHUB_TOKEN: 'tk' });
      assert.strictEqual(await tp.getToken('github.com'), 'tk');
      assert.strictEqual(await tp.getToken('api.github.com'), 'tk');
      assert.strictEqual(await tp.getToken('raw.githubusercontent.com'), 'tk');
    });

    it('returns null for unrelated hosts', async () => {
      const tp = envTokenProvider({ GITHUB_TOKEN: 'tk' });
      assert.strictEqual(await tp.getToken('example.com'), null);
    });

    it('prefers GITHUB_TOKEN over GH_TOKEN', async () => {
      const tp = envTokenProvider({ GITHUB_TOKEN: 'a', GH_TOKEN: 'b' });
      assert.strictEqual(await tp.getToken('github.com'), 'a');
    });

    it('falls back to GH_TOKEN when GITHUB_TOKEN is unset', async () => {
      const tp = envTokenProvider({ GH_TOKEN: 'b' });
      assert.strictEqual(await tp.getToken('github.com'), 'b');
    });

    it('returns null when neither var is set (and gh CLI fallback disabled)', async () => {
      // PROMPT_REGISTRY_DISABLE_GH_CLI=1 prevents the lazy gh-cli
      // fallback from running on machines where the user happens to
      // be authenticated. The behavior of the gh-cli fallback itself
      // is exercised separately in the e2e CLI tests.
      const tp = envTokenProvider({ PROMPT_REGISTRY_DISABLE_GH_CLI: '1' });
      assert.strictEqual(await tp.getToken('github.com'), null);
    });

    it('non-github hosts always get null even with token set', async () => {
      const tp = envTokenProvider({ GITHUB_TOKEN: 'x', PROMPT_REGISTRY_DISABLE_GH_CLI: '1' });
      assert.strictEqual(await tp.getToken('example.com'), null);
    });
  });

  describe('compositeTokenProvider', () => {
    it('returns first non-null token in order', async () => {
      const { compositeTokenProvider } = await import('../../src/install/http');
      const tp = compositeTokenProvider(
        { getToken: async (): Promise<string | null> => null },
        { getToken: async (): Promise<string | null> => 'second' },
        { getToken: async (): Promise<string | null> => 'third' }
      );
      assert.strictEqual(await tp.getToken('github.com'), 'second');
    });

    it('returns null when no provider has a token', async () => {
      const { compositeTokenProvider } = await import('../../src/install/http');
      const tp = compositeTokenProvider(
        { getToken: async (): Promise<string | null> => null },
        { getToken: async (): Promise<string | null> => '' }
      );
      assert.strictEqual(await tp.getToken('github.com'), null);
    });
  });

  describe('ghCliTokenProvider', () => {
    it('returns null for non-github hosts without spawning gh', async () => {
      const { ghCliTokenProvider } = await import('../../src/install/http');
      const tp = ghCliTokenProvider();
      assert.strictEqual(await tp.getToken('example.com'), null);
    });
    // Behavior on github hosts is gated by whether `gh` is installed
    // and authenticated on the test runner; covered by manual e2e.
  });

  describe('RecordingHttpClient', () => {
    it('returns the canned response and records the request', async () => {
      const cli = new RecordingHttpClient({
        'GET https://x/y': okResponse('hi')
      });
      const r = await cli.fetch({ url: 'https://x/y' });
      assert.strictEqual(r.statusCode, 200);
      assert.strictEqual(new TextDecoder().decode(r.body), 'hi');
      assert.strictEqual(cli.seen.length, 1);
    });
  });
});

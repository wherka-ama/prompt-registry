import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  envTokenProvider,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
  NULL_TOKEN_PROVIDER,
} from '../src/install/http';

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

export const okResponse = (body: string | Uint8Array, headers: Record<string, string> = {}): HttpResponse => ({
  statusCode: 200,
  body: typeof body === 'string' ? new TextEncoder().encode(body) : body,
  finalUrl: 'https://recorded',
  headers
});

describe('HttpClient + TokenProvider', () => {
  describe('NULL_TOKEN_PROVIDER', () => {
    it('always returns null', async () => {
      expect(await NULL_TOKEN_PROVIDER.getToken('github.com')).toBeNull();
    });
  });

  describe('envTokenProvider', () => {
    it('returns the token for github.com hosts', async () => {
      const tp = envTokenProvider({ GITHUB_TOKEN: 'tk' });
      expect(await tp.getToken('github.com')).toBe('tk');
      expect(await tp.getToken('api.github.com')).toBe('tk');
      expect(await tp.getToken('raw.githubusercontent.com')).toBe('tk');
    });

    it('returns null for unrelated hosts', async () => {
      const tp = envTokenProvider({ GITHUB_TOKEN: 'tk' });
      expect(await tp.getToken('example.com')).toBeNull();
    });

    it('prefers GITHUB_TOKEN over GH_TOKEN', async () => {
      const tp = envTokenProvider({ GITHUB_TOKEN: 'a', GH_TOKEN: 'b' });
      expect(await tp.getToken('github.com')).toBe('a');
    });

    it('falls back to GH_TOKEN when GITHUB_TOKEN is unset', async () => {
      const tp = envTokenProvider({ GH_TOKEN: 'b' });
      expect(await tp.getToken('github.com')).toBe('b');
    });

    it('returns null when neither var is set (and gh CLI fallback disabled)', async () => {
      const tp = envTokenProvider({ PROMPT_REGISTRY_DISABLE_GH_CLI: '1' });
      expect(await tp.getToken('github.com')).toBeNull();
    });

    it('non-github hosts always get null even with token set', async () => {
      const tp = envTokenProvider({ GITHUB_TOKEN: 'x', PROMPT_REGISTRY_DISABLE_GH_CLI: '1' });
      expect(await tp.getToken('example.com')).toBeNull();
    });
  });

  describe('compositeTokenProvider', () => {
    it('returns first non-null token in order', async () => {
      const { compositeTokenProvider } = await import('../src/install/http');
      const tp = compositeTokenProvider(
        { getToken: async (): Promise<string | null> => null },
        { getToken: async (): Promise<string | null> => 'second' },
        { getToken: async (): Promise<string | null> => 'third' }
      );
      expect(await tp.getToken('github.com')).toBe('second');
    });

    it('returns null when no provider has a token', async () => {
      const { compositeTokenProvider } = await import('../src/install/http');
      const tp = compositeTokenProvider(
        { getToken: async (): Promise<string | null> => null },
        { getToken: async (): Promise<string | null> => '' }
      );
      expect(await tp.getToken('github.com')).toBeNull();
    });
  });

  describe('ghCliTokenProvider', () => {
    it('returns null for non-github hosts without spawning gh', async () => {
      const { ghCliTokenProvider } = await import('../src/install/http');
      const tp = ghCliTokenProvider();
      expect(await tp.getToken('example.com')).toBeNull();
    });
  });

  describe('RecordingHttpClient', () => {
    it('returns the canned response and records the request', async () => {
      const cli = new RecordingHttpClient({
        'GET https://x/y': okResponse('hi')
      });
      const r = await cli.fetch({ url: 'https://x/y' });
      expect(r.statusCode).toBe(200);
      expect(new TextDecoder().decode(r.body)).toBe('hi');
      expect(cli.seen.length).toBe(1);
    });
  });
});

/**
 * Tests for `lib/src/github/asset-fetcher.ts` — AssetFetcher.
 *
 * Covers the lessons from I-012 (strict Accept on api.github.com
 * release-asset endpoint vs permissive Accept elsewhere) plus the
 * baseline retry-on-5xx and integrity-check paths.
 */
import {
  strict as assert,
} from 'node:assert';
import {
  describe,
  it,
} from 'mocha';
import {
  AssetFetcher,
  type FetchLike,
} from '../../src/github/asset-fetcher';
import {
  staticTokenProvider,
} from '../../src/github/token';

interface Step {
  status: number;
  body?: Uint8Array;
  headers?: Record<string, string>;
}

const fakeFetch = (steps: Step[]): { fetch: FetchLike; calls: Request[] } => {
  const calls: Request[] = [];
  let i = 0;
  const fetch: FetchLike = (req: Request): Promise<Response> => {
    calls.push(req);
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    return Promise.resolve(new Response(step.body ?? new Uint8Array(), {
      status: step.status,
      headers: step.headers ?? {}
    }));
  };
  return { fetch, calls };
};

const newFetcher = (steps: Step[]): { fetcher: AssetFetcher; calls: Request[] } => {
  const { fetch, calls } = fakeFetch(steps);
  const fetcher = new AssetFetcher({
    tokens: staticTokenProvider('tok'),
    fetch,
    sleep: () => Promise.resolve(),
    backoffBaseMs: 1,
    jitterMs: 0
  });
  return { fetcher, calls };
};

describe('github/asset-fetcher AssetFetcher', () => {
  describe('Accept header switching (I-012)', () => {
    it('uses strict octet-stream for api.github.com release assets', async () => {
      const { fetcher, calls } = newFetcher([
        { status: 200, body: new Uint8Array([1, 2, 3]) }
      ]);
      await fetcher.fetchBytes('https://api.github.com/repos/a/b/releases/assets/123');
      assert.equal(calls[0].headers.get('accept'), 'application/octet-stream');
    });

    it('uses permissive accept for other GitHub hosts', async () => {
      const { fetcher, calls } = newFetcher([
        { status: 200, body: new Uint8Array([1]) }
      ]);
      await fetcher.fetchBytes('https://raw.githubusercontent.com/a/b/main/x.md');
      const accept = calls[0].headers.get('accept') ?? '';
      assert.match(accept, /\*\/\*/);
    });

    it('uses permissive accept for non-GitHub hosts', async () => {
      const { fetcher, calls } = newFetcher([
        { status: 200, body: new Uint8Array([1]) }
      ]);
      await fetcher.fetchBytes('https://example.com/asset.zip');
      const accept = calls[0].headers.get('accept') ?? '';
      assert.match(accept, /\*\/\*/);
    });
  });

  describe('auth handling', () => {
    it('attaches Bearer token for GitHub hosts', async () => {
      const { fetcher, calls } = newFetcher([{ status: 200, body: new Uint8Array() }]);
      await fetcher.fetchBytes('https://api.github.com/repos/a/b/releases/assets/1');
      assert.equal(calls[0].headers.get('authorization'), 'Bearer tok');
    });

    it('omits auth for non-GitHub hosts (token provider returns null)', async () => {
      const { fetcher, calls } = newFetcher([{ status: 200, body: new Uint8Array() }]);
      await fetcher.fetchBytes('https://example.com/x.zip');
      assert.equal(calls[0].headers.get('authorization'), null);
    });
  });

  describe('happy path', () => {
    it('returns bytes + sha256', async () => {
      const data = new Uint8Array([0x01, 0x02, 0x03]);
      const { fetcher } = newFetcher([{ status: 200, body: data }]);
      const r = await fetcher.fetchBytes('https://example.com/x');
      assert.equal(r.bytes.length, 3);
      // sha256 of 0x01 0x02 0x03 (lowercase hex)
      assert.equal(r.sha256, '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
    });
  });

  describe('integrity', () => {
    it('verifies provided sha256-<hex> integrity', async () => {
      const data = new Uint8Array([0xFF]);
      const { fetcher } = newFetcher([{ status: 200, body: data }]);
      // sha256 of 0xff
      const r = await fetcher.fetchBytes('https://example.com/x', {
        integrity: 'sha256-a8100ae6aa1940d0b663bb31cd466142ebbdbd5187131b92d93818987832eb89'
      });
      assert.equal(r.bytes.length, 1);
    });

    it('throws on integrity mismatch', async () => {
      const { fetcher } = newFetcher([{ status: 200, body: new Uint8Array([1]) }]);
      await assert.rejects(
        () => fetcher.fetchBytes('https://example.com/x', { integrity: 'sha256-deadbeef' }),
        /integrity mismatch/
      );
    });
  });

  describe('retry on 5xx', () => {
    it('retries once on 502 then succeeds', async () => {
      const { fetcher, calls } = newFetcher([
        { status: 502 },
        { status: 200, body: new Uint8Array([1]) }
      ]);
      const r = await fetcher.fetchBytes('https://example.com/x');
      assert.equal(r.bytes.length, 1);
      assert.equal(calls.length, 2);
    });

    it('does not retry on 404', async () => {
      const { fetcher, calls } = newFetcher([
        { status: 404 },
        { status: 200, body: new Uint8Array([1]) }
      ]);
      await assert.rejects(() => fetcher.fetchBytes('https://example.com/x'), /404/);
      assert.equal(calls.length, 1);
    });

    it('does not retry on 401', async () => {
      const { fetcher, calls } = newFetcher([
        { status: 401 },
        { status: 200, body: new Uint8Array([1]) }
      ]);
      await assert.rejects(() => fetcher.fetchBytes('https://example.com/x'), /401/);
      assert.equal(calls.length, 1);
    });

    it('gives up after maxRetries', async () => {
      const { fetcher, calls } = newFetcher([{ status: 503 }]);
      // default maxRetries=3 for asset fetcher (lighter than client default 4).
      await assert.rejects(() => fetcher.fetchBytes('https://example.com/x'), /503/);
      assert.equal(calls.length, 4); // 1 + 3 retries
    });
  });

  describe('inline bytes shortcut', () => {
    it('returns inline bytes without calling fetch', async () => {
      const { fetcher, calls } = newFetcher([{ status: 200, body: new Uint8Array([99]) }]);
      const inline = new Uint8Array([1, 2, 3, 4]);
      const r = await fetcher.fetchBytes('', { inlineBytes: inline });
      assert.equal(r.bytes.length, 4);
      assert.equal(calls.length, 0);
    });

    it('verifies integrity on inline bytes too', async () => {
      const { fetcher } = newFetcher([{ status: 200, body: new Uint8Array() }]);
      const inline = new Uint8Array([1]);
      await assert.rejects(
        () => fetcher.fetchBytes('', { inlineBytes: inline, integrity: 'sha256-deadbeef' }),
        /integrity/
      );
    });
  });
});

/**
 * Phase 5 spillover / Iter 26 — HttpsBundleDownloader tests.
 *
 * Composes RecordingHttpClient + TokenProvider doubles against the
 * real downloader.
 */
import * as assert from 'node:assert';
import type {
  Installable,
} from '../../src/domain/install';
import {
  sha256Hex,
} from '../../src/install/downloader';
import {
  envTokenProvider,
  type HttpResponse,
  NULL_TOKEN_PROVIDER,
} from '../../src/install/http';
import {
  HttpsBundleDownloader,
} from '../../src/install/https-downloader';
import {
  RecordingHttpClient,
} from './http.test';

const inst = (overrides: Partial<Installable> = {}): Installable => ({
  ref: {
    sourceId: 'github-abc', sourceType: 'github',
    bundleId: 'foo', bundleVersion: '1.0.0', installed: false
  },
  downloadUrl: 'https://example.com/foo/bundle.zip',
  ...overrides
});

const okBytes = (bytes: Uint8Array): HttpResponse => ({
  statusCode: 200, body: bytes, finalUrl: 'https://x', headers: {}
});

describe('Phase 5 spillover / iter 26 - HttpsBundleDownloader', () => {
  it('returns the bytes + sha256 on a 200', async () => {
    const bytes = new TextEncoder().encode('PK fake zip');
    const http = new RecordingHttpClient({
      'GET https://example.com/foo/bundle.zip': okBytes(bytes)
    });
    const dl = new HttpsBundleDownloader(http, NULL_TOKEN_PROVIDER);
    const r = await dl.download(inst());
    assert.deepStrictEqual(r.bytes, bytes);
    assert.strictEqual(r.sha256, await sha256Hex(bytes));
  });

  it('rejects on non-2xx', async () => {
    const http = new RecordingHttpClient({
      'GET https://example.com/foo/bundle.zip': {
        statusCode: 500, body: new Uint8Array(), finalUrl: 'x', headers: {}
      }
    });
    const dl = new HttpsBundleDownloader(http, NULL_TOKEN_PROVIDER);
    await assert.rejects(() => dl.download(inst()), /HTTP 500/);
  });

  it('verifies integrity when present', async () => {
    const bytes = new TextEncoder().encode('hello');
    const sha = await sha256Hex(bytes);
    const http = new RecordingHttpClient({
      'GET https://example.com/foo/bundle.zip': okBytes(bytes)
    });
    const dl = new HttpsBundleDownloader(http, NULL_TOKEN_PROVIDER);
    const r = await dl.download(inst({ integrity: `sha256-${sha}` }));
    assert.strictEqual(r.sha256, sha);
  });

  it('throws on integrity mismatch', async () => {
    const http = new RecordingHttpClient({
      'GET https://example.com/foo/bundle.zip': okBytes(new TextEncoder().encode('hello'))
    });
    const dl = new HttpsBundleDownloader(http, NULL_TOKEN_PROVIDER);
    await assert.rejects(
      () => dl.download(inst({ integrity: 'sha256-deadbeef' })),
      /integrity mismatch/
    );
  });

  it('attaches Authorization header when TokenProvider has a token for the host', async () => {
    const http = new RecordingHttpClient({
      'GET https://github.com/o/r/releases/download/v1/bundle.zip': okBytes(new Uint8Array())
    });
    const dl = new HttpsBundleDownloader(http, envTokenProvider({ GITHUB_TOKEN: 'tk' }));
    await dl.download(inst({
      downloadUrl: 'https://github.com/o/r/releases/download/v1/bundle.zip'
    }));
    // The migration to AssetFetcher routes headers through native
    // `Headers`, which normalizes names to lower-case. Look it up
    // case-insensitively.
    const auth = findHeader(http.seen[0].headers, 'authorization');
    assert.strictEqual(auth, 'Bearer tk');
  });

  it('omits Authorization header for unrelated hosts', async () => {
    const http = new RecordingHttpClient({
      'GET https://cdn.example.com/asset.zip': okBytes(new Uint8Array())
    });
    const dl = new HttpsBundleDownloader(http, envTokenProvider({ GITHUB_TOKEN: 'tk' }));
    await dl.download(inst({ downloadUrl: 'https://cdn.example.com/asset.zip' }));
    const auth = findHeader(http.seen[0].headers, 'authorization');
    assert.strictEqual(auth, undefined);
  });
});

const findHeader = (
  headers: Record<string, string> | undefined,
  name: string
): string | undefined => {
  if (headers === undefined) {
    return undefined;
  }
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      return v;
    }
  }
  return undefined;
};

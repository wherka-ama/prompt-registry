/**
 * Tests for BlobFetcher — glue between the GitHubApiClient and BlobCache.
 *
 * Contract:
 *   - fetch(sha) returns bytes; on cache hit there is no network call.
 *   - On cache miss, the GitHub git/blobs endpoint is called; the result
 *     is validated (sha must match) and stored.
 *   - Base64 decoding is handled here so the rest of the pipeline works
 *     with raw Buffer.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BlobCache,
  computeGitBlobSha,
} from '../../src/primitive-index/hub/blob-cache';
import {
  BlobFetcher,
} from '../../src/primitive-index/hub/blob-fetcher';
import {
  type FetchLike,
  GitHubApiClient,
} from '../../src/primitive-index/hub/github-api-client';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-bfetch-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function b64(buf: Buffer): string {
  return buf.toString('base64');
}

describe('primitive-index / blob-fetcher', () => {
  it('fetches via git/blobs on miss, decodes base64, and stores in cache', async () => {
    const bytes = Buffer.from('# primitive\n', 'utf8');
    const sha = computeGitBlobSha(bytes);
    let networkCalls = 0;
    const fetch: FetchLike = async (req) => {
      networkCalls += 1;
      assert.match(req.url, new RegExp(`/git/blobs/${sha}$`));
      return Response.json({
        sha, size: bytes.length, content: b64(bytes), encoding: 'base64'
      }, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client = new GitHubApiClient({ token: 't', fetch });
    const cache = new BlobCache(tmp);
    const fetcher = new BlobFetcher({ client, cache });
    const out = await fetcher.fetch({ owner: 'o', repo: 'r', sha });
    assert.ok(out.equals(bytes));
    assert.strictEqual(networkCalls, 1);
    // Second call hits cache.
    const out2 = await fetcher.fetch({ owner: 'o', repo: 'r', sha });
    assert.ok(out2.equals(bytes));
    assert.strictEqual(networkCalls, 1);
  });

  it('rejects a server response whose sha does not match (tamper guard)', async () => {
    const bytes = Buffer.from('legit', 'utf8');
    const sha = computeGitBlobSha(bytes);
    const fetch: FetchLike = async () => Response.json({
      sha, size: bytes.length,
      content: b64(Buffer.from('TAMPERED', 'utf8')),
      encoding: 'base64'
    }, { status: 200, headers: { 'content-type': 'application/json' } });
    const client = new GitHubApiClient({ token: 't', fetch });
    const fetcher = new BlobFetcher({ client, cache: new BlobCache(tmp) });
    await assert.rejects(
      fetcher.fetch({ owner: 'o', repo: 'r', sha }),
      /sha mismatch/i
    );
  });

  it('supports utf-8 encoded blobs (GitHub returns small non-binary this way)', async () => {
    const bytes = Buffer.from('plain\n', 'utf8');
    const sha = computeGitBlobSha(bytes);
    const fetch: FetchLike = async () => Response.json({
      // eslint-disable-next-line unicorn/text-encoding-identifier-case -- mirrors GitHub response verbatim.
      sha, size: bytes.length, content: bytes.toString('utf8'), encoding: 'utf-8'
    }, { status: 200, headers: { 'content-type': 'application/json' } });
    const client = new GitHubApiClient({ token: 't', fetch });
    const fetcher = new BlobFetcher({ client, cache: new BlobCache(tmp) });
    const out = await fetcher.fetch({ owner: 'o', repo: 'r', sha });
    assert.ok(out.equals(bytes));
  });
});

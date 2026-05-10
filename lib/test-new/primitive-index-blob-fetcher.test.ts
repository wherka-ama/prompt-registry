import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  BlobCache,
  computeGitBlobSha,
} from '../src/primitive-index/hub/blob-cache';
import {
  BlobFetcher,
} from '../src/primitive-index/hub/blob-fetcher';
import {
  type FetchLike,
  GitHubApiClient,
} from '../src/primitive-index/hub/github-api-client';

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

describe('blob-fetcher', () => {
  it('fetches via git/blobs on miss, decodes base64, and stores in cache', async () => {
    const bytes = Buffer.from('# primitive\n', 'utf8');
    const sha = computeGitBlobSha(bytes);
    let networkCalls = 0;
    const fetch: FetchLike = async (req) => {
      networkCalls += 1;
      expect(req.url).toMatch(new RegExp(`/git/blobs/${sha}$`));
      return Response.json({
        sha, size: bytes.length, content: b64(bytes), encoding: 'base64'
      }, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client = new GitHubApiClient({ token: 't', fetch });
    const cache = new BlobCache(tmp);
    const fetcher = new BlobFetcher({ client, cache });
    const out = await fetcher.fetch({ owner: 'o', repo: 'r', sha });
    expect(out.equals(bytes)).toBe(true);
    expect(networkCalls).toBe(1);
    const out2 = await fetcher.fetch({ owner: 'o', repo: 'r', sha });
    expect(out2.equals(bytes)).toBe(true);
    expect(networkCalls).toBe(1);
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
    await expect(
      fetcher.fetch({ owner: 'o', repo: 'r', sha })
    ).rejects.toThrow(/sha mismatch/i);
  });

  it('supports utf-8 encoded blobs (GitHub returns small non-binary this way)', async () => {
    const bytes = Buffer.from('plain\n', 'utf8');
    const sha = computeGitBlobSha(bytes);
    const fetch: FetchLike = async () => Response.json({
      // eslint-disable-next-line unicorn/text-encoding-identifier-case -- mirrors GitHub response verbatim
      sha, size: bytes.length, content: bytes.toString('utf8'), encoding: 'utf-8'
    }, { status: 200, headers: { 'content-type': 'application/json' } });
    const client = new GitHubApiClient({ token: 't', fetch });
    const fetcher = new BlobFetcher({ client, cache: new BlobCache(tmp) });
    const out = await fetcher.fetch({ owner: 'o', repo: 'r', sha });
    expect(out.equals(bytes)).toBe(true);
  });
});

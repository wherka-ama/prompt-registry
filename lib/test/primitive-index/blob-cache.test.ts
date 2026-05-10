/**
 * Tests for the content-addressed blob cache used by the hub harvester.
 *
 * GitHub git/blobs endpoint returns the raw file content keyed by its git
 * blob SHA, which is already content-addressed: two files with identical
 * bytes share a SHA regardless of the repo they live in. Caching on disk
 * by SHA therefore gives us free dedup across sources.
 *
 * Properties we enforce:
 *   - get(sha) returns cached bytes without a network call.
 *   - put(sha, bytes) validates that sha matches git's blob-SHA formula
 *     (SHA1 of `blob <size>\0<bytes>`), preventing tampering where the
 *     server hands us mismatched content under a known SHA.
 *   - Atomic writes: reading a cache entry while another process writes
 *     never sees a half-written file.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BlobCache,
  computeGitBlobSha,
} from '../../src/primitive-index/hub/blob-cache';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-cache-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('primitive-index / blob-cache', () => {
  it('computeGitBlobSha matches git plumbing sha1', () => {
    const bytes = Buffer.from('hello\n');
    // git hash-object <file> for "hello\n" -> ce013625030ba8dba906f756967f9e9ca394464a
    assert.strictEqual(computeGitBlobSha(bytes), 'ce013625030ba8dba906f756967f9e9ca394464a');
    assert.strictEqual(computeGitBlobSha(Buffer.from('')), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });

  it('put then get round-trips bytes without a network call', async () => {
    const cache = new BlobCache(tmp);
    const bytes = Buffer.from('primitive content\n', 'utf8');
    const sha = computeGitBlobSha(bytes);
    await cache.put(sha, bytes);
    const out = await cache.get(sha);
    assert.ok(out && out.equals(bytes));
  });

  it('get returns undefined for unknown sha', async () => {
    const cache = new BlobCache(tmp);
    assert.strictEqual(await cache.get('0000000000000000000000000000000000000000'), undefined);
  });

  it('put rejects a sha that does not match the bytes (tamper guard)', async () => {
    const cache = new BlobCache(tmp);
    await assert.rejects(
      cache.put('deadbeef'.repeat(5), Buffer.from('anything')),
      /sha mismatch/i
    );
  });

  it('getOrFetch returns cached bytes without invoking the fetcher', async () => {
    const cache = new BlobCache(tmp);
    const bytes = Buffer.from('cached', 'utf8');
    const sha = computeGitBlobSha(bytes);
    await cache.put(sha, bytes);
    let calls = 0;
    const out = await cache.getOrFetch(sha, async () => {
      calls += 1;
      return Buffer.from('should not be called');
    });
    assert.strictEqual(calls, 0);
    assert.ok(out.equals(bytes));
  });

  it('getOrFetch populates the cache on first call', async () => {
    const cache = new BlobCache(tmp);
    const bytes = Buffer.from('fresh', 'utf8');
    const sha = computeGitBlobSha(bytes);
    const out1 = await cache.getOrFetch(sha, async () => bytes);
    assert.ok(out1.equals(bytes));
    const out2 = await cache.get(sha);
    assert.ok(out2?.equals(bytes));
  });

  it('stats() reports entry count and total size', async () => {
    const cache = new BlobCache(tmp);
    await cache.put(computeGitBlobSha(Buffer.from('a')), Buffer.from('a'));
    await cache.put(computeGitBlobSha(Buffer.from('bb')), Buffer.from('bb'));
    const s = await cache.stats();
    assert.strictEqual(s.entries, 2);
    assert.strictEqual(s.bytes, 3);
  });
});

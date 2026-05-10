/**
 * Phase 5 / Iter 12 — BundleDownloader tests.
 */
import * as assert from 'node:assert';
import type {
  Installable,
} from '../../src/domain/install';
import {
  MemoryBundleDownloader,
  sha256Hex,
} from '../../src/install/downloader';

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

const mkInstallable = (url: string, integrity?: string): Installable => ({
  ref: {
    sourceId: 'a/b',
    sourceType: 'github',
    bundleId: 'foo',
    bundleVersion: '1.0.0',
    installed: false
  },
  downloadUrl: url,
  ...(integrity === undefined ? {} : { integrity })
});

describe('Phase 5 / Iter 12 — MemoryBundleDownloader', () => {
  it('returns bytes + sha256 for a registered URL', async () => {
    const bytes = text('hello world');
    const dl = new MemoryBundleDownloader({ 'https://x/a.zip': bytes });
    const result = await dl.download(mkInstallable('https://x/a.zip'));
    assert.deepStrictEqual(result.bytes, bytes);
    assert.strictEqual(result.sha256.length, 64);
    assert.ok(/^[a-f0-9]+$/.test(result.sha256));
  });

  it('verifies integrity when supplied', async () => {
    const bytes = text('hello world');
    const expected = await sha256Hex(bytes);
    const dl = new MemoryBundleDownloader({ 'https://x/a.zip': bytes });
    const result = await dl.download(mkInstallable('https://x/a.zip', `sha256-${expected}`));
    assert.strictEqual(result.sha256, expected);
  });

  it('rejects an integrity mismatch', async () => {
    const dl = new MemoryBundleDownloader({ 'https://x/a.zip': text('hello world') });
    await assert.rejects(
      () => dl.download(mkInstallable('https://x/a.zip', 'sha256-deadbeef')),
      /integrity mismatch/
    );
  });

  it('throws when the URL is not registered', async () => {
    const dl = new MemoryBundleDownloader({});
    await assert.rejects(
      () => dl.download(mkInstallable('https://x/missing.zip')),
      /no bytes registered/
    );
  });

  it('sha256Hex matches a known vector', async () => {
    // Empty input → e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const got = await sha256Hex(new Uint8Array());
    assert.strictEqual(got, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

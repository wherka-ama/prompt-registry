import {
  describe,
  expect,
  it,
} from 'vitest';
import type {
  Installable,
} from '../src/domain/install';
import {
  MemoryBundleDownloader,
  sha256Hex,
} from './helpers/install-test-helpers';

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

describe('MemoryBundleDownloader', () => {
  it('returns bytes + sha256 for a registered URL', async () => {
    const bytes = text('hello world');
    const dl = new MemoryBundleDownloader({ 'https://x/a.zip': bytes });
    const result = await dl.download(mkInstallable('https://x/a.zip'));
    expect(result.bytes).toStrictEqual(bytes);
    expect(result.sha256.length).toBe(64);
    expect(/^[a-f0-9]+$/.test(result.sha256)).toBe(true);
  });

  it('verifies integrity when supplied', async () => {
    const bytes = text('hello world');
    const expected = await sha256Hex(bytes);
    const dl = new MemoryBundleDownloader({ 'https://x/a.zip': bytes });
    const result = await dl.download(mkInstallable('https://x/a.zip', `sha256-${expected}`));
    expect(result.sha256).toBe(expected);
  });

  it('rejects an integrity mismatch', async () => {
    const dl = new MemoryBundleDownloader({ 'https://x/a.zip': text('hello world') });
    await expect(
      dl.download(mkInstallable('https://x/a.zip', 'sha256-deadbeef'))
    ).rejects.toThrow(/integrity mismatch/);
  });

  it('throws when the URL is not registered', async () => {
    const dl = new MemoryBundleDownloader({});
    await expect(
      dl.download(mkInstallable('https://x/missing.zip'))
    ).rejects.toThrow(/no bytes registered/);
  });

  it('sha256Hex matches a known vector', async () => {
    const got = await sha256Hex(new Uint8Array());
    expect(got).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

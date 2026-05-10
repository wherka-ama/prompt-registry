/**
 * Phase 5 spillover / Iter 21 — GitHubBundleResolver tests.
 *
 * Composes RecordingHttpClient against the resolver to verify:
 *  - latest non-prerelease pick on undefined/`latest` version
 *  - exact tag match (with and without leading `v`)
 *  - missing version returns null
 *  - asset-name matching (defaults to bundle.zip)
 *  - 404 on /releases returns null
 *  - non-200 throws
 *  - Authorization header set when TokenProvider returns a token
 *  - sourceId is the stable `github-<12hex>` form
 */
import * as assert from 'node:assert';
import {
  GitHubBundleResolver,
} from '../../src/install/github-resolver';
import {
  envTokenProvider,
  type HttpResponse,
  NULL_TOKEN_PROVIDER,
} from '../../src/install/http';
import {
  generateSourceId,
} from '../../src/install/source-id';
import {
  okResponse,
  RecordingHttpClient,
} from './http.test';

const release = (tag: string, assetName = 'bundle.zip', extra: Partial<{ draft: boolean; prerelease: boolean }> = {}): unknown => ({
  tag_name: tag,
  name: tag,
  assets: [{ name: assetName, browser_download_url: `https://example.com/${tag}/${assetName}` }],
  ...extra
});

const releasesResponse = (releases: unknown[]): HttpResponse =>
  okResponse(JSON.stringify(releases));

describe('Phase 5 spillover / iter 21 - GitHubBundleResolver', () => {
  it('picks the newest non-prerelease for `latest` (or undefined version)', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/releases': releasesResponse([
        release('v2.0.0-rc.1', 'bundle.zip', { prerelease: true }),
        release('v1.5.0'),
        release('v1.4.0')
      ])
    });
    const r = new GitHubBundleResolver({ repoSlug: 'o/r', http, tokens: NULL_TOKEN_PROVIDER });
    const got = await r.resolve({ bundleId: 'foo' });
    assert.ok(got);
    assert.strictEqual(got.ref.bundleVersion, '1.5.0');
    assert.strictEqual(got.downloadUrl, 'https://example.com/v1.5.0/bundle.zip');
  });

  it('matches an exact version with or without leading v', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/releases': releasesResponse([
        release('v1.5.0'),
        release('1.4.0')
      ])
    });
    const r = new GitHubBundleResolver({ repoSlug: 'o/r', http, tokens: NULL_TOKEN_PROVIDER });
    const a = await r.resolve({ bundleId: 'foo', bundleVersion: '1.5.0' });
    const b = await r.resolve({ bundleId: 'foo', bundleVersion: '1.4.0' });
    assert.strictEqual(a?.ref.bundleVersion, '1.5.0');
    assert.strictEqual(b?.ref.bundleVersion, '1.4.0');
  });

  it('returns null when the requested version is absent', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/releases': releasesResponse([release('v1.0.0')])
    });
    const r = new GitHubBundleResolver({ repoSlug: 'o/r', http, tokens: NULL_TOKEN_PROVIDER });
    assert.strictEqual(await r.resolve({ bundleId: 'foo', bundleVersion: '9.9.9' }), null);
  });

  it('returns null when the asset name does not match', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/releases': releasesResponse([release('v1.0.0', 'wrong.zip')])
    });
    const r = new GitHubBundleResolver({ repoSlug: 'o/r', http, tokens: NULL_TOKEN_PROVIDER });
    assert.strictEqual(await r.resolve({ bundleId: 'foo' }), null);
  });

  // I-003: asset-name fallback chain
  it('falls back to <bundleId>.bundle.zip when bundle.zip is absent', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/releases': releasesResponse([
        release('v1.0.0', 'foo.bundle.zip')
      ])
    });
    const r = new GitHubBundleResolver({ repoSlug: 'o/r', http, tokens: NULL_TOKEN_PROVIDER });
    const got = await r.resolve({ bundleId: 'foo' });
    assert.ok(got);
    assert.strictEqual(got.ref.bundleVersion, '1.0.0');
  });

  it('falls back to *.bundle.zip when no exact match', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/releases': releasesResponse([
        release('v1.0.0', 'unrelated-name.bundle.zip')
      ])
    });
    const r = new GitHubBundleResolver({ repoSlug: 'o/r', http, tokens: NULL_TOKEN_PROVIDER });
    const got = await r.resolve({ bundleId: 'foo' });
    assert.ok(got);
  });

  // I-004: tag-extraction handles prefixed tags
  it('matches the Amadeus convention <id>-vX.Y.Z for explicit version', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/releases': releasesResponse([
        release('dsre-git-skillset-v0.1.0', 'dsre-git-skillset.bundle.zip')
      ])
    });
    const r = new GitHubBundleResolver({ repoSlug: 'o/r', http, tokens: NULL_TOKEN_PROVIDER });
    const got = await r.resolve({ bundleId: 'dsre', bundleVersion: '0.1.0' });
    assert.ok(got);
    assert.strictEqual(got.ref.bundleVersion, '0.1.0');
  });

  it('extracts bare semver from prefixed latest tag', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/releases': releasesResponse([
        release('my-bundle-v2.3.4', 'my-bundle.bundle.zip')
      ])
    });
    const r = new GitHubBundleResolver({ repoSlug: 'o/r', http, tokens: NULL_TOKEN_PROVIDER });
    const got = await r.resolve({ bundleId: 'my-bundle' });
    assert.ok(got);
    assert.strictEqual(got.ref.bundleVersion, '2.3.4');
  });

  it('returns null on 404 from the releases endpoint', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/releases': {
        statusCode: 404,
        body: new TextEncoder().encode('not found'),
        finalUrl: 'x',
        headers: {}
      }
    });
    const r = new GitHubBundleResolver({ repoSlug: 'o/r', http, tokens: NULL_TOKEN_PROVIDER });
    assert.strictEqual(await r.resolve({ bundleId: 'foo' }), null);
  });

  it('throws on a 5xx', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/releases': {
        statusCode: 500, body: new TextEncoder().encode('boom'), finalUrl: 'x', headers: {}
      }
    });
    const r = new GitHubBundleResolver({ repoSlug: 'o/r', http, tokens: NULL_TOKEN_PROVIDER });
    await assert.rejects(() => r.resolve({ bundleId: 'foo' }), /500/);
  });

  it('sends the Authorization header when the TokenProvider has a token', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/releases': releasesResponse([release('v1.0.0')])
    });
    const tokens = envTokenProvider({ GITHUB_TOKEN: 'tk' });
    const r = new GitHubBundleResolver({ repoSlug: 'o/r', http, tokens });
    await r.resolve({ bundleId: 'foo' });
    const seen = http.seen.at(-1);
    assert.strictEqual(seen?.headers?.Authorization, 'Bearer tk');
  });

  it('returns Installable.ref.sourceId in stable github-<12hex> form', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/releases': releasesResponse([release('v1.0.0')])
    });
    const r = new GitHubBundleResolver({ repoSlug: 'o/r', http, tokens: NULL_TOKEN_PROVIDER });
    const got = await r.resolve({ bundleId: 'foo' });
    assert.ok(got);
    assert.strictEqual(
      got.ref.sourceId,
      generateSourceId('github', 'https://github.com/o/r')
    );
  });

  it('caches the releases call across resolves', async () => {
    const http = new RecordingHttpClient({
      'GET https://api.github.com/repos/o/r/releases': releasesResponse([release('v1.0.0')])
    });
    const r = new GitHubBundleResolver({ repoSlug: 'o/r', http, tokens: NULL_TOKEN_PROVIDER });
    await r.resolve({ bundleId: 'foo' });
    await r.resolve({ bundleId: 'bar' });
    assert.strictEqual(http.seen.length, 1);
  });
});

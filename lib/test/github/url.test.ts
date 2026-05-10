/**
 * Tests for `lib/src/github/url.ts` — pure URL builders.
 *
 * Covers the lessons from I-011 (prefer API URL for private release
 * assets) and the host predicates used by the token provider.
 */
import {
  strict as assert,
} from 'node:assert';
import {
  describe,
  it,
} from 'mocha';
import {
  buildApiUrl,
  buildRawContentUrl,
  buildReleaseAssetApiUrl,
  isGitHubHost,
  parseRepoSlug,
} from '../../src/github/url';

describe('github/url', () => {
  describe('buildApiUrl', () => {
    it('joins a path on the default api host', () => {
      assert.equal(
        buildApiUrl('/repos/foo/bar/releases'),
        'https://api.github.com/repos/foo/bar/releases'
      );
    });
    it('rejects a path missing leading slash', () => {
      assert.throws(() => buildApiUrl('repos/foo'), /leading slash/i);
    });
    it('rejects an absolute URL (caller passed wrong helper)', () => {
      assert.throws(() => buildApiUrl('https://api.github.com/x'), /absolute/i);
    });
    it('honours an explicit base override (GHE)', () => {
      assert.equal(
        buildApiUrl('/repos/foo/bar', { base: 'https://ghe.example.com/api/v3' }),
        'https://ghe.example.com/api/v3/repos/foo/bar'
      );
    });
  });

  describe('buildRawContentUrl', () => {
    it('builds a raw.githubusercontent URL', () => {
      assert.equal(
        buildRawContentUrl({ owner: 'github', repo: 'awesome-copilot', ref: 'main', path: 'collections/foo.yml' }),
        'https://raw.githubusercontent.com/github/awesome-copilot/main/collections/foo.yml'
      );
    });
    it('strips a leading slash from path', () => {
      assert.equal(
        buildRawContentUrl({ owner: 'a', repo: 'b', ref: 'm', path: '/p/q.md' }),
        'https://raw.githubusercontent.com/a/b/m/p/q.md'
      );
    });
    it('url-encodes ref containing slashes (e.g. release branch)', () => {
      assert.equal(
        buildRawContentUrl({ owner: 'a', repo: 'b', ref: 'feature/x', path: 'p.md' }),
        'https://raw.githubusercontent.com/a/b/feature%2Fx/p.md'
      );
    });
  });

  describe('buildReleaseAssetApiUrl', () => {
    // I-011: this is the URL form that works for private repos with a
    // Bearer token. The user-facing github.com browser_download_url
    // returns 404 for private assets even with auth.
    it('returns the api.github.com asset URL', () => {
      assert.equal(
        buildReleaseAssetApiUrl({ owner: 'a', repo: 'b', assetId: 12_345 }),
        'https://api.github.com/repos/a/b/releases/assets/12345'
      );
    });
  });

  describe('isGitHubHost', () => {
    const cases: [string, boolean][] = [
      ['github.com', true],
      ['api.github.com', true],
      ['raw.githubusercontent.com', true],
      ['objects.githubusercontent.com', true],
      ['codeload.github.com', true],
      ['gist.github.com', true],
      ['ghe.example.com', false],
      ['evil.com', false],
      ['', false],
      ['githubusercontent.com', false], // bare suffix without subdomain — not real
      ['fakegithub.com', false]
    ];
    for (const [host, expected] of cases) {
      it(`${host} -> ${String(expected)}`, () => {
        assert.equal(isGitHubHost(host), expected);
      });
    }
  });

  describe('parseRepoSlug', () => {
    it('parses owner/repo', () => {
      assert.deepEqual(parseRepoSlug('github/awesome-copilot'), { owner: 'github', repo: 'awesome-copilot' });
    });
    it('strips https://github.com/ prefix', () => {
      assert.deepEqual(parseRepoSlug('https://github.com/foo/bar'), { owner: 'foo', repo: 'bar' });
    });
    it('strips trailing .git', () => {
      assert.deepEqual(parseRepoSlug('foo/bar.git'), { owner: 'foo', repo: 'bar' });
    });
    it('strips trailing slash', () => {
      assert.deepEqual(parseRepoSlug('foo/bar/'), { owner: 'foo', repo: 'bar' });
    });
    it('rejects malformed input', () => {
      assert.throws(() => parseRepoSlug('not-a-slug'), /malformed/i);
      assert.throws(() => parseRepoSlug(''), /malformed/i);
      assert.throws(() => parseRepoSlug('foo'), /malformed/i);
    });
  });
});

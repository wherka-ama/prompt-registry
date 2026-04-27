/**
 * Phase 5 spillover / Iter 10 — sourceId helper tests.
 *
 * Pins parity with the VS Code extension's `generateHubSourceId` so
 * that the two lockfile writers stay interchangeable. Reference vectors
 * are derived from running the extension's algorithm on the same
 * inputs (sha256 truncated to 12 hex chars).
 */
import * as assert from 'node:assert';
import {
  createHash,
} from 'node:crypto';
import {
  generateHubKey,
  generateSourceId,
  normalizeUrl,
} from '../../src/install/source-id';

const expectedHash = (parts: string): string =>
  createHash('sha256').update(parts).digest('hex').substring(0, 12);

describe('Phase 5 spillover / iter 10 - sourceId helper', () => {
  describe('normalizeUrl', () => {
    it('lowercases host and path; strips protocol and trailing slash', () => {
      assert.strictEqual(
        normalizeUrl('HTTPS://GitHub.com/Owner/Repo/'),
        'github.com/owner/repo'
      );
    });

    it('handles invalid URLs via the regex fallback', () => {
      assert.strictEqual(normalizeUrl('not a url'), 'not a url');
    });
  });

  describe('generateSourceId', () => {
    it('matches the extension\'s algorithm for a github source', () => {
      const id = generateSourceId('github', 'https://github.com/owner/repo');
      const want = `github-${expectedHash('github:github.com/owner/repo:main:collections')}`;
      assert.strictEqual(id, want);
    });

    it('canonicalizes \'master\' to \'main\'', () => {
      const a = generateSourceId('github', 'https://github.com/owner/repo', { branch: 'master' });
      const b = generateSourceId('github', 'https://github.com/owner/repo');
      assert.strictEqual(a, b);
    });

    it('changes id when branch differs (non-main)', () => {
      const a = generateSourceId('github', 'https://github.com/o/r');
      const b = generateSourceId('github', 'https://github.com/o/r', { branch: 'develop' });
      assert.notStrictEqual(a, b);
    });

    it('changes id when collectionsPath differs', () => {
      const a = generateSourceId('github', 'https://github.com/o/r');
      const b = generateSourceId('github', 'https://github.com/o/r', { collectionsPath: 'custom' });
      assert.notStrictEqual(a, b);
    });

    it('case-insensitive URL produces the same id', () => {
      const a = generateSourceId('github', 'https://github.com/owner/repo');
      const b = generateSourceId('github', 'HTTPS://GitHub.com/OWNER/REPO/');
      assert.strictEqual(a, b);
    });
  });

  describe('generateHubKey', () => {
    it('omits branch suffix for main/master', () => {
      const want = expectedHash('github.com/owner/repo');
      assert.strictEqual(generateHubKey('https://github.com/owner/repo'), want);
      assert.strictEqual(generateHubKey('https://github.com/owner/repo', 'master'), want);
    });

    it('appends branch suffix for non-main branches', () => {
      const root = expectedHash('github.com/owner/repo');
      assert.strictEqual(
        generateHubKey('https://github.com/owner/repo', 'develop'),
        `${root}-develop`
      );
    });
  });
});

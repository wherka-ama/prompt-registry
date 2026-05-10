import {
  createHash,
} from 'node:crypto';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  generateHubKey,
  generateSourceId,
  normalizeUrl,
} from '../src/install/source-id';

const expectedHash = (parts: string): string =>
  createHash('sha256').update(parts).digest('hex').substring(0, 12);

describe('sourceId helper', () => {
  describe('normalizeUrl', () => {
    it('lowercases host and path; strips protocol and trailing slash', () => {
      expect(
        normalizeUrl('HTTPS://GitHub.com/Owner/Repo/')
      ).toBe('github.com/owner/repo');
    });

    it('handles invalid URLs via the regex fallback', () => {
      expect(normalizeUrl('not a url')).toBe('not a url');
    });
  });

  describe('generateSourceId', () => {
    it('matches the extension\'s algorithm for a github source', () => {
      const id = generateSourceId('github', 'https://github.com/owner/repo');
      const want = `github-${expectedHash('github:github.com/owner/repo:main:collections')}`;
      expect(id).toBe(want);
    });

    it('canonicalizes \'master\' to \'main\'', () => {
      const a = generateSourceId('github', 'https://github.com/owner/repo', { branch: 'master' });
      const b = generateSourceId('github', 'https://github.com/owner/repo');
      expect(a).toBe(b);
    });

    it('changes id when branch differs (non-main)', () => {
      const a = generateSourceId('github', 'https://github.com/o/r');
      const b = generateSourceId('github', 'https://github.com/o/r', { branch: 'develop' });
      expect(a).not.toBe(b);
    });

    it('changes id when collectionsPath differs', () => {
      const a = generateSourceId('github', 'https://github.com/o/r');
      const b = generateSourceId('github', 'https://github.com/o/r', { collectionsPath: 'custom' });
      expect(a).not.toBe(b);
    });

    it('case-insensitive URL produces the same id', () => {
      const a = generateSourceId('github', 'https://github.com/owner/repo');
      const b = generateSourceId('github', 'HTTPS://GitHub.com/OWNER/REPO/');
      expect(a).toBe(b);
    });
  });

  describe('generateHubKey', () => {
    it('omits branch suffix for main/master', () => {
      const want = expectedHash('github.com/owner/repo');
      expect(generateHubKey('https://github.com/owner/repo')).toBe(want);
      expect(generateHubKey('https://github.com/owner/repo', 'master')).toBe(want);
    });

    it('appends branch suffix for non-main branches', () => {
      const root = expectedHash('github.com/owner/repo');
      expect(
        generateHubKey('https://github.com/owner/repo', 'develop')
      ).toBe(`${root}-develop`);
    });
  });
});

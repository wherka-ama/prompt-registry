import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  redactToken,
  resolveGithubToken,
  type TokenResolver,
} from '../src/infra/harvest/token-provider';

describe('token-provider', () => {
  describe('redactToken', () => {
    it('returns ***<missing> for undefined', () => {
      expect(redactToken(undefined)).toBe('***<missing>');
    });

    it('returns ***<empty> for empty string', () => {
      expect(redactToken('')).toBe('***<empty>');
    });

    it('redacts token with length and tail', () => {
      expect(redactToken('ghp_1234567890abcdef')).toBe('***<len=20,tail=cdef>');
    });

    it('handles short tokens', () => {
      expect(redactToken('abc')).toBe('***<len=3,tail=abc>');
    });

    it('handles tokens with 4 characters', () => {
      expect(redactToken('abcd')).toBe('***<len=4,tail=abcd>');
    });
  });

  describe('resolveGithubToken', () => {
    it('returns explicit token when provided', async () => {
      const mockResolver: TokenResolver = {
        readEnv: () => undefined,
        readGhCli: async () => undefined,
      };
      const result = await resolveGithubToken({ explicit: 'explicit-token' }, mockResolver);
      expect(result).toEqual({ token: 'explicit-token', source: 'explicit' });
    });

    it('skips empty explicit token', async () => {
      const mockResolver: TokenResolver = {
        readEnv: () => 'env-token',
        readGhCli: async () => undefined,
      };
      const result = await resolveGithubToken({ explicit: '' }, mockResolver);
      expect(result).toEqual({ token: 'env-token', source: 'env:GITHUB_TOKEN' });
    });

    it('returns GITHUB_TOKEN from env', async () => {
      const mockResolver: TokenResolver = {
        readEnv: (name) => name === 'GITHUB_TOKEN' ? 'gh-token' : undefined,
        readGhCli: async () => undefined,
      };
      const result = await resolveGithubToken({}, mockResolver);
      expect(result).toEqual({ token: 'gh-token', source: 'env:GITHUB_TOKEN' });
    });

    it('returns GH_TOKEN from env', async () => {
      const mockResolver: TokenResolver = {
        readEnv: (name) => name === 'GH_TOKEN' ? 'gh-cli-token' : undefined,
        readGhCli: async () => undefined,
      };
      const result = await resolveGithubToken({}, mockResolver);
      expect(result).toEqual({ token: 'gh-cli-token', source: 'env:GH_TOKEN' });
    });

    it('prefers GITHUB_TOKEN over GH_TOKEN', async () => {
      const mockResolver: TokenResolver = {
        readEnv: (name) => {
          if (name === 'GITHUB_TOKEN') return 'gh-token';
          if (name === 'GH_TOKEN') return 'gh-cli-token';
          return undefined;
        },
        readGhCli: async () => undefined,
      };
      const result = await resolveGithubToken({}, mockResolver);
      expect(result).toEqual({ token: 'gh-token', source: 'env:GITHUB_TOKEN' });
    });

    it('returns gh-cli token when env vars not set', async () => {
      const mockResolver: TokenResolver = {
        readEnv: () => undefined,
        readGhCli: async () => 'cli-token',
      };
      const result = await resolveGithubToken({}, mockResolver);
      expect(result).toEqual({ token: 'cli-token', source: 'gh-cli' });
    });

    it('returns none when no token available', async () => {
      const mockResolver: TokenResolver = {
        readEnv: () => undefined,
        readGhCli: async () => undefined,
      };
      const result = await resolveGithubToken({}, mockResolver);
      expect(result).toEqual({ token: undefined, source: 'none' });
    });

    it('uses default resolver when none provided', async () => {
      const result = await resolveGithubToken({});
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('token');
    });
  });
});

/**
 * Tests for `lib/src/github/token.ts` — TokenProvider surface.
 *
 * Drives every branch of the host predicate, the env-var lookup, the
 * gh-CLI fallback (with a mocked spawn), and the composite chain.
 */
import {
  strict as assert,
} from 'node:assert';
import {
  describe,
  it,
} from 'mocha';
import {
  compositeTokenProvider,
  envTokenProvider,
  ghCliTokenProvider,
  NULL_TOKEN_PROVIDER,
  staticTokenProvider,
  type TokenProvider,
} from '../../src/github/token';

describe('github/token', () => {
  describe('NULL_TOKEN_PROVIDER', () => {
    it('always returns null', async () => {
      assert.equal(await NULL_TOKEN_PROVIDER.getToken('github.com'), null);
      assert.equal(await NULL_TOKEN_PROVIDER.getToken('api.github.com'), null);
    });
  });

  describe('staticTokenProvider', () => {
    it('returns the token for github hosts', async () => {
      const p = staticTokenProvider('xoxo');
      assert.equal(await p.getToken('github.com'), 'xoxo');
      assert.equal(await p.getToken('api.github.com'), 'xoxo');
      assert.equal(await p.getToken('raw.githubusercontent.com'), 'xoxo');
    });
    it('returns null for non-github hosts', async () => {
      const p = staticTokenProvider('xoxo');
      assert.equal(await p.getToken('evil.com'), null);
      assert.equal(await p.getToken('ghe.example.com'), null);
    });
    it('returns null when token is empty', async () => {
      const p = staticTokenProvider('');
      assert.equal(await p.getToken('github.com'), null);
    });
  });

  describe('envTokenProvider', () => {
    it('reads GITHUB_TOKEN', async () => {
      const p = envTokenProvider({ GITHUB_TOKEN: 'g1', PROMPT_REGISTRY_DISABLE_GH_CLI: '1' });
      assert.equal(await p.getToken('api.github.com'), 'g1');
    });
    it('falls back to GH_TOKEN', async () => {
      const p = envTokenProvider({ GH_TOKEN: 'g2', PROMPT_REGISTRY_DISABLE_GH_CLI: '1' });
      assert.equal(await p.getToken('api.github.com'), 'g2');
    });
    it('prefers GITHUB_TOKEN over GH_TOKEN', async () => {
      const p = envTokenProvider({ GITHUB_TOKEN: 'g1', GH_TOKEN: 'g2', PROMPT_REGISTRY_DISABLE_GH_CLI: '1' });
      assert.equal(await p.getToken('api.github.com'), 'g1');
    });
    it('returns null on non-github hosts even with token', async () => {
      const p = envTokenProvider({ GITHUB_TOKEN: 'g1', PROMPT_REGISTRY_DISABLE_GH_CLI: '1' });
      assert.equal(await p.getToken('evil.com'), null);
    });
    it('returns null when env empty', async () => {
      const p = envTokenProvider({ PROMPT_REGISTRY_DISABLE_GH_CLI: '1' });
      assert.equal(await p.getToken('github.com'), null);
    });
  });

  describe('ghCliTokenProvider', () => {
    // Real spawnSync is hard to mock; test the fallback path via the
    // composite. Here just verify that on non-github host it short-
    // circuits without spawning anything.
    it('returns null for non-github host without spawning', async () => {
      let spawned = false;
      const p = ghCliTokenProvider({
        spawn: () => {
          spawned = true;
          return { status: 1, stdout: '', stderr: '' };
        }
      });
      assert.equal(await p.getToken('evil.com'), null);
      assert.equal(spawned, false);
    });
    it('parses gh stdout when status=0', async () => {
      const p = ghCliTokenProvider({
        spawn: () => ({ status: 0, stdout: 'ghp_fake_token\n', stderr: '' })
      });
      assert.equal(await p.getToken('github.com'), 'ghp_fake_token');
    });
    it('returns null on non-zero exit', async () => {
      const p = ghCliTokenProvider({
        spawn: () => ({ status: 1, stdout: '', stderr: 'not logged in' })
      });
      assert.equal(await p.getToken('github.com'), null);
    });
    it('returns null when stdout is empty after trim', async () => {
      const p = ghCliTokenProvider({
        spawn: () => ({ status: 0, stdout: '   \n  ', stderr: '' })
      });
      assert.equal(await p.getToken('github.com'), null);
    });
    it('swallows spawn exceptions and returns null', async () => {
      const p = ghCliTokenProvider({
        spawn: () => {
          throw new Error('ENOENT');
        }
      });
      assert.equal(await p.getToken('github.com'), null);
    });
  });

  describe('compositeTokenProvider', () => {
    const yes = (tok: string): TokenProvider => ({
      getToken: () => Promise.resolve(tok)
    });
    const no: TokenProvider = { getToken: () => Promise.resolve(null) };

    it('returns the first non-null token in order', async () => {
      const p = compositeTokenProvider(no, yes('first'), yes('second'));
      assert.equal(await p.getToken('github.com'), 'first');
    });
    it('returns null when all return null', async () => {
      const p = compositeTokenProvider(no, no);
      assert.equal(await p.getToken('github.com'), null);
    });
    it('handles empty list', async () => {
      const p = compositeTokenProvider();
      assert.equal(await p.getToken('github.com'), null);
    });
    it('treats empty-string token as null and continues', async () => {
      const p = compositeTokenProvider(yes(''), yes('real'));
      assert.equal(await p.getToken('github.com'), 'real');
    });
  });
});

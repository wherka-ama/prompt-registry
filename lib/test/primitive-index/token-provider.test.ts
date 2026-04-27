/**
 * Tests for the GitHub token resolution chain used by the hub harvester.
 *
 * Resolution order (first non-empty wins):
 *   1. explicit token argument (e.g. VS Code context forwards one)
 *   2. env GITHUB_TOKEN
 *   3. env GH_TOKEN
 *   4. `gh auth token` (only when a `gh` binary is on PATH and authenticated)
 *
 * The token string is never logged — only its length + last-4 chars
 * (redaction helper is exported and covered by tests).
 */
import * as assert from 'node:assert';
import {
  redactToken,
  resolveGithubToken,
  type TokenResolver,
} from '../../src/primitive-index/hub/token-provider';

describe('primitive-index / token-provider', () => {
  it('prefers an explicit token over env + gh CLI', async () => {
    const resolver: TokenResolver = {
      readEnv: (_k) => 'env-token',
      readGhCli: async () => 'gh-token'
    };
    const r = await resolveGithubToken({ explicit: 'explicit-token' }, resolver);
    assert.strictEqual(r.token, 'explicit-token');
    assert.strictEqual(r.source, 'explicit');
  });

  it('falls through to GITHUB_TOKEN then GH_TOKEN then gh CLI', async () => {
    const r1 = await resolveGithubToken({}, {
      readEnv: (k) => (k === 'GITHUB_TOKEN' ? 'gh-a' : undefined),
      readGhCli: async () => 'gh-b'
    });
    assert.deepStrictEqual([r1.token, r1.source], ['gh-a', 'env:GITHUB_TOKEN']);

    const r2 = await resolveGithubToken({}, {
      readEnv: (k) => (k === 'GH_TOKEN' ? 'gh-c' : undefined),
      readGhCli: async () => 'gh-d'
    });
    assert.deepStrictEqual([r2.token, r2.source], ['gh-c', 'env:GH_TOKEN']);

    const r3 = await resolveGithubToken({}, {
      readEnv: () => undefined,
      readGhCli: async () => 'gh-e'
    });
    assert.deepStrictEqual([r3.token, r3.source], ['gh-e', 'gh-cli']);
  });

  it('returns undefined + source=none when every stage is empty', async () => {
    const r = await resolveGithubToken({}, {
      readEnv: () => undefined,
      readGhCli: async () => undefined
    });
    assert.strictEqual(r.token, undefined);
    assert.strictEqual(r.source, 'none');
  });

  it('does not call gh CLI when an earlier stage yielded a token', async () => {
    let ghCalled = 0;
    await resolveGithubToken({ explicit: 'x' }, {
      readEnv: () => undefined,
      readGhCli: async () => {
        ghCalled += 1;
        return 'y';
      }
    });
    assert.strictEqual(ghCalled, 0);
  });

  it('redactToken shows length + last four chars, preserving secrecy', () => {
    assert.strictEqual(redactToken('ghp_abcdefghij'), '***<len=14,tail=ghij>');
    assert.strictEqual(redactToken(''), '***<empty>');
    assert.strictEqual(redactToken(undefined), '***<missing>');
  });
});

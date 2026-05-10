/**
 * Phase 1 / Step 1.5 — SourceDispatcher tests.
 *
 * TDD tests for source dispatch covering:
 * - github source returns GitHubBundleResolver
 * - awesome-copilot source returns AwesomeCopilotBundleResolver
 * - skills source returns SkillsBundleResolver
 * - local-skills source returns LocalSkillsBundleResolver
 * - local-awesome-copilot source returns LocalAwesomeCopilotBundleResolver
 * - local source returns null (no resolver)
 * - isRemote correctly identifies remote vs local sources
 */

import assert from 'node:assert';
import {
  describe,
  it,
} from 'node:test';
import {
  AwesomeCopilotBundleResolver,
} from '../src/install/awesome-copilot-resolver';
import {
  GitHubBundleResolver,
} from '../src/install/github-resolver';
import {
  LocalAwesomeCopilotBundleResolver,
  LocalSkillsBundleResolver,
  SkillsBundleResolver,
} from '../src/install/skills-resolver';
import {
  SourceDispatcher,
} from '../src/install/source-dispatcher';

// eslint-disable-next-line @typescript-eslint/no-floating-promises -- describe doesn't return a promise
describe('SourceDispatcher', () => {
  /**
   * Mock HTTP client for testing.
   */
  const mockHttp = {
    fetch: () => Promise.resolve({ statusCode: 200, headers: {}, body: '', finalUrl: '' }),
    get: () => Promise.resolve({ status: 200, headers: {}, body: '' })
  } as any;

  /**
   * Mock token provider for testing.
   */
  const mockTokens = {
    getToken: () => Promise.resolve(null)
  } as any;

  /**
   * Mock FS abstraction for testing.
   */
  const mockFs = {
    readFile: () => Promise.resolve(''),
    writeFile: () => Promise.resolve(),
    readJson: <T = unknown>() => Promise.resolve({} as T),
    writeJson: () => Promise.resolve(),
    exists: () => Promise.resolve(false),
    mkdir: () => Promise.resolve(),
    readDir: () => Promise.resolve([]),
    remove: () => Promise.resolve()
  };

  const createDispatcher = (): SourceDispatcher => {
    return new SourceDispatcher({
      http: mockHttp,
      tokens: mockTokens,
      fs: mockFs
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('returns GitHubBundleResolver for github source', () => {
    const dispatcher = createDispatcher();
    const source = { type: 'github', url: 'https://github.com/owner/repo' };
    const resolver = dispatcher.resolverFor(source as any);
    assert.ok(resolver instanceof GitHubBundleResolver);
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('returns AwesomeCopilotBundleResolver for awesome-copilot source', () => {
    const dispatcher = createDispatcher();
    const source = { type: 'awesome-copilot', url: 'https://github.com/owner/repo', config: { branch: 'main' } };
    const resolver = dispatcher.resolverFor(source as any);
    assert.ok(resolver instanceof AwesomeCopilotBundleResolver);
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('returns SkillsBundleResolver for skills source', () => {
    const dispatcher = createDispatcher();
    const source = { type: 'skills', url: 'https://github.com/owner/repo', ref: 'main' };
    const resolver = dispatcher.resolverFor(source as any);
    assert.ok(resolver instanceof SkillsBundleResolver);
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('returns LocalSkillsBundleResolver for local-skills source', () => {
    const dispatcher = createDispatcher();
    const source = { type: 'local-skills', url: '/path/to/skills' };
    const resolver = dispatcher.resolverFor(source as any);
    assert.ok(resolver instanceof LocalSkillsBundleResolver);
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('returns LocalAwesomeCopilotBundleResolver for local-awesome-copilot source', () => {
    const dispatcher = createDispatcher();
    const source = { type: 'local-awesome-copilot', url: '/path/to/collections', config: { collectionsPath: 'collections' } };
    const resolver = dispatcher.resolverFor(source as any);
    assert.ok(resolver instanceof LocalAwesomeCopilotBundleResolver);
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('returns null for local source', () => {
    const dispatcher = createDispatcher();
    const source = { type: 'local', url: '/path/to/bundle' };
    const resolver = dispatcher.resolverFor(source as any);
    assert.strictEqual(resolver, null);
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('returns null for unsupported source type', () => {
    const dispatcher = createDispatcher();
    const source = { type: 'unsupported', url: 'https://example.com' };
    const resolver = dispatcher.resolverFor(source as any);
    assert.strictEqual(resolver, null);
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('isRemote returns true for remote source types', () => {
    const dispatcher = createDispatcher();
    assert.strictEqual(dispatcher.isRemote('github'), true);
    assert.strictEqual(dispatcher.isRemote('awesome-copilot'), true);
    assert.strictEqual(dispatcher.isRemote('skills'), true);
    assert.strictEqual(dispatcher.isRemote('apm'), true);
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('isRemote returns false for local source types', () => {
    const dispatcher = createDispatcher();
    assert.strictEqual(dispatcher.isRemote('local'), false);
    assert.strictEqual(dispatcher.isRemote('local-skills'), false);
    assert.strictEqual(dispatcher.isRemote('local-awesome-copilot'), false);
  });
});

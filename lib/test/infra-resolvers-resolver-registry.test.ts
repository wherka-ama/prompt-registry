import {
  describe,
  expect,
  it,
} from 'vitest';
import type {
  RegistrySource,
} from '../src/domain/registry';
import {
  SourceDispatcher,
} from '../src/infra/resolvers/resolver-registry';
import {
  createTestContext,
} from '../src/cli/framework';

const mockHttpClient = {
  fetch: async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => '',
    json: async () => ({}),
  }),
};

const mockTokenProvider = {
  getToken: async () => 'token',
};

describe('SourceDispatcher', () => {
  it('returns GitHubBundleResolver for github sources', () => {
    const ctx = createTestContext();
    const dispatcher = new SourceDispatcher({
      http: mockHttpClient as any,
      tokens: mockTokenProvider,
      fs: ctx.fs
    });
    
    const source: RegistrySource = {
      id: 'github-001',
      name: 'GitHub Source',
      type: 'github',
      url: 'https://github.com/owner/repo',
      enabled: true,
      priority: 1,
      hubId: 'default-local'
    };
    
    const resolver = dispatcher.resolverFor(source);
    expect(resolver).not.toBeNull();
    expect(resolver?.constructor.name).toBe('GitHubBundleResolver');
  });

  it('returns AwesomeCopilotBundleResolver for awesome-copilot sources', () => {
    const ctx = createTestContext();
    const dispatcher = new SourceDispatcher({
      http: mockHttpClient as any,
      tokens: mockTokenProvider,
      fs: ctx.fs
    });
    
    const source: RegistrySource = {
      id: 'ac-001',
      name: 'Awesome Copilot Source',
      type: 'awesome-copilot',
      url: 'https://github.com/owner/repo',
      enabled: true,
      priority: 1,
      hubId: 'default-local',
      config: { branch: 'main', collectionsPath: 'collections' }
    };
    
    const resolver = dispatcher.resolverFor(source);
    expect(resolver).not.toBeNull();
    expect(resolver?.constructor.name).toBe('AwesomeCopilotBundleResolver');
  });

  it('returns SkillsBundleResolver for skills sources', () => {
    const ctx = createTestContext();
    const dispatcher = new SourceDispatcher({
      http: mockHttpClient as any,
      tokens: mockTokenProvider,
      fs: ctx.fs
    });
    
    const source: RegistrySource = {
      id: 'skills-001',
      name: 'Skills Source',
      type: 'skills',
      url: 'https://github.com/owner/repo',
      enabled: true,
      priority: 1,
      hubId: 'default-local',
      config: { ref: 'main' }
    };
    
    const resolver = dispatcher.resolverFor(source);
    expect(resolver).not.toBeNull();
    expect(resolver?.constructor.name).toBe('SkillsBundleResolver');
  });

  it('returns LocalSkillsBundleResolver for local-skills sources', () => {
    const ctx = createTestContext();
    const dispatcher = new SourceDispatcher({
      http: mockHttpClient as any,
      tokens: mockTokenProvider,
      fs: ctx.fs
    });
    
    const source: RegistrySource = {
      id: 'local-skills-001',
      name: 'Local Skills Source',
      type: 'local-skills',
      url: '/path/to/skills',
      enabled: true,
      priority: 1,
      hubId: 'default-local'
    };
    
    const resolver = dispatcher.resolverFor(source);
    expect(resolver).not.toBeNull();
    expect(resolver?.constructor.name).toBe('LocalSkillsBundleResolver');
  });

  it('returns LocalAwesomeCopilotBundleResolver for local-awesome-copilot sources', () => {
    const ctx = createTestContext();
    const dispatcher = new SourceDispatcher({
      http: mockHttpClient as any,
      tokens: mockTokenProvider,
      fs: ctx.fs
    });
    
    const source: RegistrySource = {
      id: 'local-ac-001',
      name: 'Local AC Source',
      type: 'local-awesome-copilot',
      url: '/path/to/collections',
      enabled: true,
      priority: 1,
      hubId: 'default-local',
      config: { collectionsPath: 'collections' }
    };
    
    const resolver = dispatcher.resolverFor(source);
    expect(resolver).not.toBeNull();
    expect(resolver?.constructor.name).toBe('LocalAwesomeCopilotBundleResolver');
  });

  it('returns null for local sources', () => {
    const ctx = createTestContext();
    const dispatcher = new SourceDispatcher({
      http: mockHttpClient as any,
      tokens: mockTokenProvider,
      fs: ctx.fs
    });
    
    const source: RegistrySource = {
      id: 'local-001',
      name: 'Local Source',
      type: 'local',
      url: '/path/to/local',
      enabled: true,
      priority: 1,
      hubId: 'default-local'
    };
    
    const resolver = dispatcher.resolverFor(source);
    expect(resolver).toBeNull();
  });

  it('returns null for unknown source types', () => {
    const ctx = createTestContext();
    const dispatcher = new SourceDispatcher({
      http: mockHttpClient as any,
      tokens: mockTokenProvider,
      fs: ctx.fs
    });
    
    const source: RegistrySource = {
      id: 'unknown-001',
      name: 'Unknown Source',
      type: 'unknown' as any,
      url: 'https://example.com',
      enabled: true,
      priority: 1,
      hubId: 'default-local'
    };
    
    const resolver = dispatcher.resolverFor(source);
    expect(resolver).toBeNull();
  });

  it('strips GitHub URL prefix and .git suffix', () => {
    const ctx = createTestContext();
    const dispatcher = new SourceDispatcher({
      http: mockHttpClient as any,
      tokens: mockTokenProvider,
      fs: ctx.fs
    });
    
    const source: RegistrySource = {
      id: 'github-git-001',
      name: 'GitHub Git Source',
      type: 'github',
      url: 'https://github.com/owner/repo.git',
      enabled: true,
      priority: 1,
      hubId: 'default-local'
    };
    
    const resolver = dispatcher.resolverFor(source);
    expect(resolver).not.toBeNull();
  });

  it('identifies remote source types correctly', () => {
    const ctx = createTestContext();
    const dispatcher = new SourceDispatcher({
      http: mockHttpClient as any,
      tokens: mockTokenProvider,
      fs: ctx.fs
    });
    
    expect(dispatcher.isRemote('github')).toBe(true);
    expect(dispatcher.isRemote('awesome-copilot')).toBe(true);
    expect(dispatcher.isRemote('skills')).toBe(true);
    expect(dispatcher.isRemote('apm')).toBe(true);
    expect(dispatcher.isRemote('local')).toBe(false);
    expect(dispatcher.isRemote('local-skills')).toBe(false);
  });
});

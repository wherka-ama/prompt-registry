/**
 * ProfileActivator tests
 */
import {
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  ProfileActivator,
} from '../src/app/registry/profile-activator';
import type {
  Profile,
  RegistrySource,
  Target,
} from '../src/domain';

describe('ProfileActivator', () => {
  let mockFs: any;
  let mockHttp: any;
  let mockTokens: any;
  let activator: ProfileActivator;

  beforeEach(() => {
    mockFs = {
      readFile: async () => new Uint8Array(),
      writeFile: async () => {},
      exists: async () => false,
      mkdir: async () => {},
      readdir: async () => [],
      rm: async () => {},
      stat: async () => ({ type: 'file' }),
      readJson: async () => ({}),
      writeJson: async () => {},
      readDir: async () => [],
      remove: async () => {}
    };

    mockHttp = {
      fetch: async () => ({ body: new Uint8Array(), status: 200 })
    };

    mockTokens = {
      get: () => null
    };

    activator = new ProfileActivator({
      fs: mockFs,
      env: { HOME: '/tmp/test' },
      http: mockHttp,
      tokens: mockTokens
    });
  });

  it('should construct with dependencies', () => {
    expect(activator).toBeDefined();
  });

  it('throws error when no targets provided', async () => {
    const profile: Profile = {
      id: 'test-profile',
      name: 'Test Profile',
      bundles: []
    };

    await expect(activator.activate({
      hubId: 'test-hub',
      profile,
      sources: {},
      targets: []
    })).rejects.toThrow('PROFILE.ACTIVATION_NO_TARGETS');
  });

  it('throws error when source not in hub config', async () => {
    const profile: Profile = {
      id: 'test-profile',
      name: 'Test Profile',
      bundles: [
        { id: 'bundle1', version: '1.0.0', source: 'missing-source', required: true }
      ]
    };

    const sources: Record<string, RegistrySource> = {
      'other-source': { type: 'github', url: 'https://github.com/owner/repo', id: 'other-source', name: 'Other', enabled: true, priority: 0, hubId: 'test-hub' }
    };

    const targets: Target[] = [{ name: 'vscode', type: 'vscode', scope: 'user' } as any];

    await expect(activator.activate({
      hubId: 'test-hub',
      profile,
      sources,
      targets
    })).rejects.toThrow('PROFILE.SOURCE_MISSING');
  });
});

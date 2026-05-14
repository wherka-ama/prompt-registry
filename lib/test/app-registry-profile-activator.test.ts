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
});

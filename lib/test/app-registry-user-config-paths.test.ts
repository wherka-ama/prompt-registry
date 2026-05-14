/**
 * Coverage tests for app/registry/user-config-paths.ts.
 *
 * Tests resolveUserConfigPaths function for XDG path resolution.
 */
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  resolveUserConfigPaths,
} from '../src/app/registry/user-config-paths';

describe('resolveUserConfigPaths', () => {
  it('resolves paths using XDG_CONFIG_HOME when set', () => {
    const env = { XDG_CONFIG_HOME: '/custom/config' };
    const paths = resolveUserConfigPaths(env);

    expect(paths.root).toBe('/custom/config/prompt-registry');
    expect(paths.hubs).toBe('/custom/config/prompt-registry/hubs');
    expect(paths.profileActivations).toBe('/custom/config/prompt-registry/profile-activations');
    expect(paths.activeHub).toBe('/custom/config/prompt-registry/active-hub.json');
    expect(paths.userTargets).toBe('/custom/config/prompt-registry/targets.yml');
    expect(paths.tokenCache).toBe('/custom/config/prompt-registry/token');
  });

  it('resolves paths using HOME when XDG_CONFIG_HOME is not set', () => {
    const env = { HOME: '/home/user' };
    const paths = resolveUserConfigPaths(env);

    expect(paths.root).toBe('/home/user/.config/prompt-registry');
    expect(paths.hubs).toBe('/home/user/.config/prompt-registry/hubs');
    expect(paths.profileActivations).toBe('/home/user/.config/prompt-registry/profile-activations');
    expect(paths.activeHub).toBe('/home/user/.config/prompt-registry/active-hub.json');
    expect(paths.userTargets).toBe('/home/user/.config/prompt-registry/targets.yml');
    expect(paths.tokenCache).toBe('/home/user/.config/prompt-registry/token');
  });

  it('resolves paths using USERPROFILE on Windows when HOME is not set', () => {
    const env = { USERPROFILE: 'C:\\Users\\user' };
    const paths = resolveUserConfigPaths(env);

    expect(paths.root).toBe('C:\\Users\\user/.config/prompt-registry');
    expect(paths.hubs).toBe('C:\\Users\\user/.config/prompt-registry/hubs');
    expect(paths.profileActivations).toBe('C:\\Users\\user/.config/prompt-registry/profile-activations');
    expect(paths.activeHub).toBe('C:\\Users\\user/.config/prompt-registry/active-hub.json');
    expect(paths.userTargets).toBe('C:\\Users\\user/.config/prompt-registry/targets.yml');
    expect(paths.tokenCache).toBe('C:\\Users\\user/.config/prompt-registry/token');
  });

  it('uses empty string when neither XDG_CONFIG_HOME, HOME, nor USERPROFILE are set', () => {
    const env = {};
    const paths = resolveUserConfigPaths(env);

    expect(paths.root).toBe('.config/prompt-registry');
    expect(paths.hubs).toBe('.config/prompt-registry/hubs');
    expect(paths.profileActivations).toBe('.config/prompt-registry/profile-activations');
    expect(paths.activeHub).toBe('.config/prompt-registry/active-hub.json');
    expect(paths.userTargets).toBe('.config/prompt-registry/targets.yml');
    expect(paths.tokenCache).toBe('.config/prompt-registry/token');
  });

  it('prefers XDG_CONFIG_HOME over HOME', () => {
    const env = { XDG_CONFIG_HOME: '/custom/config', HOME: '/home/user' };
    const paths = resolveUserConfigPaths(env);

    expect(paths.root).toBe('/custom/config/prompt-registry');
    expect(paths.hubs).toBe('/custom/config/prompt-registry/hubs');
  });

  it('prefers HOME over USERPROFILE', () => {
    const env = { HOME: '/home/user', USERPROFILE: 'C:\\Users\\user' };
    const paths = resolveUserConfigPaths(env);

    expect(paths.root).toBe('/home/user/.config/prompt-registry');
    expect(paths.hubs).toBe('/home/user/.config/prompt-registry/hubs');
  });

  it('treats empty XDG_CONFIG_HOME as unset', () => {
    const env = { XDG_CONFIG_HOME: '', HOME: '/home/user' };
    const paths = resolveUserConfigPaths(env);

    expect(paths.root).toBe('/home/user/.config/prompt-registry');
    expect(paths.hubs).toBe('/home/user/.config/prompt-registry/hubs');
  });

  it('returns consistent path structure', () => {
    const env = { XDG_CONFIG_HOME: '/config' };
    const paths = resolveUserConfigPaths(env);

    expect(Object.keys(paths)).toEqual([
      'root',
      'hubs',
      'profileActivations',
      'activeHub',
      'userTargets',
      'tokenCache'
    ]);
  });
});

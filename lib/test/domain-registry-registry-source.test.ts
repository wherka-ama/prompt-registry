import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  isRegistrySource,
} from '../src/domain/registry/registry-source';

describe('registry-source domain', () => {
  it('accepts a complete github source', () => {
    expect(isRegistrySource({
      id: 'github-abc',
      name: 'My Repo',
      type: 'github',
      url: 'owner/repo',
      enabled: true,
      priority: 0,
      hubId: 'my-hub'
    })).toBe(true);
  });

  it('rejects missing required fields', () => {
    const base = {
      id: 'github-abc', name: 'x', type: 'github',
      url: 'owner/repo', enabled: true, priority: 0, hubId: 'h'
    };
    for (const k of ['id', 'name', 'type', 'url', 'hubId'] as const) {
      const broken = { ...base, [k]: undefined };
      expect(isRegistrySource(broken)).toBe(false);
    }
  });

  it('rejects empty hubId', () => {
    expect(isRegistrySource({
      id: 'x', name: 'x', type: 'github', url: 'x',
      enabled: true, priority: 0, hubId: ''
    })).toBe(false);
  });

  it('rejects wrong types on numeric fields', () => {
    expect(isRegistrySource({
      id: 'x', name: 'x', type: 'github', url: 'x',
      enabled: true, priority: '0' as any, hubId: 'h'
    })).toBe(false);
  });
});

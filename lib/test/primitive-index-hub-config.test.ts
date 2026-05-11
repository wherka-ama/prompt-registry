import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  normalizeRepoFromUrl,
  parseHubConfig,
} from '../src/infra/harvest/hub-config-parser';

const SAMPLE = `
version: 1.0.0
metadata:
  name: Demo
sources:
  - id: src-gh
    name: A GH source
    type: github
    url: https://github.com/owner/repo
    enabled: true
    priority: 1
  - id: src-ac
    name: An AC source
    type: awesome-copilot
    url: https://github.com/owner/ac-repo.git
    enabled: true
    priority: 2
    config:
      branch: develop
      collectionsPath: collections
  - id: src-disabled
    name: Disabled
    type: github
    url: https://github.com/owner/dis-repo
    enabled: false
    priority: 1
`;

describe('hub-config', () => {
  it('parses YAML and keeps only enabled github / awesome-copilot sources', () => {
    const sources = parseHubConfig(SAMPLE);
    const ids = sources.map((s) => s.id);
    expect(ids).toStrictEqual(['src-gh', 'src-ac']);
  });

  it('carries branch + collectionsPath defaults', () => {
    const sources = parseHubConfig(SAMPLE);
    const gh = sources.find((s) => s.id === 'src-gh')!;
    expect(gh.branch).toBe('main');
    expect(gh.collectionsPath).toBe(undefined);
    const ac = sources.find((s) => s.id === 'src-ac')!;
    expect(ac.branch).toBe('develop');
    expect(ac.collectionsPath).toBe('collections');
  });

  it('normalizeRepoFromUrl handles plain + .git + trailing slash URLs', () => {
    expect(normalizeRepoFromUrl('https://github.com/owner/repo')).toStrictEqual({ owner: 'owner', repo: 'repo' });
    expect(normalizeRepoFromUrl('https://github.com/owner/repo.git')).toStrictEqual({ owner: 'owner', repo: 'repo' });
    expect(normalizeRepoFromUrl('https://github.com/owner/repo/')).toStrictEqual({ owner: 'owner', repo: 'repo' });
    expect(normalizeRepoFromUrl('https://example.com/owner/repo')).toBe(undefined);
    expect(normalizeRepoFromUrl('not a url')).toBe(undefined);
  });

  it('rejects sources missing a parseable GitHub url', () => {
    const yaml = `
sources:
  - id: bogus
    name: bogus
    type: github
    url: https://example.org/no-gh-here
    enabled: true
    priority: 1
`;
    const sources = parseHubConfig(yaml);
    expect(sources.length).toBe(0);
  });

  it('accepts the new awesome-copilot-plugin source type with a pluginsPath', () => {
    const yaml = `
sources:
  - id: upstream-awesome
    name: github/awesome-copilot (plugins)
    type: awesome-copilot-plugin
    url: https://github.com/github/awesome-copilot
    enabled: true
    priority: 1
    config:
      branch: main
      pluginsPath: plugins
`;
    const sources = parseHubConfig(yaml);
    expect(sources.length).toBe(1);
    const s = sources[0];
    expect(s.type).toBe('awesome-copilot-plugin');
    expect(s.owner).toBe('github');
    expect(s.repo).toBe('awesome-copilot');
    expect(s.branch).toBe('main');
    expect(s.pluginsPath).toBe('plugins');
  });

  it('defaults the awesome-copilot-plugin pluginsPath to "plugins" when omitted', () => {
    const yaml = `
sources:
  - id: ac-plugin
    name: ac-plugin
    type: awesome-copilot-plugin
    url: https://github.com/github/awesome-copilot
    enabled: true
    priority: 1
`;
    const sources = parseHubConfig(yaml);
    expect(sources.length).toBe(1);
    expect(sources[0].pluginsPath).toBe('plugins');
  });

  it('preserves unknown type-specific config under rawConfig (forward-compat)', () => {
    const yaml = `
sources:
  - id: a
    name: A
    type: github
    url: https://github.com/o/r
    enabled: true
    priority: 1
    config:
      branch: main
      futureField: 42
`;
    const sources = parseHubConfig(yaml);
    expect(sources[0].rawConfig?.futureField).toBe(42);
  });
});

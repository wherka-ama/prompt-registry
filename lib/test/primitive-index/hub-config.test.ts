/**
 * Tests for the hub-config.yml parser.
 *
 * The parser accepts either a raw YAML string or a pre-parsed object and
 * emits a normalised HubSourceSpec[] used by the harvester. It is explicitly
 * tolerant of unknown fields (so new hub-config keys don't break the
 * harvester) but strict about the ones it does consume.
 */
import * as assert from 'node:assert';
import {
  normalizeRepoFromUrl,
  parseHubConfig,
} from '../../src/primitive-index/hub/hub-config';

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

describe('primitive-index / hub-config', () => {
  it('parses YAML and keeps only enabled github / awesome-copilot sources', () => {
    const sources = parseHubConfig(SAMPLE);
    const ids = sources.map((s) => s.id);
    assert.deepStrictEqual(ids, ['src-gh', 'src-ac']);
  });

  it('carries branch + collectionsPath defaults', () => {
    const sources = parseHubConfig(SAMPLE);
    const gh = sources.find((s) => s.id === 'src-gh')!;
    assert.strictEqual(gh.branch, 'main');
    assert.strictEqual(gh.collectionsPath, undefined);
    const ac = sources.find((s) => s.id === 'src-ac')!;
    assert.strictEqual(ac.branch, 'develop');
    assert.strictEqual(ac.collectionsPath, 'collections');
  });

  it('normalizeRepoFromUrl handles plain + .git + trailing slash URLs', () => {
    assert.deepStrictEqual(normalizeRepoFromUrl('https://github.com/owner/repo'), { owner: 'owner', repo: 'repo' });
    assert.deepStrictEqual(normalizeRepoFromUrl('https://github.com/owner/repo.git'), { owner: 'owner', repo: 'repo' });
    assert.deepStrictEqual(normalizeRepoFromUrl('https://github.com/owner/repo/'), { owner: 'owner', repo: 'repo' });
    assert.strictEqual(normalizeRepoFromUrl('https://example.com/owner/repo'), undefined);
    assert.strictEqual(normalizeRepoFromUrl('not a url'), undefined);
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
    assert.strictEqual(sources.length, 0);
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
    assert.strictEqual(sources.length, 1);
    const s = sources[0];
    assert.strictEqual(s.type, 'awesome-copilot-plugin');
    assert.strictEqual(s.owner, 'github');
    assert.strictEqual(s.repo, 'awesome-copilot');
    assert.strictEqual(s.branch, 'main');
    assert.strictEqual(s.pluginsPath, 'plugins');
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
    assert.strictEqual(sources.length, 1);
    assert.strictEqual(sources[0].pluginsPath, 'plugins');
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
    assert.strictEqual(sources[0].rawConfig?.futureField, 42);
  });
});

/**
 * Tests for parseExtraSource — the CLI helper that turns one
 * --extra-source=k1=v1,k2=v2,... flag into a HubSourceSpec.
 *
 * This is the mechanism that lets the user modify the harvest flow
 * by appending a synthetic source (e.g. github/awesome-copilot's
 * plugins/ folder) on top of the fetched hub-config.yml, without
 * mutating the hub repo itself.
 */

import * as assert from 'node:assert';
import {
  describe,
  it,
} from 'mocha';
import {
  parseExtraSource,
} from '../../src/primitive-index/hub/extra-source';

describe('primitive-index / extra-source', () => {
  it('parses a minimal awesome-copilot-plugin source spec with defaults', () => {
    const s = parseExtraSource('id=upstream,type=awesome-copilot-plugin,url=https://github.com/github/awesome-copilot');
    assert.strictEqual(s.id, 'upstream');
    assert.strictEqual(s.name, 'upstream');
    assert.strictEqual(s.type, 'awesome-copilot-plugin');
    assert.strictEqual(s.owner, 'github');
    assert.strictEqual(s.repo, 'awesome-copilot');
    assert.strictEqual(s.branch, 'main');
    assert.strictEqual(s.pluginsPath, 'plugins');
  });

  it('honours explicit branch + name + pluginsPath overrides', () => {
    const s = parseExtraSource([
      'id=ac-dev',
      'name=Awesome Copilot (dev)',
      'type=awesome-copilot-plugin',
      'url=https://github.com/github/awesome-copilot',
      'branch=develop',
      'pluginsPath=experimental/plugins'
    ].join(','));
    assert.strictEqual(s.name, 'Awesome Copilot (dev)');
    assert.strictEqual(s.branch, 'develop');
    assert.strictEqual(s.pluginsPath, 'experimental/plugins');
  });

  it('supports github source type too (no pluginsPath default)', () => {
    const s = parseExtraSource('id=my-repo,type=github,url=https://github.com/o/r');
    assert.strictEqual(s.type, 'github');
    assert.strictEqual(s.pluginsPath, undefined);
  });

  it('rejects missing required fields (id, type, url) with a useful message', () => {
    assert.throws(() => parseExtraSource('type=github,url=https://github.com/o/r'), /missing field/iu);
    assert.throws(() => parseExtraSource('id=a,url=https://github.com/o/r'), /missing field/iu);
    assert.throws(() => parseExtraSource('id=a,type=github'), /missing field/iu);
  });

  it('rejects unsupported source types', () => {
    assert.throws(
      () => parseExtraSource('id=a,type=bogus,url=https://github.com/o/r'),
      /unsupported source type/iu
    );
  });

  it('rejects non-GitHub URLs', () => {
    assert.throws(
      () => parseExtraSource('id=a,type=github,url=https://gitlab.com/o/r'),
      /not a github url/iu
    );
  });
});

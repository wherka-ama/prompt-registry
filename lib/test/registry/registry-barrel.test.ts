import * as assert from 'node:assert';
import * as pkg from '../../src';
import * as core from '../../src/core';
import * as hub from '../../src/hub';
import * as registry from '../../src/registry';

describe('registry / reusable-layer barrels', () => {
  it('exposes core, hub, paths namespaces from the registry barrel', () => {
    assert.ok(registry.core, 'registry.core missing');
    assert.ok(registry.hub, 'registry.hub missing');
    assert.ok(registry.paths, 'registry.paths missing');
  });

  it('hub barrel re-exports the key runtime classes', () => {
    // Deliberately exercise both classes and functions so a typo in the
    // barrel surfaces at compile time AND at runtime.
    assert.strictEqual(typeof hub.GitHubApiClient, 'function', 'GitHubApiClient');
    assert.strictEqual(typeof hub.BlobCache, 'function', 'BlobCache');
    assert.strictEqual(typeof hub.HubHarvester, 'function', 'HubHarvester');
    assert.strictEqual(typeof hub.GitHubSingleBundleProvider, 'function', 'GitHubSingleBundleProvider');
    assert.strictEqual(typeof hub.AwesomeCopilotPluginBundleProvider, 'function', 'AwesomeCopilotPluginBundleProvider');
    assert.strictEqual(typeof hub.parseHubConfig, 'function', 'parseHubConfig');
    assert.strictEqual(typeof hub.parseExtraSource, 'function', 'parseExtraSource');
    assert.strictEqual(typeof hub.resolveGithubToken, 'function', 'resolveGithubToken');
    assert.strictEqual(typeof hub.enumerateRepoTree, 'function', 'enumerateRepoTree');
    assert.strictEqual(typeof hub.enumeratePluginRepo, 'function', 'enumeratePluginRepo');
    assert.strictEqual(typeof hub.parsePluginManifest, 'function', 'parsePluginManifest');
    assert.strictEqual(typeof hub.computeIndexHmac, 'function', 'computeIndexHmac');
    assert.strictEqual(typeof hub.verifyIndexIntegrity, 'function', 'verifyIndexIntegrity');
  });

  it('core barrel re-exports primitive-kind constants', () => {
    assert.ok(Array.isArray(core.PRIMITIVE_KINDS));
    assert.ok(core.PRIMITIVE_KINDS.includes('skill'));
    assert.ok(core.PRIMITIVE_KINDS.includes('mcp-server'));
  });

  it('top-level package still exposes registry/hub/core namespaces', () => {
    assert.ok(pkg.registry);
    assert.ok(pkg.hub);
    assert.ok(pkg.core);
    // Sanity: the object identity is preserved across the two import paths.
    assert.strictEqual(pkg.hub.HubHarvester, hub.HubHarvester);
    assert.strictEqual(pkg.registry.hub.HubHarvester, hub.HubHarvester);
  });
});

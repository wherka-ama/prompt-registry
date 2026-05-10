/**
 * Phase 3 / Iter 2 — Domain barrel shape regression test.
 *
 * Pins the public surface of the domain layer (spec §14.2 invariant #1).
 * Iter 1 created the domain barrels by extracting types from
 * `primitive-index/types.ts`. Without a test, future renames or
 * accidental removals from the barrel would only be caught by
 * downstream consumers — this test fails *at the domain boundary*
 * instead, with a clear "expected `BundleRef`, got undefined" diagnostic.
 *
 * The domain layer is *type-only* by design; runtime checks are limited
 * to:
 *   - the `PRIMITIVE_KINDS` const array (the one runtime export)
 *   - structural conformance for example payloads (assigning an object
 *     to a typed local variable is a compile-time check that converts
 *     to a no-op at runtime — the test still serves as documentation)
 */
import * as assert from 'node:assert';
import * as domain from '../../src/domain';
import type {
  BundleManifest,
  BundleProvider,
  BundleRef,
  HarvestedFile,
  HubSourceSpec,
  PluginItem,
  PluginItemKind,
  PluginManifest,
  Primitive,
  PrimitiveKind,
} from '../../src/domain';

describe('Phase 3 / Iter 2 — domain barrel shape', () => {
  describe('runtime exports', () => {
    it('exposes PRIMITIVE_KINDS with all six kinds', () => {
      assert.deepStrictEqual(
        domain.PRIMITIVE_KINDS.toSorted(),
        ['agent', 'chat-mode', 'instruction', 'mcp-server', 'prompt', 'skill']
      );
    });

    it('runtime exports are exactly the documented set', () => {
      // Anything else on the barrel must be a type-only export. We
      // catch accidental runtime additions by enumerating own keys.
      // Phase 5 / Iter 1 added TARGET_TYPES + isTarget for install
      // domain types.
      // Phase 6 / Iter 11-14 added registry-domain runtime exports
      // (DEFAULT_LOCAL_HUB_ID, sanitizeHubId, isHubReference,
      // isHubConfig, isRegistrySource, isProfile, isProfileBundle).
      const ownKeys = Object.keys(domain).toSorted();
      assert.deepStrictEqual(ownKeys, [
        'DEFAULT_LOCAL_HUB_ID',
        'PRIMITIVE_KINDS',
        'TARGET_TYPES',
        'isHubConfig',
        'isHubReference',
        'isProfile',
        'isProfileBundle',
        'isRegistrySource',
        'isTarget',
        'sanitizeHubId'
      ]);
    });
  });

  describe('type exports — structural conformance', () => {
    it('BundleRef accepts a minimum-viable record', () => {
      const ref: BundleRef = {
        sourceId: 'wherka-ama/awesome-copilot',
        sourceType: 'github',
        bundleId: 'tdd-helper',
        bundleVersion: '1.0.0',
        installed: false
      };
      assert.strictEqual(ref.bundleId, 'tdd-helper');
    });

    it('BundleManifest tolerates open-ended fields (manifest schema is bundle-defined)', () => {
      const manifest: BundleManifest = {
        id: 'tdd-helper',
        version: '1.0.0',
        items: [{ path: 'prompts/x.md', kind: 'prompt' }],
        // Open-ended schema — extra fields are part of the contract.
        someBundleSpecificField: 42
      };
      assert.strictEqual(manifest.id, 'tdd-helper');
    });

    it('Primitive carries the harvested-bundle anchor and the search-relevant fields', () => {
      const p: Primitive = {
        id: 'wherka-ama/x@1.0.0::prompts/foo.md',
        bundle: {
          sourceId: 'wherka-ama/x', sourceType: 'github',
          bundleId: 'x', bundleVersion: '1.0.0', installed: true
        },
        kind: 'prompt' satisfies PrimitiveKind,
        path: 'prompts/foo.md',
        title: 'Foo prompt',
        description: 'Does foo things.',
        tags: ['foo'],
        bodyPreview: '...',
        contentHash: 'sha256:...'
      };
      assert.strictEqual(p.kind, 'prompt');
    });

    it('HarvestedFile is the minimum bundle-file payload', () => {
      const f: HarvestedFile = { path: 'a.md', content: 'hi' };
      assert.strictEqual(f.path, 'a.md');
    });

    it('PluginItemKind is a subset of PrimitiveKind (no `mcp-server`)', () => {
      // Compile-time: every PluginItemKind must also be a PrimitiveKind.
      // Runtime: spot-check a representative pair.
      const k: PluginItemKind = 'agent';
      const p: PrimitiveKind = k; // Assignability is the actual assertion.
      assert.strictEqual(p, 'agent');
    });

    it('PluginItem and PluginManifest model the awesome-copilot plugin format', () => {
      const item: PluginItem = { kind: 'skill', path: 'skills/foo.md' };
      const manifest: PluginManifest = {
        id: 'foo',
        name: 'Foo Plugin',
        items: [item],
        // Permissive surface — unknown keys must be tolerated.
        someExperimentalField: 'x'
      };
      assert.strictEqual(manifest.id, 'foo');
      assert.strictEqual(item.kind, 'skill');
    });

    it('HubSourceSpec carries the parsed-config representation of a hub source', () => {
      const spec: HubSourceSpec = {
        id: 'wherka-ama-awesome-copilot',
        name: 'awesome-copilot',
        type: 'awesome-copilot-plugin',
        url: 'https://github.com/wherka-ama/awesome-copilot',
        owner: 'wherka-ama',
        repo: 'awesome-copilot',
        branch: 'main',
        pluginsPath: 'plugins'
      };
      assert.strictEqual(spec.type, 'awesome-copilot-plugin');
      assert.strictEqual(spec.pluginsPath, 'plugins');
    });

    it('BundleProvider is callable as an interface (compile-time only check)', () => {
      // We assert that a class implementing BundleProvider compiles.
      // No runtime invocation — `class` body is enough as a type test.
      class StubProvider implements BundleProvider {
        public listBundles(): AsyncIterable<BundleRef> {
          return (async function* () { /* empty */ })();
        }

        public readManifest(): Promise<BundleManifest> {
          return Promise.resolve({ id: 'x', version: '0' });
        }

        public readFile(): Promise<string> {
          return Promise.resolve('');
        }
      }
      assert.strictEqual(typeof StubProvider, 'function');
    });
  });
});

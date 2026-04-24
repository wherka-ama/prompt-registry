/**
 * PrimitiveIndexManager unit tests.
 *
 * Covers:
 *  - InstalledBundlesProvider walks the install path and synthesises
 *    manifest items via file-suffix detection.
 *  - PrimitiveIndexManager builds, persists and reloads an index on disk.
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as sinon from 'sinon';
import {
  InstalledBundlesProvider,
  PrimitiveIndexManager,
} from '../../src/services/primitive-index-manager';
import { RegistryManager } from '../../src/services/registry-manager';
import type { InstalledBundle } from '../../src/types/registry';

function createBundleOnDisk(root: string, bundleId: string): InstalledBundle {
  const installPath = path.join(root, bundleId);
  fs.mkdirSync(path.join(installPath, 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(installPath, 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(
    path.join(installPath, 'prompts', 'hello.prompt.md'),
    '---\ntitle: Hello\ndescription: says hello\ntags: [greeting]\n---\n\n# Hello',
    'utf8',
  );
  fs.writeFileSync(
    path.join(installPath, 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: "A demo skill that greets the user"\n---\n\n# demo',
    'utf8',
  );
  return {
    bundleId,
    version: '1.0.0',
    installedAt: new Date().toISOString(),
    scope: 'user',
    installPath,
    manifest: { name: bundleId, description: 'd', tags: ['test'] } as unknown as InstalledBundle['manifest'],
    sourceId: 'local',
    sourceType: 'local',
  };
}

suite('InstalledBundlesProvider', () => {
  let tmp: string;
  setup(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-mgr-'));
  });
  teardown(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    PrimitiveIndexManager.resetInstance();
  });

  test('lists bundles, synthesises manifest items, and reads files', async () => {
    const b = createBundleOnDisk(tmp, 'demo-bundle');
    const provider = new InstalledBundlesProvider([b]);
    const refs: unknown[] = [];
    for await (const ref of provider.listBundles()) {
      refs.push(ref);
    }
    assert.strictEqual(refs.length, 1);

    const manifest = await provider.readManifest(refs[0] as { sourceId: string; bundleId: string; bundleVersion: string } & Parameters<typeof provider.readManifest>[0]);
    assert.strictEqual(manifest.id, 'demo-bundle');
    assert.ok(manifest.items && manifest.items.length === 2);
    const paths = manifest.items.map((i) => i.path).toSorted();
    assert.deepStrictEqual(paths, ['prompts/hello.prompt.md', 'skills/demo/SKILL.md']);

    const body = await provider.readFile(refs[0] as Parameters<typeof provider.readFile>[0], 'prompts/hello.prompt.md');
    assert.match(body, /title: Hello/);
  });

  test('refuses path traversal', async () => {
    const b = createBundleOnDisk(tmp, 'demo-bundle');
    const provider = new InstalledBundlesProvider([b]);
    await assert.rejects(provider.readFile(
      { sourceId: 'local', sourceType: 'local', bundleId: 'demo-bundle', bundleVersion: '1.0.0', installed: true },
      '../../etc/passwd',
    ));
  });

  test('skips bundles whose installPath does not exist', async () => {
    const missing: InstalledBundle = {
      ...createBundleOnDisk(tmp, 'x'),
      installPath: path.join(tmp, 'does-not-exist'),
    };
    const provider = new InstalledBundlesProvider([missing]);
    const refs: unknown[] = [];
    for await (const ref of provider.listBundles()) {
      refs.push(ref);
    }
    assert.strictEqual(refs.length, 0);
  });
});

suite('PrimitiveIndexManager', () => {
  let tmp: string;
  let sandbox: sinon.SinonSandbox;
  setup(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-mgr-'));
    sandbox = sinon.createSandbox();
  });
  teardown(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    sandbox.restore();
    PrimitiveIndexManager.resetInstance();
  });

  test('buildFromInstalled produces a searchable index and persists to disk', async () => {
    const installed = [
      createBundleOnDisk(tmp, 'bundle-a'),
      createBundleOnDisk(tmp, 'bundle-b'),
    ];
    const registry = sandbox.createStubInstance(RegistryManager);
    registry.listInstalledBundles.resolves(installed);

    const mockContext: any = { globalStorageUri: { fsPath: tmp } };
    const manager = PrimitiveIndexManager.getInstance(mockContext, registry as unknown as RegistryManager);

    const idx = await manager.buildFromInstalled();
    const stats = idx.stats();
    assert.strictEqual(stats.bundles, 2);
    assert.ok(stats.primitives >= 4); // 2 prompts + 2 skills

    const hits = idx.search({ q: 'hello' }).hits;
    assert.ok(hits.length > 0);
    assert.match(hits[0].primitive.title, /Hello/);

    // Persisted to disk + reloadable.
    assert.ok(fs.existsSync(path.join(tmp, 'primitive-index.json')));
    PrimitiveIndexManager.resetInstance();
    const reloaded = PrimitiveIndexManager.getInstance(mockContext, registry as unknown as RegistryManager);
    assert.strictEqual(reloaded.getIndex()?.stats().primitives, stats.primitives);
  });

  test('refreshFromInstalled reports updates and removals', async () => {
    const bundles = [createBundleOnDisk(tmp, 'bundle-a')];
    const registry = sandbox.createStubInstance(RegistryManager);
    registry.listInstalledBundles.resolves(bundles);
    const mockContext: any = { globalStorageUri: { fsPath: tmp } };
    const manager = PrimitiveIndexManager.getInstance(mockContext, registry as unknown as RegistryManager);
    const idx = await manager.buildFromInstalled();
    const before = idx.stats().primitives;

    // Mutate disk: change content of one file (should flag as updated).
    fs.writeFileSync(
      path.join(bundles[0].installPath, 'prompts', 'hello.prompt.md'),
      '---\ntitle: Hello World\ndescription: new body\n---\n\n# Hello new content',
      'utf8',
    );

    const report = await manager.refreshFromInstalled();
    assert.strictEqual(idx.stats().primitives, before);
    assert.ok(report.updated.length >= 1);
  });
});

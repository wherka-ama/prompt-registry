import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  harvest,
} from '../../src/primitive-index/harvester';
import {
  LocalFolderBundleProvider,
} from '../../src/primitive-index/providers/local-folder';

function writeBundle(root: string, id: string): void {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'deployment-manifest.yml'),
    `id: ${id}
version: 1.0.0
name: ${id}
description: test
tags: [test]
items:
  - path: prompts/hello.prompt.md
    kind: prompt
`,
    'utf8'
  );
  fs.mkdirSync(path.join(dir, 'prompts'));
  fs.writeFileSync(
    path.join(dir, 'prompts', 'hello.prompt.md'),
    '---\ntitle: Hello\ndescription: says hello\ntags: [greeting]\n---\n\n# Hello\n',
    'utf8'
  );
}

describe('LocalFolderBundleProvider', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-local-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('lists bundles, reads manifests, and feeds the harvester', async () => {
    writeBundle(tmp, 'b1');
    writeBundle(tmp, 'b2');
    const provider = new LocalFolderBundleProvider({ root: tmp, sourceId: 'local' });
    const prims = await harvest(provider);
    assert.strictEqual(prims.length, 2);
    assert.ok(prims.every((p) => p.kind === 'prompt'));
    assert.ok(prims.every((p) => p.bundle.sourceId === 'local'));
    assert.ok(prims.every((p) => p.bundle.installed));
  });

  it('rejects path traversal on readFile', async () => {
    writeBundle(tmp, 'b1');
    const provider = new LocalFolderBundleProvider({ root: tmp });
    await assert.rejects(
      provider.readFile(
        { sourceId: 'x', sourceType: 'local', bundleId: 'b1', bundleVersion: '1.0.0', installed: true },
        '../secret.txt'
      )
    );
  });
});

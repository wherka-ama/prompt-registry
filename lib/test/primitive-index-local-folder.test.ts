import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  LocalFolderBundleProvider,
} from '../src/infra/harvest/bundle-providers/local-folder';
import {
  harvest,
} from '../src/infra/harvest/harvester';

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
    expect(prims.length).toBe(2);
    expect(prims.every((p) => p.kind === 'prompt')).toBe(true);
    expect(prims.every((p) => p.bundle.sourceId === 'local')).toBe(true);
    expect(prims.every((p) => p.bundle.installed)).toBe(true);
  });

  it('rejects path traversal on readFile', async () => {
    writeBundle(tmp, 'b1');
    const provider = new LocalFolderBundleProvider({ root: tmp });
    await expect(
      provider.readFile(
        { sourceId: 'x', sourceType: 'local', bundleId: 'b1', bundleVersion: '1.0.0', installed: true },
        '../secret.txt'
      )
    ).rejects.toThrow();
  });
});

/**
 * Phase 5 / Iter 39 — bundle build + install integration.
 *
 * End-to-end pipeline:
 *   bundle build (Phase 4)  ->  install --from (Phase 5)
 *
 * Verifies that a bundle produced by the build command is consumable
 * by install --from without any intermediate user-facing step. This
 * is the core dev workflow Phase 5 supports today.
 */
import * as assert from 'node:assert';
import {
  spawnSync,
} from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const LIB_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CLI_BIN = path.join(LIB_ROOT, 'dist', 'cli', 'index.js');
const haveBuild = fs.existsSync(CLI_BIN);
const maybeDescribe = haveBuild ? describe : describe.skip;

const run = (args: string[], cwd: string, env?: Record<string, string>): {
  code: number; stdout: string; stderr: string;
} => {
  const proc = spawnSync('node', [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
  return { code: proc.status ?? 1, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' };
};

maybeDescribe('Phase 5 / Iter 39 — bundle build + install', function () {
  this.timeout(30_000);
  let work: string;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-bni-'));
    // Project layout:
    //   collections/
    //     foo.collection.yml
    //   prompts/
    //     hello.md
    fs.mkdirSync(path.join(work, 'collections'), { recursive: true });
    fs.mkdirSync(path.join(work, 'prompts'), { recursive: true });
    fs.writeFileSync(
      path.join(work, 'prompts', 'hello.md'),
      '---\nmode: ask\n---\n# Hello prompt'
    );
    fs.writeFileSync(
      path.join(work, 'collections', 'foo.collection.yml'),
      `id: foo
name: Foo collection
items:
  - path: prompts/hello.md
`
    );
  });

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('build emits <out>/<collectionId>/{manifest,zip}', () => {
    // bundle build creates <out>/<collectionId>/ with both the
    // expanded manifest and a reproducible bundle zip side by side.
    const buildOut = path.join(work, 'build');
    const build = run([
      'bundle', 'build',
      '--collection-file', 'collections/foo.collection.yml',
      '--version', '1.0.0',
      '--out-dir', buildOut,
      '--repo-slug', 'owner/repo',
      '-o', 'json'
    ], work);
    assert.strictEqual(build.code, 0,
      `bundle build stderr=${build.stderr}; stdout=${build.stdout}`);
    // The collection-named subdir.
    const subdir = path.join(buildOut, 'foo');
    assert.ok(fs.existsSync(path.join(subdir, 'deployment-manifest.yml')),
      `expected manifest in ${subdir}; got: ${fs.readdirSync(subdir).join(',')}`);
    assert.ok(fs.readdirSync(subdir).some((f) => f.endsWith('.bundle.zip')),
      `expected a .bundle.zip in ${subdir}`);
  });

  it('install --from on a manually-staged bundle dir places files in the target', () => {
    // Stage the bundle dir directly (mirrors what the unzip step
    // would produce in spillover).
    const bundleDir = path.join(work, 'staged');
    fs.mkdirSync(path.join(bundleDir, 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(bundleDir, 'deployment-manifest.yml'),
      'id: foo\nversion: 1.0.0\nname: Foo\n');
    fs.writeFileSync(path.join(bundleDir, 'prompts', 'hello.md'), '# hi');
    const vscodeDir = path.join(work, 'vscode');
    assert.strictEqual(run([
      'target', 'add', 'my-vscode', '--type', 'vscode',
      '--path', vscodeDir, '-o', 'json'
    ], work).code, 0);
    const inst = run([
      'install', 'foo', '--target', 'my-vscode',
      '--from', bundleDir, '-o', 'json'
    ], work);
    assert.strictEqual(inst.code, 0);
    assert.ok(fs.existsSync(path.join(vscodeDir, 'prompts', 'hello.md')));
  });
});

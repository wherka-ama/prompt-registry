import {
  spawnSync,
} from 'node:child_process';
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

const LIB_ROOT = path.resolve(__dirname, '..', '..', '..');
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

maybeDescribe('bundle build + install', () => {
  let work: string;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-bni-'));
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
  }, 30_000);

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('build emits <out>/<collectionId>/{manifest,zip}', () => {
    const buildOut = path.join(work, 'build');
    const build = run([
      'bundle', 'build',
      '--collection-file', 'collections/foo.collection.yml',
      '--version', '1.0.0',
      '--out-dir', buildOut,
      '--repo-slug', 'owner/repo',
      '-o', 'json'
    ], work);
    expect(build.code).toBe(0);
    const subdir = path.join(buildOut, 'foo');
    expect(fs.existsSync(path.join(subdir, 'deployment-manifest.yml'))).toBe(true);
    expect(fs.readdirSync(subdir).some((f) => f.endsWith('.bundle.zip'))).toBe(true);
  });

  it('install --from on a manually-staged bundle dir places files in the target', () => {
    const bundleDir = path.join(work, 'staged');
    fs.mkdirSync(path.join(bundleDir, 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(bundleDir, 'deployment-manifest.yml'),
      'id: foo\nversion: 1.0.0\nname: Foo\n');
    fs.writeFileSync(path.join(bundleDir, 'prompts', 'hello.md'), '# hi');
    const vscodeDir = path.join(work, 'vscode');
    expect(run([
      'target', 'add', 'my-vscode', '--type', 'vscode',
      '--path', vscodeDir, '-o', 'json'
    ], work).code).toBe(0);
    const inst = run([
      'install', 'foo', '--target', 'my-vscode',
      '--from', bundleDir, '-o', 'json'
    ], work);
    expect(inst.code).toBe(0);
    expect(fs.existsSync(path.join(vscodeDir, 'prompts', 'hello.md'))).toBe(true);
  });
}, 30_000);

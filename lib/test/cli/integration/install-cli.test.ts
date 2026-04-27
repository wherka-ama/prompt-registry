/**
 * Phase 5 / Iter 34 — `install` end-to-end smoke test.
 *
 * Spawns the built binary against a temp project. Builds a bundle on
 * disk, runs `prompt-registry install`, asserts files land in the
 * vscode target dir.
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

const run = (args: string[], cwd: string): { code: number; stdout: string; stderr: string } => {
  const proc = spawnSync('node', [CLI_BIN, ...args], { cwd, encoding: 'utf8' });
  return { code: proc.status ?? 1, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' };
};

maybeDescribe('Phase 5 / Iter 34 — install e2e', function () {
  this.timeout(15_000);
  let work: string;
  let bundleDir: string;
  let vscodeDir: string;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-install-e2e-'));
    bundleDir = path.join(work, 'bundle');
    vscodeDir = path.join(work, 'vscode');
    fs.mkdirSync(path.join(bundleDir, 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(bundleDir, 'deployment-manifest.yml'),
      'id: foo\nversion: 1.0.0\nname: Foo\n');
    fs.writeFileSync(path.join(bundleDir, 'prompts', 'a.md'), 'A');
  });

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('target add + install --from places files in the target dir', () => {
    const add = run(['target', 'add', 'my-vscode',
      '--type', 'vscode',
      '--path', vscodeDir,
      '-o', 'json'
    ], work);
    assert.strictEqual(add.code, 0, `target add stderr=${add.stderr}`);

    const inst = run(['install', 'foo',
      '--target', 'my-vscode',
      '--from', bundleDir,
      '-o', 'json'
    ], work);
    assert.strictEqual(inst.code, 0, `install stderr=${inst.stderr}; stdout=${inst.stdout}`);

    const parsed = JSON.parse(inst.stdout) as {
      data: { written: string[]; bundle: { id: string; version: string }; lockfile: string };
    };
    assert.strictEqual(parsed.data.bundle.id, 'foo');
    assert.strictEqual(parsed.data.bundle.version, '1.0.0');
    assert.ok(fs.existsSync(path.join(vscodeDir, 'prompts', 'a.md')));
    assert.ok(fs.existsSync(parsed.data.lockfile));
  });

  it('install --dry-run emits the plan but writes nothing', () => {
    const add = run(['target', 'add', 'my-vscode', '--type', 'vscode',
      '--path', vscodeDir, '-o', 'json'], work);
    assert.strictEqual(add.code, 0);
    const inst = run(['install', 'foo', '--target', 'my-vscode',
      '--from', bundleDir, '--dry-run', '-o', 'json'], work);
    assert.strictEqual(inst.code, 0);
    const parsed = JSON.parse(inst.stdout) as { data: { dryRun: boolean } };
    assert.strictEqual(parsed.data.dryRun, true);
    assert.ok(!fs.existsSync(path.join(vscodeDir, 'prompts')));
  });

  it('install writes a lockfile on success and replays it', () => {
    const add = run(['target', 'add', 'my-vscode', '--type', 'vscode',
      '--path', vscodeDir, '-o', 'json'], work);
    assert.strictEqual(add.code, 0);
    const inst = run(['install', 'foo', '--target', 'my-vscode',
      '--from', bundleDir, '-o', 'json'], work);
    assert.strictEqual(inst.code, 0);
    const lockfile = path.join(work, 'prompt-registry.lock.json');
    assert.ok(fs.existsSync(lockfile));
    const lock = JSON.parse(fs.readFileSync(lockfile, 'utf8')) as {
      schemaVersion: number; entries: { bundleId: string; bundleVersion: string }[];
    };
    assert.strictEqual(lock.schemaVersion, 1);
    assert.strictEqual(lock.entries.length, 1);
    assert.strictEqual(lock.entries[0].bundleId, 'foo');
    // Replay (Phase 5 iter 28: read+validate path).
    const replay = run(['install', 'foo',
      '--lockfile', 'prompt-registry.lock.json',
      '--target', 'my-vscode',
      '-o', 'json'], work);
    assert.strictEqual(replay.code, 0, `replay stderr=${replay.stderr}`);
    const replayParsed = JSON.parse(replay.stdout) as {
      data: { replayPlanned: number; entries: { bundleId: string }[] };
    };
    assert.strictEqual(replayParsed.data.replayPlanned, 1);
  });

  it('install --lockfile actually replays files into the target', () => {
    const add = run(['target', 'add', 'my-vscode', '--type', 'vscode',
      '--path', vscodeDir, '-o', 'json'], work);
    assert.strictEqual(add.code, 0);
    const inst = run(['install', 'foo', '--target', 'my-vscode',
      '--from', bundleDir, '-o', 'json'], work);
    assert.strictEqual(inst.code, 0);

    // Wipe the target, then replay from the lockfile.
    fs.rmSync(vscodeDir, { recursive: true, force: true });
    assert.ok(!fs.existsSync(path.join(vscodeDir, 'prompts', 'a.md')));

    const replay = run(['install', 'foo',
      '--lockfile', 'prompt-registry.lock.json',
      '--target', 'my-vscode',
      '-o', 'json'
    ], work);
    assert.strictEqual(replay.code, 0, `replay stderr=${replay.stderr}; stdout=${replay.stdout}`);
    const parsed = JSON.parse(replay.stdout) as {
      data: { replayPlanned: number; replayed: string[]; failures: { bundleId: string }[] };
    };
    assert.strictEqual(parsed.data.replayPlanned, 1);
    assert.deepStrictEqual(parsed.data.replayed, ['foo']);
    assert.strictEqual(parsed.data.failures.length, 0);
    // File should be back on disk.
    assert.ok(fs.existsSync(path.join(vscodeDir, 'prompts', 'a.md')));
  });

  it('install --target unknown surfaces USAGE.MISSING_FLAG', () => {
    const r = run(['install', 'foo', '--target', 'nope',
      '--from', bundleDir, '-o', 'json'], work);
    assert.strictEqual(r.code, 1);
    const parsed = JSON.parse(r.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
  });
});

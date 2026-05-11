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

const run = (args: string[], cwd: string): { code: number; stdout: string; stderr: string } => {
  const proc = spawnSync('node', [CLI_BIN, ...args], { cwd, encoding: 'utf8' });
  return { code: proc.status ?? 1, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' };
};

maybeDescribe('install e2e', () => {
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
  }, 15_000);

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('target add + install --from places files in the target dir', () => {
    const add = run(['target', 'add', 'my-vscode',
      '--type', 'vscode',
      '--path', vscodeDir,
      '-o', 'json'
    ], work);
    expect(add.code).toBe(0);

    const inst = run(['install', 'foo',
      '--target', 'my-vscode',
      '--from', bundleDir,
      '-o', 'json'
    ], work);
    expect(inst.code).toBe(0);

    const parsed = JSON.parse(inst.stdout) as {
      data: { written: string[]; bundle: { id: string; version: string }; lockfile: string };
    };
    expect(parsed.data.bundle.id).toBe('foo');
    expect(parsed.data.bundle.version).toBe('1.0.0');
    expect(fs.existsSync(path.join(vscodeDir, 'prompts', 'a.md'))).toBe(true);
    expect(fs.existsSync(parsed.data.lockfile)).toBe(true);
  });

  it('install --dry-run emits the plan but writes nothing', () => {
    const add = run(['target', 'add', 'my-vscode', '--type', 'vscode',
      '--path', vscodeDir, '-o', 'json'], work);
    expect(add.code).toBe(0);
    const inst = run(['install', 'foo', '--target', 'my-vscode',
      '--from', bundleDir, '--dry-run', '-o', 'json'], work);
    expect(inst.code).toBe(0);
    const parsed = JSON.parse(inst.stdout) as { data: { dryRun: boolean } };
    expect(parsed.data.dryRun).toBe(true);
    expect(fs.existsSync(path.join(vscodeDir, 'prompts'))).toBe(false);
  });

  it('install writes a lockfile on success and replays it', () => {
    const add = run(['target', 'add', 'my-vscode', '--type', 'vscode',
      '--path', vscodeDir, '-o', 'json'], work);
    expect(add.code).toBe(0);
    const inst = run(['install', 'foo', '--target', 'my-vscode',
      '--from', bundleDir, '-o', 'json'], work);
    expect(inst.code).toBe(0);
    const lockfile = path.join(work, 'prompt-registry.lock.json');
    expect(fs.existsSync(lockfile)).toBe(true);
    const lock = JSON.parse(fs.readFileSync(lockfile, 'utf8')) as {
      schemaVersion: number; entries: { bundleId: string; bundleVersion: string }[];
    };
    expect(lock.schemaVersion).toBe(1);
    expect(lock.entries.length).toBe(1);
    expect(lock.entries[0].bundleId).toBe('foo');
    const replay = run(['install', 'foo',
      '--lockfile', 'prompt-registry.lock.json',
      '--target', 'my-vscode',
      '-o', 'json'], work);
    expect(replay.code).toBe(0);
    const replayParsed = JSON.parse(replay.stdout) as {
      data: { replayPlanned: number; entries: { bundleId: string }[] };
    };
    expect(replayParsed.data.replayPlanned).toBe(1);
  });

  it('install --lockfile actually replays files into the target', () => {
    const add = run(['target', 'add', 'my-vscode', '--type', 'vscode',
      '--path', vscodeDir, '-o', 'json'], work);
    expect(add.code).toBe(0);
    const inst = run(['install', 'foo', '--target', 'my-vscode',
      '--from', bundleDir, '-o', 'json'], work);
    expect(inst.code).toBe(0);

    fs.rmSync(vscodeDir, { recursive: true, force: true });
    expect(fs.existsSync(path.join(vscodeDir, 'prompts', 'a.md'))).toBe(false);

    const replay = run(['install', 'foo',
      '--lockfile', 'prompt-registry.lock.json',
      '--target', 'my-vscode',
      '-o', 'json'
    ], work);
    expect(replay.code).toBe(0);
    const parsed = JSON.parse(replay.stdout) as {
      data: { replayPlanned: number; replayed: string[]; failures: { bundleId: string }[] };
    };
    expect(parsed.data.replayPlanned).toBe(1);
    expect(parsed.data.replayed).toStrictEqual(['foo']);
    expect(parsed.data.failures.length).toBe(0);
    expect(fs.existsSync(path.join(vscodeDir, 'prompts', 'a.md'))).toBe(true);
  });

  it('install --target unknown surfaces USAGE.MISSING_FLAG', () => {
    const r = run(['install', 'foo', '--target', 'nope',
      '--from', bundleDir, '-o', 'json'], work);
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('install --lockfile without bundle-id does not reject the option', () => {
    const add = run(['target', 'add', 'my-vscode', '--type', 'vscode',
      '--path', vscodeDir, '-o', 'json'], work);
    expect(add.code).toBe(0);
    const inst = run(['install', 'foo', '--target', 'my-vscode',
      '--from', bundleDir, '-o', 'json'], work);
    expect(inst.code).toBe(0);

    // Test the specific failing case from the bug report: install --lockfile without bundle-id
    const replay = run(['install',
      '--lockfile', 'prompt-registry.lock.json',
      '--target', 'my-vscode',
      '-o', 'json'
    ], work);
    // Should not fail with "Unsupported option name" error
    // It may fail for other reasons (e.g., lockfile validation), but not option rejection
    expect(replay.stderr).not.toContain('Unsupported option name');
  });
}, 15_000);

/**
 * Phase 6 / Iter 85 — `source` CLI e2e (D23 default-local-hub UX).
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

const run = (args: string[], opts: { cwd: string; env: Record<string, string> }): {
  code: number; stdout: string; stderr: string;
} => {
  const proc = spawnSync('node', [CLI_BIN, ...args], {
    cwd: opts.cwd,
    encoding: 'utf8',
    env: { ...process.env, ...opts.env }
  });
  return { code: proc.status ?? 1, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' };
};

maybeDescribe('Phase 6 / iter 85 - source CLI e2e (default-local-hub)', function () {
  this.timeout(15_000);
  let work: string;
  let xdg: string;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-source-e2e-'));
    xdg = path.join(work, 'xdg');
  });
  afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

  it('source add (no hub) creates default-local hub on first call', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    const add = run([
      'source', 'add', '--type', 'github', '--url', 'owner/repo',
      '--id', 'github-test', '-o', 'json'
    ], { cwd: work, env });
    assert.strictEqual(add.code, 0, `stderr=${add.stderr}; stdout=${add.stdout}`);
    const parsed = JSON.parse(add.stdout) as { data: { source: { hubId: string } } };
    assert.strictEqual(parsed.data.source.hubId, 'default-local');

    const list = run(['source', 'list', '-o', 'json'], { cwd: work, env });
    const listP = JSON.parse(list.stdout) as { data: { sources: { id: string }[] } };
    assert.strictEqual(listP.data.sources.length, 1);
  });

  it('source remove drops the entry', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    run([
      'source', 'add', '--type', 'github', '--url', 'o/r',
      '--id', 'github-test', '-o', 'json'
    ], { cwd: work, env });
    const rm = run(['source', 'remove', 'github-test', '-o', 'json'], { cwd: work, env });
    assert.strictEqual(rm.code, 0);
    const list = run(['source', 'list', '-o', 'json'], { cwd: work, env });
    const listP = JSON.parse(list.stdout) as { data: { sources: unknown[] } };
    assert.strictEqual(listP.data.sources.length, 0);
  });

  it('source add without --url -> USAGE.MISSING_FLAG', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    const r = run(['source', 'add', '--type', 'github', '-o', 'json'], { cwd: work, env });
    assert.strictEqual(r.code, 1);
    const parsed = JSON.parse(r.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
  });
});

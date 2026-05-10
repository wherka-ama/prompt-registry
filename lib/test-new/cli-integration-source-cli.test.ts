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

maybeDescribe('source CLI e2e (default-local-hub)', () => {
  let work: string;
  let xdg: string;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-source-e2e-'));
    xdg = path.join(work, 'xdg');
  }, 15_000);

  afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

  it('source add (no hub) creates default-local hub on first call', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    const add = run([
      'source', 'add', '--type', 'github', '--url', 'owner/repo',
      '--id', 'github-test', '-o', 'json'
    ], { cwd: work, env });
    expect(add.code).toBe(0);
    const parsed = JSON.parse(add.stdout) as { data: { source: { hubId: string } } };
    expect(parsed.data.source.hubId).toBe('default-local');

    const list = run(['source', 'list', '-o', 'json'], { cwd: work, env });
    const listP = JSON.parse(list.stdout) as { data: { sources: { id: string }[] } };
    expect(listP.data.sources.length).toBe(1);
  });

  it('source remove drops the entry', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    run([
      'source', 'add', '--type', 'github', '--url', 'o/r',
      '--id', 'github-test', '-o', 'json'
    ], { cwd: work, env });
    const rm = run(['source', 'remove', 'github-test', '-o', 'json'], { cwd: work, env });
    expect(rm.code).toBe(0);
    const list = run(['source', 'list', '-o', 'json'], { cwd: work, env });
    const listP = JSON.parse(list.stdout) as { data: { sources: unknown[] } };
    expect(listP.data.sources.length).toBe(0);
  });

  it('source add without --url -> USAGE.MISSING_FLAG', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    const r = run(['source', 'add', '--type', 'github', '-o', 'json'], { cwd: work, env });
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });
}, 15_000);

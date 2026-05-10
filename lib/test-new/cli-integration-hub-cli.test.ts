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

const run = (args: string[], opts: { cwd: string; env?: Record<string, string> }): {
  code: number; stdout: string; stderr: string;
} => {
  const proc = spawnSync('node', [CLI_BIN, ...args], {
    cwd: opts.cwd,
    encoding: 'utf8',
    env: { ...process.env, ...opts.env }
  });
  return { code: proc.status ?? 1, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' };
};

const HUB_YAML = `version: 1.0.0
metadata:
  name: My Hub
  description: hub
  maintainer: me
  updatedAt: "2026-04-26T00:00:00Z"
sources:
  - id: github-abc
    name: r
    type: github
    url: owner/repo
    enabled: true
    priority: 0
    hubId: my-hub
profiles: []
`;

maybeDescribe('hub CLI e2e', () => {
  let work: string;
  let xdg: string;
  let hubDir: string;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-hub-e2e-'));
    xdg = path.join(work, 'xdg');
    hubDir = path.join(work, 'hub-source');
    fs.mkdirSync(hubDir, { recursive: true });
    fs.writeFileSync(path.join(hubDir, 'hub-config.yml'), HUB_YAML);
  }, 15_000);

  afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

  it('hub add (local) -> list -> use -> remove', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    const add = run([
      'hub', 'add', '--type', 'local', '--location', hubDir, '-o', 'json'
    ], { cwd: work, env });
    expect(add.code).toBe(0);
    const addParsed = JSON.parse(add.stdout) as { data: { id: string } };
    expect(addParsed.data.id).toBe('my-hub');

    const list = run(['hub', 'list', '-o', 'json'], { cwd: work, env });
    expect(list.code).toBe(0);
    const listParsed = JSON.parse(list.stdout) as {
      data: { hubs: { id: string }[]; activeId: string | null };
    };
    expect(listParsed.data.hubs.length).toBe(1);
    expect(listParsed.data.hubs[0].id).toBe('my-hub');
    expect(listParsed.data.activeId).toBe('my-hub');

    const clear = run(['hub', 'use', '--clear', '-o', 'json'], { cwd: work, env });
    expect(clear.code).toBe(0);

    const remove = run(['hub', 'remove', 'my-hub', '-o', 'json'], { cwd: work, env });
    expect(remove.code).toBe(0);

    const list2 = run(['hub', 'list', '-o', 'json'], { cwd: work, env });
    const list2Parsed = JSON.parse(list2.stdout) as { data: { hubs: unknown[] } };
    expect(list2Parsed.data.hubs.length).toBe(0);
  });

  it('hub add refuses the reserved default-local id', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    const r = run([
      'hub', 'add', '--type', 'local', '--location', hubDir,
      '--id', 'default-local', '-o', 'json'
    ], { cwd: work, env });
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.stdout) as { errors: { message: string }[] };
    expect(parsed.errors[0].message).toMatch(/Reserved/);
  });

  it('hub use throws on unknown id', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    const r = run(['hub', 'use', 'nope', '-o', 'json'], { cwd: work, env });
    expect(r.code).toBe(1);
  });
}, 15_000);

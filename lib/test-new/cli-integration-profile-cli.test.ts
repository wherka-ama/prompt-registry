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

const LIB_ROOT = path.resolve(__dirname, '..');
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

maybeDescribe('profile CLI e2e', () => {
  let work: string;
  let xdg: string;
  let hubDir: string;
  let bundleDir: string;
  let vscodeDir: string;

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-profile-e2e-'));
    xdg = path.join(work, 'xdg');
    hubDir = path.join(work, 'hub');
    bundleDir = path.join(work, 'bundles', 'foo');
    vscodeDir = path.join(work, 'vscode');

    fs.mkdirSync(path.join(bundleDir, 'prompts'), { recursive: true });
    fs.writeFileSync(
      path.join(bundleDir, 'deployment-manifest.yml'),
      'id: foo\nversion: 1.0.0\nname: Foo\n'
    );
    fs.writeFileSync(path.join(bundleDir, 'prompts', 'a.md'), 'A');

    fs.mkdirSync(hubDir, { recursive: true });
    fs.writeFileSync(path.join(hubDir, 'hub-config.yml'), `version: 1.0.0
metadata:
  name: My Hub
  description: hub
  maintainer: me
  updatedAt: "2026-04-26T00:00:00Z"
sources:
  - id: local-foo
    name: Foo Source
    type: local
    url: ${bundleDir}
    enabled: true
    priority: 0
    hubId: my-hub
profiles:
  - id: backend
    name: Backend Developer
    bundles:
      - id: foo
        version: 1.0.0
        source: local-foo
        required: true
`);
  }, 20_000);

  afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

  it('full lifecycle: hub add -> profile list -> activate -> current -> deactivate', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    const addHub = run([
      'hub', 'add', '--type', 'local', '--location', hubDir, '-o', 'json'
    ], { cwd: work, env });
    expect(addHub.code).toBe(0);

    const addTgt = run([
      'target', 'add', 'my-vscode',
      '--type', 'vscode',
      '--path', vscodeDir,
      '-o', 'json'
    ], { cwd: work, env });
    expect(addTgt.code).toBe(0);

    const list = run(['profile', 'list', '-o', 'json'], { cwd: work, env });
    expect(list.code).toBe(0);
    const listParsed = JSON.parse(list.stdout) as {
      data: { profiles: { id: string }[] };
    };
    expect(listParsed.data.profiles.length).toBe(1);
    expect(listParsed.data.profiles[0].id).toBe('backend');

    const act = run(['profile', 'activate', 'backend', '-o', 'json'], { cwd: work, env });
    expect(act.code).toBe(0);
    const actParsed = JSON.parse(act.stdout) as {
      data: { profileId: string; state: { syncedBundles: string[]; syncedTargets: string[] } };
    };
    expect(actParsed.data.profileId).toBe('backend');
    expect(actParsed.data.state.syncedBundles).toStrictEqual(['foo']);
    expect(actParsed.data.state.syncedTargets).toStrictEqual(['my-vscode']);

    const installed = fs.readFileSync(path.join(vscodeDir, 'prompts', 'a.md'), 'utf8');
    expect(installed).toBe('A');

    const cur = run(['profile', 'current', '-o', 'json'], { cwd: work, env });
    const curParsed = JSON.parse(cur.stdout) as {
      data: { current: { profileId: string } | null };
    };
    expect(curParsed.data.current?.profileId).toBe('backend');

    const deact = run(['profile', 'deactivate', '-o', 'json'], { cwd: work, env });
    expect(deact.code).toBe(0);

    const cur2 = run(['profile', 'current', '-o', 'json'], { cwd: work, env });
    const cur2Parsed = JSON.parse(cur2.stdout) as { data: { current: unknown } };
    expect(cur2Parsed.data.current).toBe(null);
  });

  it('profile show prints bundle list', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    run(['hub', 'add', '--type', 'local', '--location', hubDir, '-o', 'json'], { cwd: work, env });
    const show = run(['profile', 'show', 'backend', '-o', 'json'], { cwd: work, env });
    expect(show.code).toBe(0);
    const parsed = JSON.parse(show.stdout) as {
      data: { profile: { name: string; bundles: { id: string }[] } };
    };
    expect(parsed.data.profile.name).toBe('Backend Developer');
    expect(parsed.data.profile.bundles[0].id).toBe('foo');
  });

  it('profile activate without --hub uses active hub by default', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    run(['hub', 'add', '--type', 'local', '--location', hubDir, '-o', 'json'], { cwd: work, env });
    run([
      'target', 'add', 'my-vscode', '--type', 'vscode',
      '--path', vscodeDir, '-o', 'json'
    ], { cwd: work, env });
    const act = run(['profile', 'activate', 'backend', '-o', 'json'], { cwd: work, env });
    expect(act.code).toBe(0);
  });

  it('profile activate aborts on missing target with USAGE.MISSING_FLAG', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    run(['hub', 'add', '--type', 'local', '--location', hubDir, '-o', 'json'], { cwd: work, env });
    const act = run(['profile', 'activate', 'backend', '-o', 'json'], { cwd: work, env });
    expect(act.code).toBe(1);
    const parsed = JSON.parse(act.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('profile activation populates lockfile entries', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    run(['hub', 'add', '--type', 'local', '--location', hubDir, '-o', 'json'], { cwd: work, env });
    run([
      'target', 'add', 'my-vscode', '--type', 'vscode',
      '--path', vscodeDir, '-o', 'json'
    ], { cwd: work, env });
    const act = run(['profile', 'activate', 'backend', '-o', 'json'], { cwd: work, env });
    expect(act.code).toBe(0);

    const lockfilePath = path.join(work, 'prompt-registry.lock.json');
    const lockfileContent = fs.readFileSync(lockfilePath, 'utf8');
    const lockfile = JSON.parse(lockfileContent) as {
      entries: { target: string; bundleId: string; bundleVersion: string; files: string[] }[];
      useProfile: { hubId: string; profileId: string } | null;
    };

    expect(lockfile.entries.length).toBeGreaterThan(0);
    expect(lockfile.entries[0].target).toBe('my-vscode');
    expect(lockfile.entries[0].bundleId).toBe('foo');
    expect(lockfile.entries[0].bundleVersion).toBe('1.0.0');
    expect(lockfile.entries[0].files).toContain('vscode/prompts/a.md');
    expect(lockfile.useProfile).toEqual({ hubId: 'my-hub', profileId: 'backend' });
  });

  it('profile deactivation removes installed files', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    run(['hub', 'add', '--type', 'local', '--location', hubDir, '-o', 'json'], { cwd: work, env });
    run([
      'target', 'add', 'my-vscode', '--type', 'vscode',
      '--path', vscodeDir, '-o', 'json'
    ], { cwd: work, env });
    run(['profile', 'activate', 'backend', '-o', 'json'], { cwd: work, env });

    const deact = run(['profile', 'deactivate', '-o', 'json'], { cwd: work, env });
    expect(deact.code).toBe(0);

    const filePath = path.join(vscodeDir, 'prompts', 'a.md');
    expect(fs.existsSync(filePath)).toBe(false);
  });
}, 20_000);

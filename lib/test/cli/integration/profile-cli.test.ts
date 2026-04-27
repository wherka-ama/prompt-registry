/**
 * Phase 6 / Iter 80 — `profile` CLI end-to-end test.
 *
 * Exercises the full profile lifecycle against a local hub with a
 * local source bundle: hub add -> profile list -> profile activate
 * -> verify files in target -> profile current -> profile deactivate.
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

maybeDescribe('Phase 6 / iter 80 - profile CLI e2e', function () {
  this.timeout(20_000);
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
  });
  afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

  it('full lifecycle: hub add -> profile list -> activate -> current -> deactivate', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    // 1. add hub
    const addHub = run([
      'hub', 'add', '--type', 'local', '--location', hubDir, '-o', 'json'
    ], { cwd: work, env });
    assert.strictEqual(addHub.code, 0, `hub add stderr=${addHub.stderr}; stdout=${addHub.stdout}`);

    // 2. configure target in project
    const addTgt = run([
      'target', 'add', 'my-vscode',
      '--type', 'vscode',
      '--path', vscodeDir,
      '-o', 'json'
    ], { cwd: work, env });
    assert.strictEqual(addTgt.code, 0, `target add stderr=${addTgt.stderr}`);

    // 3. profile list
    const list = run(['profile', 'list', '-o', 'json'], { cwd: work, env });
    assert.strictEqual(list.code, 0, `profile list stderr=${list.stderr}; stdout=${list.stdout}`);
    const listParsed = JSON.parse(list.stdout) as {
      data: { profiles: { id: string }[] };
    };
    assert.strictEqual(listParsed.data.profiles.length, 1);
    assert.strictEqual(listParsed.data.profiles[0].id, 'backend');

    // 4. profile activate
    const act = run(['profile', 'activate', 'backend', '-o', 'json'], { cwd: work, env });
    assert.strictEqual(act.code, 0, `activate stderr=${act.stderr}; stdout=${act.stdout}`);
    const actParsed = JSON.parse(act.stdout) as {
      data: { profileId: string; state: { syncedBundles: string[]; syncedTargets: string[] } };
    };
    assert.strictEqual(actParsed.data.profileId, 'backend');
    assert.deepStrictEqual(actParsed.data.state.syncedBundles, ['foo']);
    assert.deepStrictEqual(actParsed.data.state.syncedTargets, ['my-vscode']);

    // 5. file actually landed
    const installed = fs.readFileSync(path.join(vscodeDir, 'prompts', 'a.md'), 'utf8');
    assert.strictEqual(installed, 'A');

    // 6. current
    const cur = run(['profile', 'current', '-o', 'json'], { cwd: work, env });
    const curParsed = JSON.parse(cur.stdout) as {
      data: { current: { profileId: string } | null };
    };
    assert.strictEqual(curParsed.data.current?.profileId, 'backend');

    // 7. deactivate
    const deact = run(['profile', 'deactivate', '-o', 'json'], { cwd: work, env });
    assert.strictEqual(deact.code, 0);

    // 8. current returns null
    const cur2 = run(['profile', 'current', '-o', 'json'], { cwd: work, env });
    const cur2Parsed = JSON.parse(cur2.stdout) as { data: { current: unknown } };
    assert.strictEqual(cur2Parsed.data.current, null);
  });

  it('profile show prints bundle list', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    run(['hub', 'add', '--type', 'local', '--location', hubDir, '-o', 'json'], { cwd: work, env });
    const show = run(['profile', 'show', 'backend', '-o', 'json'], { cwd: work, env });
    assert.strictEqual(show.code, 0, `stderr=${show.stderr}`);
    const parsed = JSON.parse(show.stdout) as {
      data: { profile: { name: string; bundles: { id: string }[] } };
    };
    assert.strictEqual(parsed.data.profile.name, 'Backend Developer');
    assert.strictEqual(parsed.data.profile.bundles[0].id, 'foo');
  });

  it('profile activate without --hub uses active hub by default', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    run(['hub', 'add', '--type', 'local', '--location', hubDir, '-o', 'json'], { cwd: work, env });
    run([
      'target', 'add', 'my-vscode', '--type', 'vscode',
      '--path', vscodeDir, '-o', 'json'
    ], { cwd: work, env });
    // No --hub flag.
    const act = run(['profile', 'activate', 'backend', '-o', 'json'], { cwd: work, env });
    assert.strictEqual(act.code, 0);
  });

  it('profile activate aborts on missing target with USAGE.MISSING_FLAG', () => {
    const env = { XDG_CONFIG_HOME: xdg };
    run(['hub', 'add', '--type', 'local', '--location', hubDir, '-o', 'json'], { cwd: work, env });
    // No `target add` step.
    const act = run(['profile', 'activate', 'backend', '-o', 'json'], { cwd: work, env });
    assert.strictEqual(act.code, 1);
    const parsed = JSON.parse(act.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
  });
});

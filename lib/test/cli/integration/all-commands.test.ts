/**
 * Phase 4 / Iter 14 — End-to-end smoke test for the unified CLI.
 *
 * This test spawns the actual built binary (`lib/dist/cli/index.js`)
 * with each of the 11 legacy commands' new noun-verb path and
 * verifies that each one is reachable. Failure modes the test
 * deliberately accepts:
 *
 *   - Some commands return non-zero when run with no arguments
 *     (e.g., `bundle build` rejects without --collection-file).
 *     The smoke check is *only* "the command was found and ran";
 *     the assertion is on the *kind* of failure (USAGE.* / FS.*
 *     etc.), never on success.
 *
 * The test requires the build artifact at `lib/dist/cli/index.js`.
 * Run `npm run build` first; otherwise the tests skip with a clear
 * note. This trades a slow `tsc` per CI step against a real
 * end-to-end ergonomic guarantee.
 */
import * as assert from 'node:assert';
import {
  spawnSync,
} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Compiled tests live at lib/dist-test/test/cli/integration/.
// Go up four directories to reach `lib/`, then into `dist/cli/`.
const LIB_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CLI_BIN = path.join(LIB_ROOT, 'dist', 'cli', 'index.js');

const haveBuild = fs.existsSync(CLI_BIN);

const runCli = (args: string[]): { code: number; stdout: string; stderr: string } => {
  const proc = spawnSync('node', [CLI_BIN, ...args], { encoding: 'utf8' });
  return {
    code: proc.status ?? 1,
    stdout: proc.stdout ?? '',
    stderr: proc.stderr ?? ''
  };
};

// We use a top-level conditional describe so we don't need a
// `before(this.skip)` hook (which trips no-undef in this lint config).
const maybeDescribe = haveBuild ? describe : describe.skip;

maybeDescribe('Phase 4 / Iter 14 — end-to-end CLI smoke', () => {
  it('--help prints the binary banner', () => {
    const r = runCli(['--help']);
    assert.strictEqual(r.code, 0);
    assert.ok(r.stdout.includes('prompt-registry'),
      `--help should show binary name; got ${r.stdout.slice(0, 100)}`);
  });

  it('--version prints the version', () => {
    const r = runCli(['--version']);
    assert.strictEqual(r.code, 0);
    assert.ok(/\d+\.\d+\.\d+/.test(r.stdout),
      `--version should match a semver pattern; got ${r.stdout}`);
  });

  it('doctor runs and reports JSON when -o json is passed', () => {
    const r = runCli(['doctor', '-o', 'json']);
    assert.strictEqual(r.code, 0);
    const parsed = JSON.parse(r.stdout) as { command: string; status: string };
    // Phase 5 / Iter 31 added project-config + install-targets checks
    // which warn in a clean cwd; the e2e expectation is exit 0 with
    // either 'ok' or 'warning'.
    assert.ok(parsed.status === 'ok' || parsed.status === 'warning');
    assert.strictEqual(parsed.command, 'doctor');
  });

  it('collection list reports FS.NOT_FOUND in a non-collections cwd', () => {
    // Run from a tmp directory without a `collections/` folder.
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'prc-e2e-'));
    try {
      const proc = spawnSync('node', [CLI_BIN, 'collection', 'list', '-o', 'json'], {
        cwd: tmp,
        encoding: 'utf8'
      });
      assert.strictEqual(proc.status, 1);
      const parsed = JSON.parse(proc.stdout ?? '{}') as {
        status: string; errors: { code: string }[];
      };
      assert.strictEqual(parsed.status, 'error');
      assert.strictEqual(parsed.errors[0].code, 'FS.NOT_FOUND');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('every Phase 4 noun-verb path is reachable (not "Command not found")', function reachableCheck() {
    // Spawning 10 commands at ~200ms each → bump timeout from 2s.

    this.timeout(15_000);
    const nounVerbs: [string, string][] = [
      ['collection', 'list'],
      ['collection', 'validate'],
      ['collection', 'affected'],
      ['collection', 'publish'],
      ['bundle', 'manifest'],
      ['bundle', 'build'],
      ['skill', 'new'],
      ['skill', 'validate'],
      ['version', 'compute'],
      ['hub', 'analyze'],
      // Phase 4 / Iter 22-30: framework command additions.
      ['config', 'list'],
      ['plugins', 'list'],
      ['target', 'list']
    ];
    // Phase 5 / Iter 35: install + target add/remove now have real
    // bodies. Reachability is tested by checking that --help renders
    // without error.
    for (const [noun, verb] of nounVerbs) {
      const r = runCli([noun, verb, '--help']);
      // Either help text or the legacy script's help banner shows;
      // the assertion is just that clipanion's "Command not found"
      // diagnostic does NOT appear.
      assert.ok(!r.stderr.includes('Command not found'),
        `${noun} ${verb}: stderr unexpectedly says "Command not found":\n${r.stderr}`);
    }
  });

  it('install command surface (Phase 5)', () => {
    const r = runCli(['install', '--help']);
    assert.ok(!r.stderr.includes('Command not found'));
  });

  it('index <verb> dispatches to the framework command', () => {
    const r = runCli(['index', 'stats', '--index', '/nonexistent/path']);
    // Should exit non-zero with the framework's RegistryError envelope
    // (INDEX.NOT_FOUND), proving the dispatcher wired to the new
    // command instead of the deleted legacy proxy.
    assert.notStrictEqual(r.code, 0);
    assert.ok(
      r.stderr.includes('INDEX.NOT_FOUND')
      || r.stdout.includes('INDEX.NOT_FOUND'),
      `index dispatch should surface INDEX.NOT_FOUND; got stdout=${r.stdout}; stderr=${r.stderr}`
    );
  });
});

/**
 * Phase 4 / Iter 45 — `--quiet` e2e smoke test.
 *
 * Verifies that `--quiet` suppresses stdout while leaving stderr
 * (deprecation warnings, RegistryError renderings) intact.
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

const run = (args: string[]): { code: number; stdout: string; stderr: string } => {
  const proc = spawnSync('node', [CLI_BIN, ...args], { encoding: 'utf8' });
  return { code: proc.status ?? 1, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' };
};

maybeDescribe('Phase 4 / Iter 45 — --quiet e2e', () => {
  it('--quiet suppresses doctor stdout but the command still runs (exit 0)', () => {
    const r = run(['doctor', '--quiet']);
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.stdout, '', `--quiet must produce empty stdout; got: ${r.stdout}`);
  });

  it('--quiet still suppresses stdout in error path (FS.NOT_FOUND)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-e2e-quiet-'));
    try {
      const proc = spawnSync(
        'node',
        [CLI_BIN, 'collection', 'list', '--cwd', tmp, '--quiet'],
        { encoding: 'utf8' }
      );
      assert.strictEqual(proc.status, 1);
      assert.strictEqual(proc.stdout, '');
      // stderr stays live: the FS.NOT_FOUND error is rendered there
      // by RegistryError.renderError in text mode.
      assert.ok((proc.stderr ?? '').includes('FS.NOT_FOUND'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

/**
 * Phase 4 / Iter 44 — `prompt-registry explain <CODE>` e2e smoke test.
 */
import * as assert from 'node:assert';
import {
  spawnSync,
} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const LIB_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CLI_BIN = path.join(LIB_ROOT, 'dist', 'cli', 'index.js');
const haveBuild = fs.existsSync(CLI_BIN);
const maybeDescribe = haveBuild ? describe : describe.skip;

const run = (args: string[]): { code: number; stdout: string; stderr: string } => {
  const proc = spawnSync('node', [CLI_BIN, ...args], { encoding: 'utf8' });
  return { code: proc.status ?? 1, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' };
};

maybeDescribe('Phase 4 / Iter 44 — explain e2e', () => {
  it('explain BUNDLE.NOT_FOUND prints text', () => {
    const r = run(['explain', 'BUNDLE.NOT_FOUND']);
    assert.strictEqual(r.code, 0);
    assert.ok(r.stdout.includes('BUNDLE.NOT_FOUND'));
    assert.ok(r.stdout.includes('Remediation'));
  });

  it('explain emits the JSON envelope when -o json', () => {
    const r = run(['explain', 'FS.NOT_FOUND', '-o', 'json']);
    assert.strictEqual(r.code, 0);
    const parsed = JSON.parse(r.stdout) as { data: { code: string } };
    assert.strictEqual(parsed.data.code, 'FS.NOT_FOUND');
  });

  it('explain rejects an unknown namespace with USAGE.MISSING_FLAG', () => {
    const r = run(['explain', 'XYZZY.SOMETHING', '-o', 'json']);
    assert.strictEqual(r.code, 1);
    const parsed = JSON.parse(r.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
  });
});

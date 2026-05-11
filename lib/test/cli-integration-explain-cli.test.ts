import {
  spawnSync,
} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  describe,
  expect,
  it,
} from 'vitest';

const LIB_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI_BIN = path.join(LIB_ROOT, 'dist', 'cli', 'index.js');
const haveBuild = fs.existsSync(CLI_BIN);
const maybeDescribe = haveBuild ? describe : describe.skip;

const run = (args: string[]): { code: number; stdout: string; stderr: string } => {
  const proc = spawnSync('node', [CLI_BIN, ...args], { encoding: 'utf8' });
  return { code: proc.status ?? 1, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' };
};

maybeDescribe('explain e2e', () => {
  it('explain BUNDLE.NOT_FOUND prints text', () => {
    const r = run(['explain', 'BUNDLE.NOT_FOUND']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('BUNDLE.NOT_FOUND');
    expect(r.stdout).toContain('Remediation');
  });

  it('explain emits the JSON envelope when -o json', () => {
    const r = run(['explain', 'FS.NOT_FOUND', '-o', 'json']);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout) as { data: { code: string } };
    expect(parsed.data.code).toBe('FS.NOT_FOUND');
  });

  it('explain rejects an unknown namespace with USAGE.MISSING_FLAG', () => {
    const r = run(['explain', 'XYZZY.SOMETHING', '-o', 'json']);
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });
});

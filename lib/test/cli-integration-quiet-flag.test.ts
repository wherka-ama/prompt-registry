import {
  spawnSync,
} from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
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

maybeDescribe('--quiet e2e', () => {
  it('--quiet suppresses doctor stdout but the command still runs (exit 0)', () => {
    const r = run(['doctor', '--quiet']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('--quiet still suppresses stdout in error path (FS.NOT_FOUND)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-e2e-quiet-'));
    try {
      const proc = spawnSync(
        'node',
        [CLI_BIN, 'collection', 'list', '--cwd', tmp, '--quiet'],
        { encoding: 'utf8' }
      );
      expect(proc.status).toBe(1);
      expect(proc.stdout).toBe('');
      expect(proc.stderr ?? '').toContain('FS.NOT_FOUND');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

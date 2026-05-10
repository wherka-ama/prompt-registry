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

const runCli = (args: string[]): { code: number; stdout: string; stderr: string } => {
  const proc = spawnSync('node', [CLI_BIN, ...args], { encoding: 'utf8' });
  return {
    code: proc.status ?? 1,
    stdout: proc.stdout ?? '',
    stderr: proc.stderr ?? ''
  };
};

const maybeDescribe = haveBuild ? describe : describe.skip;

maybeDescribe('end-to-end CLI smoke', () => {
  it('--help prints the binary banner', () => {
    const r = runCli(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('prompt-registry');
  });

  it('--version prints the version', () => {
    const r = runCli(['--version']);
    expect(r.code).toBe(0);
    expect(/\d+\.\d+\.\d+/.test(r.stdout)).toBe(true);
  });

  it('doctor runs and reports JSON when -o json is passed', () => {
    const r = runCli(['doctor', '-o', 'json']);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout) as { command: string; status: string };
    expect(parsed.status === 'ok' || parsed.status === 'warning').toBe(true);
    expect(parsed.command).toBe('doctor');
  });

  it('collection list reports FS.NOT_FOUND in a non-collections cwd', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prc-e2e-'));
    try {
      const proc = spawnSync('node', [CLI_BIN, 'collection', 'list', '-o', 'json'], {
        cwd: tmp,
        encoding: 'utf8'
      });
      expect(proc.status).toBe(1);
      const parsed = JSON.parse(proc.stdout ?? '{}') as {
        status: string; errors: { code: string }[];
      };
      expect(parsed.status).toBe('error');
      expect(parsed.errors[0].code).toBe('FS.NOT_FOUND');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('every Phase 4 noun-verb path is reachable (not "Command not found")', () => {
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
      ['config', 'list'],
      ['plugins', 'list'],
      ['target', 'list']
    ];
    for (const [noun, verb] of nounVerbs) {
      const r = runCli([noun, verb, '--help']);
      expect(r.stderr.includes('Command not found')).toBe(false);
    }
  }, 15_000);

  it('install command surface (Phase 5)', () => {
    const r = runCli(['install', '--help']);
    expect(r.stderr.includes('Command not found')).toBe(false);
  });

  it('index <verb> dispatches to the framework command', () => {
    const r = runCli(['index', 'stats', '--index', '/nonexistent/path']);
    expect(r.code).not.toBe(0);
    expect(
      r.stderr.includes('INDEX.NOT_FOUND')
      || r.stdout.includes('INDEX.NOT_FOUND')
    ).toBe(true);
  });
});

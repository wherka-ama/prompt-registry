import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  createIndexReportCommand,
} from '../src/cli/commands/index-report';
import {
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

let tmpRoot: string;
let progressFile: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-idx-report-'));
  progressFile = path.join(tmpRoot, 'progress.jsonl');
  const lines = [
    JSON.stringify({ kind: 'start', sourceId: 'src-a', bundleId: 'bun-a', commitSha: 'abcdef0', ts: 1 }),
    JSON.stringify({ kind: 'done', sourceId: 'src-a', bundleId: 'bun-a', commitSha: 'abcdef0', ts: 2, primitives: 5, ms: 100 }),
    JSON.stringify({ kind: 'start', sourceId: 'src-b', bundleId: 'bun-b', commitSha: '1234567', ts: 3 }),
    JSON.stringify({ kind: 'error', sourceId: 'src-b', bundleId: 'bun-b', commitSha: '1234567', ts: 4, error: 'boom' })
  ];
  fs.writeFileSync(progressFile, lines.join('\n') + '\n', 'utf8');
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe('cli `index report`', () => {
  it('-o json emits the canonical envelope with summary + bundles[]', async () => {
    const { exitCode, stdout, stderr } = await runCommand(
      ['index', 'report'],
      {
        commands: [createIndexReportCommand({ progressFile, output: 'json' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.command).toBe('index.report');
    expect(env.data.summary.done).toBe(1);
    expect(env.data.summary.error).toBe(1);
    expect(env.data.summary.primitives).toBe(5);
    expect(env.data.bundles.length).toBe(2);
  });

  it('text output renders a markdown table', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'report'],
      {
        commands: [createIndexReportCommand({ progressFile, output: 'text' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Hub harvest report/i);
    expect(stdout).toMatch(/\| Source \| Bundle \|/);
    expect(stdout).toMatch(/src-a/);
    expect(stdout).toMatch(/src-b/);
    expect(stdout).toMatch(/boom/);
  });

  it('missing progress file produces INDEX.NOT_FOUND', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'report'],
      {
        commands: [createIndexReportCommand({
          progressFile: path.join(tmpRoot, 'nope.jsonl'),
          output: 'json'
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    expect(env.data.summary.done).toBe(0);
  });
});

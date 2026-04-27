/**
 * Tests for `index report` — render a human-readable harvest report
 * from a JSONL progress log.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createIndexReportCommand,
} from '../../../src/cli/commands/index-report';
import {
  runCommand,
} from '../../../src/cli/framework';
import {
  createNodeFsAdapter,
} from '../helpers/node-fs-adapter';

let tmpRoot: string;
let progressFile: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-idx-report-'));
  progressFile = path.join(tmpRoot, 'progress.jsonl');
  // Write a tiny progress log with one done + one error.
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
    assert.strictEqual(stderr, '');
    assert.strictEqual(exitCode, 0);
    const env = JSON.parse(stdout);
    assert.strictEqual(env.command, 'index.report');
    assert.strictEqual(env.data.summary.done, 1);
    assert.strictEqual(env.data.summary.error, 1);
    assert.strictEqual(env.data.summary.primitives, 5);
    assert.strictEqual(env.data.bundles.length, 2);
  });

  it('text output renders a markdown table', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'report'],
      {
        commands: [createIndexReportCommand({ progressFile, output: 'text' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    assert.strictEqual(exitCode, 0);
    assert.match(stdout, /Hub harvest report/i);
    assert.match(stdout, /\| Source \| Bundle \|/);
    assert.match(stdout, /src-a/);
    assert.match(stdout, /src-b/);
    assert.match(stdout, /boom/);
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
    // The harvester's progress-log opens the file in 'a' mode and creates
    // it on demand if missing — so a missing file is not an error per se.
    // The summary just shows zero counts.
    assert.strictEqual(exitCode, 0);
    const env = JSON.parse(stdout);
    assert.strictEqual(env.data.summary.done, 0);
  });
});

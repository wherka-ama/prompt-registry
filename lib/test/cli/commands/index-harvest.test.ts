/**
 * Tests for `index harvest`.
 *
 * The full network path is covered by `test/primitive-index/hub-harvester.test.ts`;
 * here we only assert the framework wiring: option validation, error
 * envelope, and that an injected pipeline runner is called with the
 * mapped options.
 */
import * as assert from 'node:assert';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createIndexHarvestCommand,
} from '../../../src/cli/commands/index-harvest';
import {
  runCommand,
} from '../../../src/cli/framework';
import {
  createNodeFsAdapter,
} from '../helpers/node-fs-adapter';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-idx-harvest-'));
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe('cli `index harvest`', () => {
  it('happy path: invokes the injected pipeline and emits envelope', async () => {
    let captured: unknown;
    const { exitCode, stdout, stderr } = await runCommand(
      ['index', 'harvest'],
      {
        commands: [createIndexHarvestCommand({
          hubRepo: 'owner/repo',
          output: 'json',
          // Test seam: bypass the real network pipeline.
          runPipeline: async (pOpts) => {
            captured = pOpts;
            return {
              outFile: path.join(tmpRoot, 'idx.json'),
              progressFile: path.join(tmpRoot, 'progress.jsonl'),
              cacheDir: tmpRoot,
              stats: {
                primitives: 7, byKind: { prompt: 7 }, bySource: { repo: 7 },
                bundles: 1, shortlists: 0, builtAt: '1970-01-01T00:00:00.000Z'
              },
              totals: { totalMs: 1, done: 1, error: 0, skip: 0, primitives: 7, wallMs: 1 },
              hub: { repo: 'owner/repo', branch: 'main', sources: 1 },
              rateLimit: { limit: undefined, remaining: undefined, used: undefined, resetAt: undefined },
              tokenSource: 'env:GITHUB_TOKEN'
            };
          }
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    assert.strictEqual(stderr, '');
    assert.strictEqual(exitCode, 0);
    const env = JSON.parse(stdout);
    assert.strictEqual(env.command, 'index.harvest');
    assert.strictEqual(env.data.totals.primitives, 7);
    assert.deepStrictEqual((captured as { hubRepo: string }).hubRepo, 'owner/repo');
  });

  it('text output prints a one-liner', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'harvest'],
      {
        commands: [createIndexHarvestCommand({
          hubRepo: 'owner/repo',
          output: 'text',
          runPipeline: async () => ({
            outFile: '/x', progressFile: '/p', cacheDir: '/c',
            stats: {
              primitives: 3, byKind: {}, bySource: {}, bundles: 1,
              shortlists: 0, builtAt: '1970-01-01T00:00:00.000Z'
            },
            totals: { totalMs: 0, done: 1, error: 0, skip: 0, primitives: 3, wallMs: 0 },
            hub: { repo: 'owner/repo', branch: 'main', sources: 1 },
            rateLimit: {
              limit: undefined, remaining: undefined,
              used: undefined, resetAt: undefined
            },
            tokenSource: 'env'
          })
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    assert.strictEqual(exitCode, 0);
    assert.match(stdout, /done=1/);
    assert.match(stdout, /primitives=3/);
  });

  it('non-zero exit when totals.error > 0', async () => {
    const { exitCode } = await runCommand(
      ['index', 'harvest'],
      {
        commands: [createIndexHarvestCommand({
          hubRepo: 'owner/repo',
          output: 'json',
          runPipeline: async () => ({
            outFile: '/x', progressFile: '/p', cacheDir: '/c',
            stats: {
              primitives: 0, byKind: {}, bySource: {}, bundles: 0,
              shortlists: 0, builtAt: '1970-01-01T00:00:00.000Z'
            },
            totals: { totalMs: 0, done: 0, error: 2, skip: 0, primitives: 0, wallMs: 0 },
            hub: { repo: 'owner/repo', branch: 'main', sources: 0 },
            rateLimit: {
              limit: undefined, remaining: undefined,
              used: undefined, resetAt: undefined
            },
            tokenSource: 'env'
          })
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    assert.strictEqual(exitCode, 1);
  });

  it('pipeline throw is wrapped as INDEX.HARVEST_FAILED', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'harvest'],
      {
        commands: [createIndexHarvestCommand({
          hubRepo: 'owner/repo',
          output: 'json',
          runPipeline: async () => {
            throw new Error('boom');
          }
        })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    assert.strictEqual(exitCode, 1);
    const env = JSON.parse(stdout);
    assert.strictEqual(env.errors[0].code, 'INDEX.HARVEST_FAILED');
  });

  it('missing hubRepo without --no-hub-config / --hub-config-file errors', async () => {
    const { exitCode, stdout } = await runCommand(
      ['index', 'harvest'],
      {
        commands: [createIndexHarvestCommand({ output: 'json' })],
        context: { cwd: tmpRoot, fs: createNodeFsAdapter() }
      }
    );
    assert.strictEqual(exitCode, 1);
    const env = JSON.parse(stdout);
    assert.strictEqual(env.errors[0].code, 'USAGE.MISSING_FLAG');
  });
});

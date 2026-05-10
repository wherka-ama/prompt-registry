/**
 * Phase 4 / Iter 2 — `collection validate` subcommand.
 *
 * Replaces `lib/bin/validate-collections.js`. Validates every
 * `*.collection.yml` under `<cwd>/collections/` (or a caller-supplied
 * subset) and reports the result through the framework's output
 * formatter.
 *
 * Iter-2 scope:
 *   - JSON envelope shape pinned for machine consumers.
 *   - Text mode mirrors the legacy script's per-file ✓/❌ summary on
 *     stderr/stdout.
 *   - Exit code 0 when all collections pass; 1 otherwise.
 *
 * Markdown PR-comment generation (`--output-markdown FILE`) is the
 * legacy binary's most distinctive feature. It is preserved as a
 * factory option (`markdownPath`) until iter 8 wires real CLI flags
 * via clipanion; the JSON envelope already carries the validation
 * result so a CI step can compute markdown elsewhere if needed.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createCollectionValidateCommand,
} from '../../../src/cli/commands/collection-validate';
import {
  type FsAbstraction,
  runCommand,
} from '../../../src/cli/framework';
import {
  createNodeFsAdapter,
} from '../helpers/node-fs-adapter';

let tmpRoot: string;
let realFs: FsAbstraction;

const VALID_COLLECTION = `id: alpha
name: Alpha
description: A valid collection
version: 1.0.0
items: []
`;

const INVALID_COLLECTION = `name: Missing Id On Purpose
items: []
`;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-coll-val-'));
  await fs.mkdir(path.join(tmpRoot, 'collections'), { recursive: true });
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('Phase 4 / Iter 2 — collection validate', () => {
  it('exits 0 and reports ok when every collection is valid', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      VALID_COLLECTION
    );
    const result = await runCommand(['collection', 'validate'], {
      commands: [createCollectionValidateCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as {
      command: string;
      status: string;
      data: { ok: boolean; totalFiles: number };
    };
    assert.strictEqual(parsed.command, 'collection.validate');
    assert.strictEqual(parsed.status, 'ok');
    assert.strictEqual(parsed.data.ok, true);
    assert.strictEqual(parsed.data.totalFiles, 1);
  });

  it('exits 1 and reports the per-file error list when invalid', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'bad.collection.yml'),
      INVALID_COLLECTION
    );
    const result = await runCommand(['collection', 'validate'], {
      commands: [createCollectionValidateCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as {
      status: string;
      data: { ok: boolean; fileResults: { file: string; ok: boolean; errors: string[] }[] };
    };
    assert.strictEqual(parsed.status, 'error');
    assert.strictEqual(parsed.data.ok, false);
    const bad = parsed.data.fileResults.find((r) => r.file.includes('bad'));
    assert.ok(bad !== undefined && bad.ok === false);
    assert.ok(bad.errors.length > 0);
  });

  it('text mode prints a per-file summary and a final tally line', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      VALID_COLLECTION
    );
    const result = await runCommand(['collection', 'validate'], {
      commands: [createCollectionValidateCommand()],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes('1 collection'),
      `tally should mention collection count; got: ${result.stdout}`);
    assert.ok(result.stdout.includes('valid'));
  });

  it('writes a PR-comment markdown file when markdownPath is set', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      VALID_COLLECTION
    );
    const mdPath = path.join(tmpRoot, 'report.md');
    const result = await runCommand(['collection', 'validate'], {
      commands: [createCollectionValidateCommand({ markdownPath: mdPath })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0);
    const md = await fs.readFile(mdPath, 'utf8');
    assert.ok(md.includes('Collection Validation Results'),
      `markdown should include section header; got first 100 chars: ${md.slice(0, 100)}`);
  });

  it('exits 1 with a FS.NOT_FOUND error when collections/ is missing', async () => {
    await fs.rm(path.join(tmpRoot, 'collections'), { recursive: true });
    const result = await runCommand(['collection', 'validate'], {
      commands: [createCollectionValidateCommand()],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 1);
    assert.ok(
      result.stderr.includes('FS.NOT_FOUND') || result.stderr.includes('not found'),
      `stderr should mention missing collections dir; got: ${result.stderr}`
    );
  });
});

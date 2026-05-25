import * as fs from 'node:fs/promises';
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
  CollectionValidateCommand,
  createCollectionValidateCommand,
} from '../src/cli/commands/collection-validate';
import {
  type FsAbstraction,
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

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

describe('collection validate', () => {
  it('exits 0 and reports ok when every collection is valid', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      VALID_COLLECTION
    );
    const result = await runCommand(['collection', 'validate'], {
      commands: [createCollectionValidateCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      command: string;
      status: string;
      data: { ok: boolean; totalFiles: number };
    };
    expect(parsed.command).toBe('collection.validate');
    expect(parsed.status).toBe('ok');
    expect(parsed.data.ok).toBe(true);
    expect(parsed.data.totalFiles).toBe(1);
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
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      status: string;
      data: { ok: boolean; fileResults: { file: string; ok: boolean; errors: string[] }[] };
    };
    expect(parsed.status).toBe('error');
    expect(parsed.data.ok).toBe(false);
    const bad = parsed.data.fileResults.find((r) => r.file.includes('bad'));
    expect(bad !== undefined && bad.ok === false).toBe(true);
    expect(bad?.errors.length).toBeGreaterThan(0);
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
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/1 collection/);
    expect(result.stdout).toMatch(/valid/);
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
    expect(result.exitCode).toBe(0);
    const md = await fs.readFile(mdPath, 'utf8');
    expect(md).toMatch(/Collection Validation Results/);
  });

  it('exits 1 with a FS.NOT_FOUND error when collections/ is missing', async () => {
    await fs.rm(path.join(tmpRoot, 'collections'), { recursive: true });
    const result = await runCommand(['collection', 'validate'], {
      commands: [createCollectionValidateCommand()],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/FS\.NOT_FOUND|not found/);
  });

  it('validates explicit collection files when collectionFiles option is set', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      VALID_COLLECTION
    );
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'beta.collection.yml'),
      INVALID_COLLECTION
    );
    const result = await runCommand(['collection', 'validate'], {
      commands: [createCollectionValidateCommand({
        output: 'json',
        collectionFiles: ['collections/alpha.collection.yml']
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { totalFiles: number };
    };
    expect(parsed.data.totalFiles).toBe(1);
  });

  it('verbose mode prints each ok file in text output', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      VALID_COLLECTION
    );
    const result = await runCommand(['collection', 'validate'], {
      commands: [createCollectionValidateCommand({
        verbose: true
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\[ OK \]/);
    expect(result.stdout).toContain('alpha.collection.yml');
  });

  it('handles cross-collection duplicate errors in text output', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      'id: alpha\nname: Alpha\nversion: 1.0.0\nitems: []\n'
    );
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'beta.collection.yml'),
      'id: alpha\nname: Beta\nversion: 1.0.0\nitems: []\n'
    );
    const result = await runCommand(['collection', 'validate'], {
      commands: [createCollectionValidateCommand()],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/Duplicate collection/);
  });
});

describe('CollectionValidateCommand (native class)', () => {
  it('exits 0 for valid collection', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      VALID_COLLECTION
    );
    const result = await runCommand(
      ['collection', 'validate', '-o', 'json'],
      { commandClasses: [CollectionValidateCommand], context: { cwd: tmpRoot, fs: realFs } }
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string; data: { ok: boolean } };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.ok).toBe(true);
  });

  it('exits 1 when collections/ missing', async () => {
    await fs.rm(path.join(tmpRoot, 'collections'), { recursive: true });
    const result = await runCommand(
      ['collection', 'validate'],
      { commandClasses: [CollectionValidateCommand], context: { cwd: tmpRoot, fs: realFs } }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/FS\.NOT_FOUND|not found/);
  });

  it('exits 1 for invalid collection', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'bad.collection.yml'),
      INVALID_COLLECTION
    );
    const result = await runCommand(
      ['collection', 'validate', '-o', 'json'],
      { commandClasses: [CollectionValidateCommand], context: { cwd: tmpRoot, fs: realFs } }
    );
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { data: { ok: boolean } };
    expect(parsed.data.ok).toBe(false);
  });

  it('--verbose shows OK files in text mode', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      VALID_COLLECTION
    );
    const result = await runCommand(
      ['collection', 'validate', '--verbose'],
      { commandClasses: [CollectionValidateCommand], context: { cwd: tmpRoot, fs: realFs } }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\[ OK \]/);
  });

  it('--collection-file validates only specified file', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      VALID_COLLECTION
    );
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'bad.collection.yml'),
      INVALID_COLLECTION
    );
    const result = await runCommand(
      ['collection', 'validate', '--collection-file', 'collections/alpha.collection.yml', '-o', 'json'],
      { commandClasses: [CollectionValidateCommand], context: { cwd: tmpRoot, fs: realFs } }
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: { totalFiles: number } };
    expect(parsed.data.totalFiles).toBe(1);
  });

  it('--markdown-path writes a markdown report', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
      VALID_COLLECTION
    );
    const mdPath = path.join(tmpRoot, 'report.md');
    await runCommand(
      ['collection', 'validate', '--markdown-path', mdPath],
      { commandClasses: [CollectionValidateCommand], context: { cwd: tmpRoot, fs: realFs } }
    );
    const md = await fs.readFile(mdPath, 'utf8');
    expect(md).toMatch(/Collection Validation Results/);
  });
});

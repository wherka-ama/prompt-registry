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
  createCollectionListCommand,
} from '../src/cli/commands/collection-list';
import {
  type FsAbstraction,
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

let tmpRoot: string;
let realFs: FsAbstraction;

const fixtureCollections: Record<string, string> = {
  'alpha.collection.yml': 'id: alpha\nname: Alpha\nitems: []\n',
  'beta.collection.yml': 'id: beta\nname: Beta\nitems: []\n',
  'README.md': '# noise'
};

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-coll-list-'));
  await fs.mkdir(path.join(tmpRoot, 'collections'), { recursive: true });
  for (const [name, body] of Object.entries(fixtureCollections)) {
    await fs.writeFile(path.join(tmpRoot, 'collections', name), body, 'utf8');
  }
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('collection list', () => {
  it('emits a JSON envelope with the discovered collections', async () => {
    const result = await runCommand(['collection', 'list'], {
      commands: [createCollectionListCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      command: string;
      status: string;
      data: { id: string; name: string; file: string }[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.command).toBe('collection.list');
    expect(parsed.status).toBe('ok');
    const ids = parsed.data.map((c) => c.id).toSorted();
    expect(ids).toStrictEqual(['alpha', 'beta']);
    for (const entry of parsed.data) {
      expect(entry.file).toMatch(/\.collection\.yml$/);
    }
  });

  it('emits one record per line in ndjson mode', async () => {
    const result = await runCommand(['collection', 'list'], {
      commands: [createCollectionListCommand({ output: 'ndjson' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines.length).toBe(2);
    const ids = lines.map((l) => (JSON.parse(l) as { id: string }).id).toSorted();
    expect(ids).toStrictEqual(['alpha', 'beta']);
  });

  it('text mode prints a stable one-collection-per-line summary', async () => {
    const result = await runCommand(['collection', 'list'], {
      commands: [createCollectionListCommand()],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/alpha/);
    expect(result.stdout).toMatch(/beta/);
    expect(result.stdout).toMatch(/alpha\.collection\.yml/);
  });

  it('exits with code 1 and renders an error when collections/ is missing', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-coll-list-empty-'));
    try {
      const result = await runCommand(['collection', 'list'], {
        commands: [createCollectionListCommand()],
        context: { cwd: empty, fs: realFs }
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/FS\.NOT_FOUND|collections|not found/);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });

  it('renders yaml output format', async () => {
    const result = await runCommand(['collection', 'list'], {
      commands: [createCollectionListCommand({ output: 'yaml' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('status: ok');
    expect(result.stdout).toContain('- id: alpha');
  });

  it('skips ill-formed YAML files', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'invalid.yml'),
      'not valid yaml: [unclosed'
    );
    const result = await runCommand(['collection', 'list'], {
      commands: [createCollectionListCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { id: string }[];
    };
    expect(parsed.data.length).toBe(2);
    expect(parsed.data.every((c) => ['alpha', 'beta'].includes(c.id))).toBe(true);
  });

  it('handles collections without id field', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'collections', 'no-id.collection.yml'),
      'name: No ID\nitems: []\n'
    );
    const result = await runCommand(['collection', 'list'], {
      commands: [createCollectionListCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { id: string; name: string }[];
    };
    const noId = parsed.data.find((c) => c.name === 'No ID');
    expect(noId !== undefined).toBe(true);
    expect(noId?.id).toBe('');
  });

  it('renders "no collections found" when directory is empty', async () => {
    await fs.rm(path.join(tmpRoot, 'collections', 'alpha.collection.yml'));
    await fs.rm(path.join(tmpRoot, 'collections', 'beta.collection.yml'));
    await fs.rm(path.join(tmpRoot, 'collections', 'README.md'));
    const result = await runCommand(['collection', 'list'], {
      commands: [createCollectionListCommand()],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('no collections found');
  });
});

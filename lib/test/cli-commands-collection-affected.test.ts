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
  createCollectionAffectedCommand,
} from '../src/cli/commands/collection-affected';
import {
  type FsAbstraction,
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

let tmpRoot: string;
let realFs: FsAbstraction;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-coll-aff-'));
  await fs.mkdir(path.join(tmpRoot, 'collections'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'prompts'), { recursive: true });
  await fs.writeFile(path.join(tmpRoot, 'prompts', 'foo.md'), '# foo\n');
  await fs.writeFile(path.join(tmpRoot, 'prompts', 'bar.md'), '# bar\n');
  await fs.writeFile(
    path.join(tmpRoot, 'collections', 'alpha.collection.yml'),
    'id: alpha\nname: Alpha\nversion: 1.0.0\nitems:\n  - path: prompts/foo.md\n    kind: prompt\n'
  );
  await fs.writeFile(
    path.join(tmpRoot, 'collections', 'beta.collection.yml'),
    'id: beta\nname: Beta\nversion: 1.0.0\nitems:\n  - path: prompts/bar.md\n    kind: prompt\n'
  );
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('collection affected', () => {
  it('emits empty list when no paths match', async () => {
    const result = await runCommand(['collection', 'affected'], {
      commands: [createCollectionAffectedCommand({
        output: 'json',
        changedPaths: ['unrelated/file.txt']
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { affected: { id: string; file: string }[] };
    };
    expect(parsed.data.affected).toStrictEqual([]);
  });

  it('flags a collection when its item path changes', async () => {
    const result = await runCommand(['collection', 'affected'], {
      commands: [createCollectionAffectedCommand({
        output: 'json',
        changedPaths: ['prompts/foo.md']
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { affected: { id: string; file: string }[] };
    };
    expect(parsed.data.affected.length).toBe(1);
    expect(parsed.data.affected[0].id).toBe('alpha');
  });

  it('flags a collection when the collection file itself changes', async () => {
    const result = await runCommand(['collection', 'affected'], {
      commands: [createCollectionAffectedCommand({
        output: 'json',
        changedPaths: ['collections/beta.collection.yml']
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { affected: { id: string }[] };
    };
    expect(parsed.data.affected.length).toBe(1);
    expect(parsed.data.affected[0].id).toBe('beta');
  });

  it('handles backslash-style and leading-slash paths consistently', async () => {
    const result = await runCommand(['collection', 'affected'], {
      commands: [createCollectionAffectedCommand({
        output: 'json',
        changedPaths: ['\\prompts\\foo.md', '/prompts/bar.md']
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    const parsed = JSON.parse(result.stdout) as {
      data: { affected: { id: string }[] };
    };
    const ids = parsed.data.affected.map((a) => a.id).toSorted();
    expect(ids).toStrictEqual(['alpha', 'beta']);
  });
});

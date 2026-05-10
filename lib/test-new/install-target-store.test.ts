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
import type {
  Target,
} from '../src/domain/install';
import {
  addTarget,
  findProjectConfigPath,
  readTargets,
  removeTargetByName,
  writeTargets,
} from '../src/install/target-store';
import {
  createNodeFsAdapter,
} from '../test/cli/helpers/node-fs-adapter';

const SAMPLE: Target = {
  name: 'sample',
  type: 'vscode',
  scope: 'user',
  path: '${HOME}/.config/Code',
  allowedKinds: ['prompt', 'instruction']
};

let tmp: string;
const realFs = createNodeFsAdapter();

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-tstore-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('target-store', () => {
  it('readTargets returns [] when no project config exists', async () => {
    const targets = await readTargets({ cwd: tmp, fs: realFs });
    expect(targets).toStrictEqual([]);
  });

  it('readTargets parses targets[] from prompt-registry.yml', async () => {
    await fs.writeFile(
      path.join(tmp, 'prompt-registry.yml'),
      'targets:\n  - name: a\n    type: vscode\n    scope: user\n'
    );
    const targets = await readTargets({ cwd: tmp, fs: realFs });
    expect(targets.length).toBe(1);
    expect(targets[0].name).toBe('a');
  });

  it('writeTargets creates the project config when missing', async () => {
    const result = await writeTargets({ cwd: tmp, fs: realFs }, [SAMPLE]);
    expect(result.created).toBe(true);
    const written = await fs.readFile(result.file, 'utf8');
    expect(written).toMatch(/sample/);
    expect(written).toMatch(/vscode/);
  });

  it('writeTargets preserves unrelated keys', async () => {
    const file = path.join(tmp, 'prompt-registry.yml');
    await fs.writeFile(file, 'logLevel: debug\ntargets: []\n');
    await writeTargets({ cwd: tmp, fs: realFs }, [SAMPLE]);
    const written = await fs.readFile(file, 'utf8');
    expect(written).toMatch(/logLevel/);
    expect(written).toMatch(/debug/);
    expect(written).toMatch(/sample/);
  });

  it('addTarget appends and rejects duplicates', async () => {
    await addTarget({ cwd: tmp, fs: realFs }, SAMPLE);
    await expect(
      addTarget({ cwd: tmp, fs: realFs }, SAMPLE)
    ).rejects.toThrow(/already exists/);
  });

  it('removeTargetByName removes and rejects unknown names', async () => {
    await addTarget({ cwd: tmp, fs: realFs }, SAMPLE);
    await removeTargetByName({ cwd: tmp, fs: realFs }, 'sample');
    const targets = await readTargets({ cwd: tmp, fs: realFs });
    expect(targets.length).toBe(0);
    await expect(
      removeTargetByName({ cwd: tmp, fs: realFs }, 'sample')
    ).rejects.toThrow(/not found/);
  });

  it('findProjectConfigPath walks upward (cargo style)', async () => {
    const sub = path.join(tmp, 'a', 'b', 'c');
    await fs.mkdir(sub, { recursive: true });
    await fs.writeFile(path.join(tmp, 'prompt-registry.yml'), 'targets: []\n');
    const { file, exists } = await findProjectConfigPath({ cwd: sub, fs: realFs });
    expect(exists).toBe(true);
    expect(file).toBe(path.join(tmp, 'prompt-registry.yml'));
  });
});

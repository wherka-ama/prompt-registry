/**
 * Phase 5 / Iter 5 — `target-store` unit tests.
 *
 * Covers the read/write helpers in isolation: cargo upward walk,
 * round-trip across the YAML loader, addTarget/removeTargetByName
 * happy + sad paths.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  Target,
} from '../../src/domain/install';
import {
  addTarget,
  findProjectConfigPath,
  readTargets,
  removeTargetByName,
  writeTargets,
} from '../../src/install/target-store';
import {
  createNodeFsAdapter,
} from '../cli/helpers/node-fs-adapter';

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

describe('Phase 5 / Iter 5 — target-store', () => {
  it('readTargets returns [] when no project config exists', async () => {
    const targets = await readTargets({ cwd: tmp, fs: realFs });
    assert.deepStrictEqual(targets, []);
  });

  it('readTargets parses targets[] from prompt-registry.yml', async () => {
    await fs.writeFile(
      path.join(tmp, 'prompt-registry.yml'),
      'targets:\n  - name: a\n    type: vscode\n    scope: user\n'
    );
    const targets = await readTargets({ cwd: tmp, fs: realFs });
    assert.strictEqual(targets.length, 1);
    assert.strictEqual(targets[0].name, 'a');
  });

  it('writeTargets creates the project config when missing', async () => {
    const result = await writeTargets({ cwd: tmp, fs: realFs }, [SAMPLE]);
    assert.strictEqual(result.created, true);
    const written = await fs.readFile(result.file, 'utf8');
    assert.ok(written.includes('sample'));
    assert.ok(written.includes('vscode'));
  });

  it('writeTargets preserves unrelated keys', async () => {
    const file = path.join(tmp, 'prompt-registry.yml');
    await fs.writeFile(file, 'logLevel: debug\ntargets: []\n');
    await writeTargets({ cwd: tmp, fs: realFs }, [SAMPLE]);
    const written = await fs.readFile(file, 'utf8');
    assert.ok(written.includes('logLevel'));
    assert.ok(written.includes('debug'));
    assert.ok(written.includes('sample'));
  });

  it('addTarget appends and rejects duplicates', async () => {
    await addTarget({ cwd: tmp, fs: realFs }, SAMPLE);
    await assert.rejects(
      () => addTarget({ cwd: tmp, fs: realFs }, SAMPLE),
      /already exists/
    );
  });

  it('removeTargetByName removes and rejects unknown names', async () => {
    await addTarget({ cwd: tmp, fs: realFs }, SAMPLE);
    await removeTargetByName({ cwd: tmp, fs: realFs }, 'sample');
    const targets = await readTargets({ cwd: tmp, fs: realFs });
    assert.strictEqual(targets.length, 0);
    await assert.rejects(
      () => removeTargetByName({ cwd: tmp, fs: realFs }, 'sample'),
      /not found/
    );
  });

  it('findProjectConfigPath walks upward (cargo style)', async () => {
    const sub = path.join(tmp, 'a', 'b', 'c');
    await fs.mkdir(sub, { recursive: true });
    await fs.writeFile(path.join(tmp, 'prompt-registry.yml'), 'targets: []\n');
    const { file, exists } = await findProjectConfigPath({ cwd: sub, fs: realFs });
    assert.strictEqual(exists, true);
    assert.strictEqual(file, path.join(tmp, 'prompt-registry.yml'));
  });
});

/**
 * Phase 4 / Iter 6 — `skill validate` subcommand tests.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createSkillValidateCommand,
} from '../../../src/cli/commands/skill-validate';
import {
  type FsAbstraction,
  runCommand,
} from '../../../src/cli/framework';
import {
  createNodeFsAdapter,
} from '../helpers/node-fs-adapter';

let tmpRoot: string;
let realFs: FsAbstraction;

const validSkillMd = `---
name: foo-skill
description: A valid example skill that demonstrates basic functionality.
---

# foo-skill

Body content.
`;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-skill-val-'));
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('Phase 4 / Iter 6 — skill validate', () => {
  it('returns ok when there are no skills to validate', async () => {
    const result = await runCommand(['skill', 'validate'], {
      commands: [createSkillValidateCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as { status: string; data: { totalSkills: number } };
    assert.strictEqual(parsed.status, 'ok');
    assert.strictEqual(parsed.data.totalSkills, 0);
  });

  it('returns ok when every skill folder validates', async () => {
    await fs.mkdir(path.join(tmpRoot, 'skills', 'foo-skill'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'skills', 'foo-skill', 'SKILL.md'), validSkillMd);
    const result = await runCommand(['skill', 'validate'], {
      commands: [createSkillValidateCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as { status: string; data: { validSkills: number } };
    assert.strictEqual(parsed.status, 'ok');
    assert.strictEqual(parsed.data.validSkills, 1);
  });

  it('exits 1 when a skill is invalid', async () => {
    await fs.mkdir(path.join(tmpRoot, 'skills', 'broken'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'skills', 'broken', 'SKILL.md'), '# missing frontmatter');
    const result = await runCommand(['skill', 'validate'], {
      commands: [createSkillValidateCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { status: string };
    assert.strictEqual(parsed.status, 'error');
  });
});

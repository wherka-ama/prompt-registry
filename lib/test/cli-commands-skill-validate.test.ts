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
  createSkillValidateCommand,
  createSkillValidateCommandClass,
  SkillValidateCommand,
} from '../src/cli/commands/skill-validate';
import {
  type FsAbstraction,
  runCommand,
} from '../src/cli/framework';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

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

describe('skill validate', () => {
  it('returns ok when there are no skills to validate', async () => {
    const result = await runCommand(['skill', 'validate'], {
      commands: [createSkillValidateCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string; data: { totalSkills: number } };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.totalSkills).toBe(0);
  });

  it('returns ok when every skill folder validates', async () => {
    await fs.mkdir(path.join(tmpRoot, 'skills', 'foo-skill'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'skills', 'foo-skill', 'SKILL.md'), validSkillMd);
    const result = await runCommand(['skill', 'validate'], {
      commands: [createSkillValidateCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string; data: { validSkills: number } };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.validSkills).toBe(1);
  });

  it('exits 1 when a skill is invalid', async () => {
    await fs.mkdir(path.join(tmpRoot, 'skills', 'broken'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'skills', 'broken', 'SKILL.md'), '# missing frontmatter');
    const result = await runCommand(['skill', 'validate'], {
      commands: [createSkillValidateCommand({ output: 'json' })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { status: string };
    expect(parsed.status).toBe('error');
  });

  it('SkillValidateCommand native class validates skills', async () => {
    await fs.mkdir(path.join(tmpRoot, 'skills', 'foo-skill'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'skills', 'foo-skill', 'SKILL.md'), validSkillMd);
    const result = await runCommand(['skill', 'validate', '-o', 'json'], {
      commandClasses: [SkillValidateCommand],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string };
    expect(parsed.status).toBe('ok');
  });

  it('createSkillValidateCommandClass factory validates with defaults', async () => {
    await fs.mkdir(path.join(tmpRoot, 'skills', 'foo-skill'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'skills', 'foo-skill', 'SKILL.md'), validSkillMd);
    const sharedContext = { cwd: tmpRoot, fs: realFs, env: {} };
    const result = await runCommand(['skill', 'validate', '-o', 'json'], {
      commandClasses: [createSkillValidateCommandClass(sharedContext as unknown as Parameters<typeof createSkillValidateCommandClass>[0])],
      context: sharedContext
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string };
    expect(parsed.status).toBe('ok');
  });

  it('SkillValidateCommand native class exits 1 on invalid skill', async () => {
    await fs.mkdir(path.join(tmpRoot, 'skills', 'badskill'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'skills', 'badskill', 'SKILL.md'), '# no frontmatter');
    const result = await runCommand(['skill', 'validate', '-o', 'json'], {
      commandClasses: [SkillValidateCommand],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { status: string };
    expect(parsed.status).toBe('error');
  });
});

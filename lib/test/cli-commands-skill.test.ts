import * as fsp from 'node:fs/promises';
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
  SkillNewCommand,
} from '../src/cli/commands/skill-new';
import {
  SkillValidateCommand,
} from '../src/cli/commands/skill-validate';
import {
  runCommand,
} from '../src/cli/framework';

let tmp: string;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-skill-cmd-'));
});

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

const VALID_SKILL_MD = `---
name: my-skill
description: "A test skill"
version: 1.0.0
---

# my-skill

A test skill.
`;

describe('skill validate', () => {
  it('returns valid=true with 0 skills when skills dir does not exist', async () => {
    const { exitCode, stdout } = await runCommand(
      ['skill', 'validate', '-o', 'json'],
      { commandClasses: [SkillValidateCommand], context: { cwd: tmp } }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { status: string; data: { totalSkills: number } };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.totalSkills).toBe(0);
  });

  it('returns valid=true when skills dir is empty', async () => {
    await fsp.mkdir(path.join(tmp, 'skills'), { recursive: true });
    const { exitCode, stdout } = await runCommand(
      ['skill', 'validate', '-o', 'json'],
      { commandClasses: [SkillValidateCommand], context: { cwd: tmp } }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { data: { totalSkills: number } };
    expect(parsed.data.totalSkills).toBe(0);
  });

  it('returns valid=true for a skill with valid SKILL.md', async () => {
    const skillDir = path.join(tmp, 'skills', 'my-skill');
    await fsp.mkdir(skillDir, { recursive: true });
    await fsp.writeFile(path.join(skillDir, 'SKILL.md'), VALID_SKILL_MD);

    const { exitCode, stdout } = await runCommand(
      ['skill', 'validate', '-o', 'json'],
      { commandClasses: [SkillValidateCommand], context: { cwd: tmp } }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { data: { totalSkills: number; validSkills: number } };
    expect(parsed.data.totalSkills).toBe(1);
    expect(parsed.data.validSkills).toBe(1);
  });

  it('returns exit 1 for a skill folder missing SKILL.md', async () => {
    const skillDir = path.join(tmp, 'skills', 'bad-skill');
    await fsp.mkdir(skillDir, { recursive: true });

    const { exitCode, stdout } = await runCommand(
      ['skill', 'validate', '-o', 'json'],
      { commandClasses: [SkillValidateCommand], context: { cwd: tmp } }
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout) as { data: { invalidSkills: number } };
    expect(parsed.data.invalidSkills).toBe(1);
  });

  it('text output shows validation summary', async () => {
    const { exitCode, stdout } = await runCommand(
      ['skill', 'validate'],
      { commandClasses: [SkillValidateCommand], context: { cwd: tmp } }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('0 skill');
  });

  it('--verbose shows OK skills in text mode', async () => {
    const skillDir = path.join(tmp, 'skills', 'my-skill');
    await fsp.mkdir(skillDir, { recursive: true });
    await fsp.writeFile(path.join(skillDir, 'SKILL.md'), VALID_SKILL_MD);

    const { exitCode, stdout } = await runCommand(
      ['skill', 'validate', '--verbose'],
      { commandClasses: [SkillValidateCommand], context: { cwd: tmp } }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('OK');
  });

  it('--skills-dir uses custom directory name', async () => {
    const skillDir = path.join(tmp, 'custom-skills', 'my-skill');
    await fsp.mkdir(skillDir, { recursive: true });
    await fsp.writeFile(path.join(skillDir, 'SKILL.md'), VALID_SKILL_MD);

    const { exitCode, stdout } = await runCommand(
      ['skill', 'validate', '--skills-dir', 'custom-skills', '-o', 'json'],
      { commandClasses: [SkillValidateCommand], context: { cwd: tmp } }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { data: { totalSkills: number } };
    expect(parsed.data.totalSkills).toBe(1);
  });
});

describe('skill new', () => {
  it('creates a skill with SKILL.md', async () => {
    const { exitCode, stdout } = await runCommand(
      ['skill', 'new', '--skill-name', 'my-skill', '--description', 'A test skill'],
      { commandClasses: [SkillNewCommand], context: { cwd: tmp } }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('my-skill');
    const exists = await fsp.access(path.join(tmp, 'skills', 'my-skill', 'SKILL.md')).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('json output shows skill name and path', async () => {
    const { exitCode, stdout } = await runCommand(
      ['skill', 'new', '--skill-name', 'my-skill', '--description', 'A test skill', '-o', 'json'],
      { commandClasses: [SkillNewCommand], context: { cwd: tmp } }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { data: { skillName: string; path: string } };
    expect(parsed.data.skillName).toBe('my-skill');
    expect(parsed.data.path).toContain('my-skill');
  });

  it('fails with exit 1 when skill already exists', async () => {
    await runCommand(
      ['skill', 'new', '--skill-name', 'my-skill', '--description', 'First'],
      { commandClasses: [SkillNewCommand], context: { cwd: tmp } }
    );
    const { exitCode } = await runCommand(
      ['skill', 'new', '--skill-name', 'my-skill', '--description', 'Duplicate', '-o', 'json'],
      { commandClasses: [SkillNewCommand], context: { cwd: tmp } }
    );
    expect(exitCode).toBe(1);
  });

  it('creates skill in custom --skills-dir', async () => {
    const { exitCode, stdout } = await runCommand(
      ['skill', 'new', '--skill-name', 'my-skill', '--description', 'A test skill', '--skills-dir', 'custom-skills'],
      { commandClasses: [SkillNewCommand], context: { cwd: tmp } }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('custom-skills');
  });

  it('fails with invalid skill name (empty)', async () => {
    const { exitCode } = await runCommand(
      ['skill', 'new', '--description', 'Test'],
      { commandClasses: [SkillNewCommand], context: { cwd: tmp } }
    );
    expect(exitCode).toBe(1);
  });

  it('json error output on failure', async () => {
    await runCommand(
      ['skill', 'new', '--skill-name', 'my-skill', '--description', 'First'],
      { commandClasses: [SkillNewCommand], context: { cwd: tmp } }
    );
    const { exitCode, stdout } = await runCommand(
      ['skill', 'new', '--skill-name', 'my-skill', '--description', 'Dup', '-o', 'json'],
      { commandClasses: [SkillNewCommand], context: { cwd: tmp } }
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout) as { status: string; errors: { code: string }[] };
    expect(parsed.status).toBe('error');
    expect(parsed.errors[0].code).toContain('PRIMITIVE');
  });
});

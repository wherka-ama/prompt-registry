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
  createSkillNewCommand,
  createSkillNewCommandClass,
  SkillNewCommand,
} from '../src/cli/commands/skill-new';
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
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-skill-new-'));
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('skill new', () => {
  it('creates a new skill folder + SKILL.md', async () => {
    const result = await runCommand(['skill', 'new'], {
      commands: [createSkillNewCommand({
        output: 'json',
        skillName: 'pdf-summarizer',
        description: 'Summarizes a PDF into bullet points'
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(0);
    const skillMd = await fs.readFile(path.join(tmpRoot, 'skills', 'pdf-summarizer', 'SKILL.md'), 'utf8');
    expect(skillMd).toMatch(/pdf-summarizer/);
  });

  it('exits 1 with PRIMITIVE.ALREADY_EXISTS when skill folder exists', async () => {
    await fs.mkdir(path.join(tmpRoot, 'skills', 'dup'), { recursive: true });
    const result = await runCommand(['skill', 'new'], {
      commands: [createSkillNewCommand({
        output: 'json',
        skillName: 'dup',
        description: 'Already-there skill'
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('PRIMITIVE.ALREADY_EXISTS');
  });

  it('rejects invalid skill names', async () => {
    const result = await runCommand(['skill', 'new'], {
      commands: [createSkillNewCommand({
        output: 'json',
        skillName: 'Invalid Name With Spaces',
        description: 'Has whitespace'
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toMatch(/^PRIMITIVE\./);
  });

  it('SkillNewCommand native class creates a skill', async () => {
    const result = await runCommand(
      ['skill', 'new', '--skill-name', 'my-skill', '--description', 'A valid description for the skill', '-o', 'json'],
      {
        commandClasses: [SkillNewCommand],
        context: { cwd: tmpRoot, fs: realFs }
      }
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string; data: { skillName: string } };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.skillName).toBe('my-skill');
  });

  it('createSkillNewCommandClass factory creates a skill with defaults', async () => {
    const sharedCtx = { cwd: tmpRoot, fs: realFs, env: {} };
    const result = await runCommand(
      ['skill', 'new', '--skill-name', 'my-skill2', '--description', 'Another valid description for the skill', '-o', 'json'],
      {
        commandClasses: [createSkillNewCommandClass(sharedCtx as unknown as Parameters<typeof createSkillNewCommandClass>[0])],
        context: sharedCtx
      }
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string };
    expect(parsed.status).toBe('ok');
  });
});

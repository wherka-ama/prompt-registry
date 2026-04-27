/**
 * Phase 4 / Iter 5 — `skill new` subcommand tests.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createSkillNewCommand,
} from '../../../src/cli/commands/skill-new';
import {
  type FsAbstraction,
  runCommand,
} from '../../../src/cli/framework';
import {
  createNodeFsAdapter,
} from '../helpers/node-fs-adapter';

let tmpRoot: string;
let realFs: FsAbstraction;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-skill-new-'));
  realFs = createNodeFsAdapter();
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('Phase 4 / Iter 5 — skill new', () => {
  it('creates a new skill folder + SKILL.md', async () => {
    const result = await runCommand(['skill', 'new'], {
      commands: [createSkillNewCommand({
        output: 'json',
        skillName: 'pdf-summarizer',
        description: 'Summarizes a PDF into bullet points'
      })],
      context: { cwd: tmpRoot, fs: realFs }
    });
    assert.strictEqual(result.exitCode, 0);
    const skillMd = await fs.readFile(path.join(tmpRoot, 'skills', 'pdf-summarizer', 'SKILL.md'), 'utf8');
    assert.ok(skillMd.includes('pdf-summarizer'),
      `SKILL.md should reference the skill name; got: ${skillMd.slice(0, 100)}`);
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
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'PRIMITIVE.ALREADY_EXISTS');
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
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.ok(parsed.errors[0].code.startsWith('PRIMITIVE.'),
      `error code should be in PRIMITIVE namespace; got ${parsed.errors[0].code}`);
  });
});

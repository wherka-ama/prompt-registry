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
  RepositoryScopeWriter,
} from '../src/infra/writers/repo-scope-writer';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

let tmp: string;
const realFs = createNodeFsAdapter();

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-repo-writer-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const SAMPLE_MANIFEST = `id: test-bundle
version: 1.0.0
name: Test Bundle
description: A test bundle
prompts:
  - id: test-prompt
    file: prompts/test.md
    type: prompt
instructions:
  - id: test-instruction
    file: instructions/test.md
    type: instruction
agents:
  - id: test-agent
    file: agents/test.md
    type: agent
skills:
  - id: test-skill
    file: skills/test-skill/skill.json
    type: skill`;

describe('RepositoryScopeWriter', () => {
  it('writes prompts to .github/copilot/prompts/', async () => {
    const writer = new RepositoryScopeWriter({
      fs: realFs,
      workspaceRoot: tmp,
      commitMode: 'commit'
    });

    const files = new Map<string, Uint8Array>([
      ['deployment-manifest.yml', new TextEncoder().encode(SAMPLE_MANIFEST)],
      ['prompts/test.md', new TextEncoder().encode('# Test Prompt')]
    ]);

    const result = await writer.write(files);

    expect(result.written).toContain(path.join(tmp, '.github', 'copilot', 'prompts', 'test.md'));
    expect(await realFs.exists(path.join(tmp, '.github', 'copilot', 'prompts', 'test.md'))).toBe(true);
  });

  it('writes instructions to .github/copilot/instructions/', async () => {
    const writer = new RepositoryScopeWriter({
      fs: realFs,
      workspaceRoot: tmp,
      commitMode: 'commit'
    });

    const files = new Map<string, Uint8Array>([
      ['deployment-manifest.yml', new TextEncoder().encode(SAMPLE_MANIFEST)],
      ['instructions/test.md', new TextEncoder().encode('# Test Instruction')]
    ]);

    const result = await writer.write(files);

    expect(result.written).toContain(path.join(tmp, '.github', 'copilot', 'instructions', 'test.md'));
    expect(await realFs.exists(path.join(tmp, '.github', 'copilot', 'instructions', 'test.md'))).toBe(true);
  });

  it('writes agents to .github/copilot/agents/', async () => {
    const writer = new RepositoryScopeWriter({
      fs: realFs,
      workspaceRoot: tmp,
      commitMode: 'commit'
    });

    const files = new Map<string, Uint8Array>([
      ['deployment-manifest.yml', new TextEncoder().encode(SAMPLE_MANIFEST)],
      ['agents/test.md', new TextEncoder().encode('# Test Agent')]
    ]);

    const result = await writer.write(files);

    expect(result.written).toContain(path.join(tmp, '.github', 'copilot', 'agents', 'test.md'));
    expect(await realFs.exists(path.join(tmp, '.github', 'copilot', 'agents', 'test.md'))).toBe(true);
  });

  it('writes skills to .github/skills/<skill-id>/', async () => {
    const writer = new RepositoryScopeWriter({
      fs: realFs,
      workspaceRoot: tmp,
      commitMode: 'commit'
    });

    const files = new Map<string, Uint8Array>([
      ['deployment-manifest.yml', new TextEncoder().encode(SAMPLE_MANIFEST)],
      ['skills/test-skill/skill.json', new TextEncoder().encode('{"name": "Test Skill"}')],
      ['skills/test-skill/api.ts', new TextEncoder().encode('// API code')]
    ]);

    const result = await writer.write(files);

    expect(result.skillDirs).toContain(path.join(tmp, '.github', 'skills', 'test-skill'));
    expect(await realFs.exists(path.join(tmp, '.github', 'skills', 'test-skill', 'skill.json'))).toBe(true);
    expect(await realFs.exists(path.join(tmp, '.github', 'skills', 'test-skill', 'api.ts'))).toBe(true);
  });

  it('returns empty result when manifest is missing', async () => {
    const writer = new RepositoryScopeWriter({
      fs: realFs,
      workspaceRoot: tmp,
      commitMode: 'commit'
    });

    const files = new Map<string, Uint8Array>([
      ['prompts/test.md', new TextEncoder().encode('# Test Prompt')]
    ]);

    const result = await writer.write(files);

    expect(result.written).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.skillDirs).toEqual([]);
  });

  it('adds files to .git/info/exclude in local-only mode', async () => {
    const writer = new RepositoryScopeWriter({
      fs: realFs,
      workspaceRoot: tmp,
      commitMode: 'local-only'
    });

    const files = new Map<string, Uint8Array>([
      ['deployment-manifest.yml', new TextEncoder().encode(SAMPLE_MANIFEST)],
      ['prompts/test.md', new TextEncoder().encode('# Test Prompt')]
    ]);

    await writer.write(files);

    const excludePath = path.join(tmp, '.git', 'info', 'exclude');
    expect(await realFs.exists(excludePath)).toBe(true);

    const content = await realFs.readFile(excludePath);
    expect(content).toContain('# Prompt Registry (local)');
  });

  it('does not add files to .git/info/exclude in commit mode', async () => {
    const writer = new RepositoryScopeWriter({
      fs: realFs,
      workspaceRoot: tmp,
      commitMode: 'commit'
    });

    const files = new Map<string, Uint8Array>([
      ['deployment-manifest.yml', new TextEncoder().encode(SAMPLE_MANIFEST)],
      ['prompts/test.md', new TextEncoder().encode('# Test Prompt')]
    ]);

    await writer.write(files);

    const excludePath = path.join(tmp, '.git', 'info', 'exclude');
    expect(await realFs.exists(excludePath)).toBe(false);
  });

  it('removes a single file', async () => {
    const writer = new RepositoryScopeWriter({
      fs: realFs,
      workspaceRoot: tmp,
      commitMode: 'commit'
    });

    const testFile = path.join(tmp, '.github', 'copilot', 'prompts', 'test.md');
    await fs.mkdir(path.dirname(testFile), { recursive: true });
    await fs.writeFile(testFile, '# Test');

    await writer.removeFile('copilot/prompts/test.md');

    expect(await realFs.exists(testFile)).toBe(false);
  });

  it('removes files for a bundle from manifest', async () => {
    const writer = new RepositoryScopeWriter({
      fs: realFs,
      workspaceRoot: tmp,
      commitMode: 'commit'
    });

    // Create test files
    const promptFile = path.join(tmp, '.github', 'copilot', 'prompts', 'test.md');
    await fs.mkdir(path.dirname(promptFile), { recursive: true });
    await fs.writeFile(promptFile, '# Test');

    const manifest = {
      id: 'test-bundle',
      prompts: [{ id: 'test-prompt', file: 'prompts/test.md', type: 'prompt' }]
    };

    await writer.remove('test-bundle', manifest);

    expect(await realFs.exists(promptFile)).toBe(false);
  });

  it('removes skill directories', async () => {
    const writer = new RepositoryScopeWriter({
      fs: realFs,
      workspaceRoot: tmp,
      commitMode: 'commit'
    });

    // Create skill directory
    const skillDir = path.join(tmp, '.github', 'skills', 'test-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'skill.json'), '{"name": "Test"}');

    const manifest = {
      id: 'test-bundle',
      skills: [{ id: 'test-skill', file: 'skills/test-skill/skill.json', type: 'skill' }]
    };

    await writer.remove('test-bundle', manifest);

    expect(await realFs.exists(skillDir)).toBe(false);
  });

  it('removes from .git/info/exclude in local-only mode', async () => {
    const writer = new RepositoryScopeWriter({
      fs: realFs,
      workspaceRoot: tmp,
      commitMode: 'local-only'
    });

    // Create .git/info/exclude with test file
    const excludePath = path.join(tmp, '.git', 'info', 'exclude');
    await fs.mkdir(path.dirname(excludePath), { recursive: true });
    await fs.writeFile(excludePath, '# Prompt Registry (local)\n.github/copilot/prompts/test.md');

    const manifest = {
      id: 'test-bundle',
      prompts: [{ id: 'test-prompt', file: 'prompts/test.md', type: 'prompt' }]
    };

    await writer.remove('test-bundle', manifest);

    const content = await realFs.readFile(excludePath);
    expect(content).not.toContain('.github/copilot/prompts/test.md');
  });

  it('switches commit mode from commit to local-only', async () => {
    const writer = new RepositoryScopeWriter({
      fs: realFs,
      workspaceRoot: tmp,
      commitMode: 'commit'
    });

    const paths = [path.join(tmp, '.github', 'copilot', 'prompts', 'test.md')];

    await writer.switchCommitMode(paths, 'local-only');

    const excludePath = path.join(tmp, '.git', 'info', 'exclude');
    expect(await realFs.exists(excludePath)).toBe(true);
  });

  it('switches commit mode from local-only to commit', async () => {
    const writer = new RepositoryScopeWriter({
      fs: realFs,
      workspaceRoot: tmp,
      commitMode: 'local-only'
    });

    // Add to exclude first
    const paths = [path.join(tmp, '.github', 'copilot', 'prompts', 'test.md')];
    await writer.switchCommitMode(paths, 'local-only');

    // Then switch to commit
    await writer.switchCommitMode(paths, 'commit');

    const excludePath = path.join(tmp, '.git', 'info', 'exclude');
    const content = await realFs.readFile(excludePath);
    expect(content).not.toContain('.github/copilot/prompts/test.md');
  });

  it('sanitizes skill IDs', async () => {
    const writer = new RepositoryScopeWriter({
      fs: realFs,
      workspaceRoot: tmp,
      commitMode: 'commit'
    });

    const manifest = `id: test-bundle
skills:
  - id: My_Skill_123
    file: skills/My_Skill_123/skill.json
    type: skill`;

    const files = new Map<string, Uint8Array>([
      ['deployment-manifest.yml', new TextEncoder().encode(manifest)],
      ['skills/My_Skill_123/skill.json', new TextEncoder().encode('{"name": "Test"}')]
    ]);

    const result = await writer.write(files);

    expect(result.skillDirs).toContain(path.join(tmp, '.github', 'skills', 'my-skill-123'));
  });
});

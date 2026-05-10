/**
 * Phase 1 / Step 1.1 — RepositoryScopeWriter tests.
 *
 * TDD tests for repository-scope writer covering:
 * - Write commit mode (no git exclude)
 * - Write local-only mode (with git exclude)
 * - Remove files and clean up
 * - Switch commit mode
 * - Idempotent re-write
 */

import assert from 'node:assert';
import {
  describe,
  it,
} from 'node:test';
import type {
  FsAbstraction,
} from '../src/cli/framework';
import type {
  ExtractedFiles,
} from '../src/install/extractor';
import {
  filesFromRecord,
} from '../src/install/extractor';
import {
  RepositoryScopeWriter,
} from '../src/install/repository-scope-writer';

// eslint-disable-next-line @typescript-eslint/no-floating-promises -- describe doesn't return a promise
describe('RepositoryScopeWriter', () => {
  /**
   * In-memory FS abstraction for testing.
   */
  class TestFs implements FsAbstraction {
    private readonly files = new Map<string, string>();
    private readonly dirs = new Set<string>();

    public readFile(path: string): Promise<string> {
      const content = this.files.get(path);
      if (content === undefined) {
        throw new Error(`File not found: ${path}`);
      }
      return Promise.resolve(content);
    }

    public async writeFile(path: string, contents: string): Promise<void> {
      const dir = path.split('/').slice(0, -1).join('/');
      this.dirs.add(dir);
      this.files.set(path, contents);
    }

    public readJson<T = unknown>(path: string): Promise<T> {
      const content = this.files.get(path);
      if (content === undefined) {
        throw new Error(`File not found: ${path}`);
      }
      return Promise.resolve(content as T);
    }

    public mkdir(path: string): Promise<void> {
      const dir = path.split('/').slice(0, -1).join('/');
      this.dirs.add(dir);
      return Promise.resolve();
    }

    public writeJson(path: string, data: unknown): Promise<void> {
      return this.writeFile(path, JSON.stringify(data, null, 2));
    }

    public exists(path: string): Promise<boolean> {
      return Promise.resolve(this.files.has(path) || this.dirs.has(path));
    }

    public readDir(path: string): Promise<string[]> {
      const entries: string[] = [];
      for (const f of this.files.keys()) {
        if (f.startsWith(path) && f.split('/').slice(0, -1).join('/') === path) {
          entries.push(f.split('/').pop()!);
        }
      }
      for (const d of this.dirs) {
        if (d.startsWith(path) && d.split('/').slice(0, -1).join('/') === path && d !== path) {
          entries.push(d.split('/').pop()!);
        }
      }
      return Promise.resolve(entries);
    }

    public async remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
      if (opts?.recursive) {
        for (const f of this.files.keys()) {
          if (f.startsWith(path)) {
            this.files.delete(f);
          }
        }
        for (const d of this.dirs) {
          if (d.startsWith(path)) {
            this.dirs.delete(d);
          }
        }
      } else {
        this.files.delete(path);
        this.dirs.delete(path);
      }
    }

    public getExcludeContent(): string {
      return this.files.get('/workspace/.git/info/exclude') ?? '';
    }

    public hasFile(path: string): boolean {
      return this.files.has(path);
    }
  }

  const createTestFs = (): TestFs => new TestFs();

  const createSimpleManifest = (): ExtractedFiles => {
    return filesFromRecord({
      'deployment-manifest.yml': `
prompts:
  - id: test-prompt
    file: prompts/test.md
    type: prompt
  - id: test-instruction
    file: instructions/test.md
    type: instruction
  - id: test-agent
    file: agents/test.md
    type: agent
`,
      'prompts/test.md': '# Test Prompt',
      'instructions/test.md': '# Test Instruction',
      'agents/test.md': '# Test Agent'
    });
  };

  const createSkillManifest = (): ExtractedFiles => {
    return filesFromRecord({
      'deployment-manifest.yml': `
prompts:
  - id: test-skill
    file: skills/my-skill/SKILL.md
    type: skill
`,
      'skills/my-skill/SKILL.md': '# Test Skill',
      'skills/my-skill/script.js': 'console.log("skill")'
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('writes files to .github/copilot/ subdirectories in commit mode', async () => {
    const fs = createTestFs();
    const writer = new RepositoryScopeWriter({
      fs,
      workspaceRoot: '/workspace',
      commitMode: 'commit'
    });

    const files = createSimpleManifest();
    const result = await writer.write(files);

    assert.strictEqual(result.written.length, 3);
    assert.ok(fs.hasFile('/workspace/.github/copilot/prompts/test.md'));
    assert.ok(fs.hasFile('/workspace/.github/copilot/instructions/test.md'));
    assert.ok(fs.hasFile('/workspace/.github/copilot/agents/test.md'));

    // No git exclude modifications in commit mode
    assert.strictEqual(fs.getExcludeContent(), '');
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('writes files to .github/copilot/ subdirectories in local-only mode and updates git exclude', async () => {
    const fs = createTestFs();
    const writer = new RepositoryScopeWriter({
      fs,
      workspaceRoot: '/workspace',
      commitMode: 'local-only'
    });

    const files = createSimpleManifest();
    const result = await writer.write(files);

    assert.strictEqual(result.written.length, 3);

    // Files should be in git exclude
    const exclude = fs.getExcludeContent();
    assert.ok(exclude.includes('# Prompt Registry (local)'));
    assert.ok(exclude.includes('.github/copilot/prompts/test.md'));
    assert.ok(exclude.includes('.github/copilot/instructions/test.md'));
    assert.ok(exclude.includes('.github/copilot/agents/test.md'));
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('writes skill directories to .github/skills/', async () => {
    const fs = createTestFs();
    const writer = new RepositoryScopeWriter({
      fs,
      workspaceRoot: '/workspace',
      commitMode: 'commit'
    });

    const files = createSkillManifest();
    const result = await writer.write(files);

    assert.strictEqual(result.skillDirs.length, 1);
    assert.ok(result.skillDirs[0].includes('test-skill'));
    assert.ok(fs.hasFile('/workspace/.github/skills/test-skill/SKILL.md'));
    assert.ok(fs.hasFile('/workspace/.github/skills/test-skill/script.js'));
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('removes files and cleans up empty directories', async () => {
    const fs = createTestFs();
    const writer = new RepositoryScopeWriter({
      fs,
      workspaceRoot: '/workspace',
      commitMode: 'commit'
    });

    // First, install files
    const files = createSimpleManifest();
    await writer.write(files);

    // Then remove them with the full manifest
    const manifest = {
      prompts: [
        { id: 'test-prompt', file: 'prompts/test.md', type: 'prompt' as const },
        { id: 'test-instruction', file: 'instructions/test.md', type: 'instruction' as const },
        { id: 'test-agent', file: 'agents/test.md', type: 'agent' as const }
      ]
    };
    await writer.remove('test-bundle', manifest);

    // Files should be removed
    assert.ok(!fs.hasFile('/workspace/.github/copilot/prompts/test.md'));
    assert.ok(!fs.hasFile('/workspace/.github/copilot/instructions/test.md'));
    assert.ok(!fs.hasFile('/workspace/.github/copilot/agents/test.md'));
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('removes skill directories recursively', async () => {
    const fs = createTestFs();
    const writer = new RepositoryScopeWriter({
      fs,
      workspaceRoot: '/workspace',
      commitMode: 'commit'
    });

    const files = createSkillManifest();
    await writer.write(files);

    const manifest = {
      prompts: [
        { id: 'test-skill', file: 'skills/my-skill/SKILL.md', type: 'skill' as const }
      ]
    };
    await writer.remove('test-bundle', manifest);

    assert.ok(!fs.hasFile('/workspace/.github/skills/test-skill/SKILL.md'));
    assert.ok(!fs.hasFile('/workspace/.github/skills/test-skill/script.js'));
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('removes paths from git exclude when removing in local-only mode', async () => {
    const fs = createTestFs();
    const writer = new RepositoryScopeWriter({
      fs,
      workspaceRoot: '/workspace',
      commitMode: 'local-only'
    });

    const files = createSimpleManifest();
    await writer.write(files);

    // Verify paths are in exclude
    const excludeBefore = fs.getExcludeContent();
    assert.ok(excludeBefore.includes('.github/copilot/prompts/test.md'));

    // Remove files
    const manifest = {
      prompts: [
        { id: 'test-prompt', file: 'prompts/test.md', type: 'prompt' as const }
      ]
    };
    await writer.remove('test-bundle', manifest);

    // Paths should be removed from exclude
    const excludeAfter = fs.getExcludeContent();
    assert.ok(!excludeAfter.includes('.github/copilot/prompts/test.md'));
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('switches commit mode from commit to local-only', async () => {
    const fs = createTestFs();
    const writer = new RepositoryScopeWriter({
      fs,
      workspaceRoot: '/workspace',
      commitMode: 'commit'
    });

    const files = createSimpleManifest();
    await writer.write(files);

    // Initially no git exclude
    assert.strictEqual(fs.getExcludeContent(), '');

    // Switch to local-only
    const paths = ['.github/copilot/prompts/test.md', '.github/copilot/instructions/test.md'];
    await writer.switchCommitMode(paths, 'local-only');

    // Paths should now be in exclude
    const exclude = fs.getExcludeContent();
    assert.ok(exclude.includes('.github/copilot/prompts/test.md'));
    assert.ok(exclude.includes('.github/copilot/instructions/test.md'));
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('switches commit mode from local-only to commit', async () => {
    const fs = createTestFs();
    const writer = new RepositoryScopeWriter({
      fs,
      workspaceRoot: '/workspace',
      commitMode: 'local-only'
    });

    const files = createSimpleManifest();
    await writer.write(files);

    // Paths should be in exclude
    const excludeBefore = fs.getExcludeContent();
    assert.ok(excludeBefore.includes('.github/copilot/prompts/test.md'));

    // Switch to commit
    const paths = ['/workspace/.github/copilot/prompts/test.md'];
    await writer.switchCommitMode(paths, 'commit');

    // Paths should be removed from exclude
    const excludeAfter = fs.getExcludeContent();
    assert.ok(!excludeAfter.includes('.github/copilot/prompts/test.md'));
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('handles empty manifest gracefully', async () => {
    const fs = createTestFs();
    const writer = new RepositoryScopeWriter({
      fs,
      workspaceRoot: '/workspace',
      commitMode: 'commit'
    });

    const files = filesFromRecord({
      'deployment-manifest.yml': 'prompts: []'
    });
    const result = await writer.write(files);

    assert.strictEqual(result.written.length, 0);
    assert.strictEqual(result.skipped.length, 0);
  });

  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- it doesn't return a promise
  it('handles missing manifest gracefully', async () => {
    const fs = createTestFs();
    const writer = new RepositoryScopeWriter({
      fs,
      workspaceRoot: '/workspace',
      commitMode: 'commit'
    });

    const files = filesFromRecord({
      'some-file.md': '# content'
    });
    const result = await writer.write(files);

    assert.strictEqual(result.written.length, 0);
  });
});

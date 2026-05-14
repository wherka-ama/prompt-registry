/**
 * Coverage tests for infra/writers/file-tree-writer.ts.
 *
 * Tests resolveLayout, expandPath, FileTreeTargetWriter.
 */
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {
  Target,
} from '../src/domain/install';
import {
  expandPath,
  FileTreeTargetWriter,
  resolveLayout,
  type WriterFs,
} from '../src/infra/writers/file-tree-writer';
import type {
  ExtractedFiles,
} from '../src/ports/bundle-extractor';

describe('resolveLayout', () => {
  it('resolves vscode user scope layout', () => {
    const target: Target = {
      name: 'test',
      type: 'vscode',
      scope: 'user',
      path: '/custom/path'
    };
    const layout = resolveLayout(target);
    expect(layout.baseDir).toBe('/custom/path');
    expect(layout.kindRoutes).toHaveProperty('prompts/');
    expect(layout.kindRoutes).toHaveProperty('skills/');
  });

  it('resolves vscode repository scope layout', () => {
    const target: Target = {
      name: 'test',
      type: 'vscode',
      scope: 'repository',
      workspaceRoot: '/workspace'
    };
    const layout = resolveLayout(target);
    expect(layout.baseDir).toBe('/workspace');
    expect(layout.kindRoutes['prompts/']).toBe('.github/prompts/');
    expect(layout.kindRoutes['skills/']).toBe('.github/skills/');
  });

  it('resolves copilot-cli layout', () => {
    const target: Target = {
      name: 'test',
      type: 'copilot-cli',
      scope: 'user'
    };
    const layout = resolveLayout(target);
    expect(layout.baseDir).toBe('${HOME}/.copilot');
    expect(layout.kindRoutes['prompts/']).toBe('prompts/');
  });

  it('resolves kiro user scope layout', () => {
    const target: Target = {
      name: 'test',
      type: 'kiro',
      scope: 'user'
    };
    const layout = resolveLayout(target);
    expect(layout.baseDir).toBe('${HOME}/.kiro');
    expect(layout.kindRoutes['prompts/']).toBe('steering/');
  });

  it('resolves kiro repository scope layout', () => {
    const target: Target = {
      name: 'test',
      type: 'kiro',
      scope: 'repository',
      workspaceRoot: '/workspace'
    };
    const layout = resolveLayout(target);
    expect(layout.baseDir).toBe('/workspace');
    expect(layout.kindRoutes['prompts/']).toBe('.kiro/steering/');
  });

  it('resolves windsurf user scope layout', () => {
    const target: Target = {
      name: 'test',
      type: 'windsurf',
      scope: 'user'
    };
    const layout = resolveLayout(target);
    expect(layout.baseDir).toBe('${HOME}/.codeium/windsurf');
    expect(layout.kindRoutes['prompts/']).toBe('rules/');
  });

  it('resolves claude-code user scope layout', () => {
    const target: Target = {
      name: 'test',
      type: 'claude-code',
      scope: 'user'
    };
    const layout = resolveLayout(target);
    expect(layout.baseDir).toBe('${HOME}/.claude');
    expect(layout.kindRoutes['prompts/']).toBe('commands/');
  });
});

describe('expandPath', () => {
  it('expands ${HOME} environment variable', () => {
    const env = { HOME: '/home/user' };
    const result = expandPath('${HOME}/.config', env);
    expect(result).toBe('/home/user/.config');
  });

  it('expands ${USERPROFILE} on Windows', () => {
    const env = { USERPROFILE: 'C:\\Users\\user' };
    const result = expandPath('~/.config', env);
    expect(result).toBe('C:\\Users\\user/.config');
  });

  it('expands leading ~ with HOME', () => {
    const env = { HOME: '/home/user' };
    const result = expandPath('~/.config', env);
    expect(result).toBe('/home/user/.config');
  });

  it('leaves path unchanged when no variables', () => {
    const env = {};
    const result = expandPath('/absolute/path', env);
    expect(result).toBe('/absolute/path');
  });

  it('replaces missing variable with empty string', () => {
    const env = {};
    const result = expandPath('${MISSING}/path', env);
    expect(result).toBe('/path');
  });

  it('handles multiple variables', () => {
    const env = { HOME: '/home/user', XDG: '/xdg' };
    const result = expandPath('${HOME}/${XDG}', env);
    expect(result).toBe('/home/user//xdg');
  });
});

describe('FileTreeTargetWriter', () => {
  const mockFs: WriterFs = {
    writeFile: vi.fn() as any,
    mkdir: vi.fn() as any,
    remove: vi.fn() as any,
    exists: vi.fn() as any
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes files to target layout', async () => {
    const writer = new FileTreeTargetWriter({ fs: mockFs, env: {} });
    const target: Target = {
      name: 'test',
      type: 'vscode',
      scope: 'user',
      path: '/target'
    };
    const files: ExtractedFiles = new Map([
      ['prompts/test.prompt.md', new TextEncoder().encode('content')]
    ]);

    const result = await writer.write(target, files);
    expect(result.written).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    expect(vi.mocked(mockFs.mkdir)).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    expect(vi.mocked(mockFs.writeFile)).toHaveBeenCalled();
  });

  it('respects allowedKinds filter', async () => {
    const writer = new FileTreeTargetWriter({ fs: mockFs, env: {} });
    const target: Target = {
      name: 'test',
      type: 'vscode',
      scope: 'user',
      path: '/target',
      allowedKinds: ['prompts']
    };
    const files: ExtractedFiles = new Map([
      ['prompts/test.prompt.md', new TextEncoder().encode('content')],
      ['skills/test.md', new TextEncoder().encode('content')]
    ]);

    const result = await writer.write(target, files);
    expect(result.written).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it('removes file from target', async () => {
    const writer = new FileTreeTargetWriter({ fs: mockFs, env: {} });
    const target: Target = {
      name: 'test',
      type: 'vscode',
      scope: 'user',
      path: '/target'
    };

    await writer.remove(target, 'prompts/test.prompt.md');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    expect(vi.mocked(mockFs.remove)).toHaveBeenCalled();
  });

  it('does nothing for unrouted file removal', async () => {
    const writer = new FileTreeTargetWriter({ fs: mockFs, env: {} });
    const target: Target = {
      name: 'test',
      type: 'vscode',
      scope: 'user',
      path: '/target'
    };

    await writer.remove(target, 'unrouted/file.txt');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.mocked is a utility function, not a method
    expect(vi.mocked(mockFs.remove)).not.toHaveBeenCalled();
  });
});

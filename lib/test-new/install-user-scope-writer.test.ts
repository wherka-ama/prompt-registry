import {
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  Target,
} from '../src/domain/install';
import type {
  ExtractedFiles,
} from '../src/install/extractor';
import {
  UserScopeWriter,
} from '../src/install/user-scope-writer';

describe('UserScopeWriter', () => {
  const mockFs = {
    writeFile: async (p: string, contents: string): Promise<void> => {
      mockFs.files[p] = contents;
    },
    mkdir: async (p: string): Promise<void> => {
      mockFs.dirs.add(p);
    },
    remove: async (p: string): Promise<void> => {
      delete mockFs.files[p];
      mockFs.removed.push(p);
    },
    exists: async (p: string): Promise<boolean> => {
      return p in mockFs.files || mockFs.dirs.has(p);
    },
    readDir: async (p: string): Promise<string[]> => {
      const entries: string[] = [];
      for (const file of Object.keys(mockFs.files)) {
        if (file.startsWith(p)) {
          const rel = file.slice(p.length);
          const first = rel.split('/')[0];
          if (first && !entries.includes(first)) {
            entries.push(first);
          }
        }
      }
      return entries;
    },
    files: {} as Record<string, string>,
    dirs: new Set<string>(),
    removed: [] as string[]
  };

  beforeEach(() => {
    mockFs.files = {};
    mockFs.dirs = new Set();
    mockFs.removed = [];
  });

  describe('write()', () => {
    it('should write files to target directory', async () => {
      const target: Target = {
        name: 'test-target',
        type: 'vscode',
        path: '/home/user/.config/Code/User',
        scope: 'user'
      };
      const files: ExtractedFiles = new Map([
        ['prompts/test.md', new TextEncoder().encode('# Test')]
      ]);
      const writer = new UserScopeWriter({
        fs: mockFs as any,
        env: { HOME: '/home/user' }
      });

      const result = await writer.write(target, files);

      expect(result.written.length).toBe(1);
      expect(result.written[0]).toContain('test.md');
      expect(mockFs.files[result.written[0]]).toBe('# Test');
    });

    it('should skip files not in allowed kinds', async () => {
      const target: Target = {
        name: 'test-target',
        type: 'vscode',
        path: '/home/user/.config/Code/User',
        scope: 'user',
        allowedKinds: ['prompts']
      };
      const files: ExtractedFiles = new Map([
        ['prompts/test.md', new TextEncoder().encode('# Test')],
        ['instructions/test.md', new TextEncoder().encode('# Test')]
      ]);
      const writer = new UserScopeWriter({
        fs: mockFs as any,
        env: { HOME: '/home/user' }
      });

      const result = await writer.write(target, files);

      expect(result.written.length).toBe(1);
      expect(result.skipped.length).toBe(1);
      expect(result.skipped[0]).toBe('instructions/test.md');
    });

    it('should expand ${HOME} in path', async () => {
      const target: Target = {
        name: 'test-target',
        type: 'vscode',
        path: '${HOME}/.config/Code/User',
        scope: 'user'
      };
      const files: ExtractedFiles = new Map([
        ['prompts/test.md', new TextEncoder().encode('# Test')]
      ]);
      const writer = new UserScopeWriter({
        fs: mockFs as any,
        env: { HOME: '/home/user' }
      });

      const result = await writer.write(target, files);

      expect(result.written[0]).toContain('/home/user/.config/Code/User');
    });
  });

  describe('remove()', () => {
    it('should remove a single file', async () => {
      const target: Target = {
        name: 'test-target',
        type: 'vscode',
        path: '/home/user/.config/Code/User',
        scope: 'user'
      };
      const filePath = 'prompts/test.md';
      const writer = new UserScopeWriter({
        fs: mockFs as any,
        env: { HOME: '/home/user' }
      });
      mockFs.files['/home/user/.config/Code/User/prompts/test.md'] = '# Test';

      await writer.remove(target, filePath);

      expect(mockFs.removed.length).toBe(1);
      expect(mockFs.removed[0]).toContain('test.md');
    });

    it('should skip non-existent files', async () => {
      const target: Target = {
        name: 'test-target',
        type: 'vscode',
        path: '/home/user/.config/Code/User',
        scope: 'user'
      };
      const filePath = 'prompts/nonexistent.md';
      const writer = new UserScopeWriter({
        fs: mockFs as any,
        env: { HOME: '/home/user' }
      });

      await writer.remove(target, filePath);
    });

    it('should expand ${HOME} in path for removal', async () => {
      const target: Target = {
        name: 'test-target',
        type: 'vscode',
        path: '${HOME}/.config/Code/User',
        scope: 'user'
      };
      const filePath = 'prompts/test.md';
      const writer = new UserScopeWriter({
        fs: mockFs as any,
        env: { HOME: '/home/user' }
      });
      mockFs.files['/home/user/.config/Code/User/prompts/test.md'] = '# Test';

      await writer.remove(target, filePath);

      expect(mockFs.removed[0]).toContain('/home/user/.config/Code/User');
    });
  });

  describe('removeBundle()', () => {
    it('should remove all files from manifest', async () => {
      const target: Target = {
        name: 'test-target',
        type: 'vscode',
        path: '/home/user/.config/Code/User',
        scope: 'user'
      };
      const manifest = {
        id: 'test-bundle',
        version: '1.0.0',
        prompts: [
          { id: 'p1', file: 'prompts/p1.md', type: 'prompt' },
          { id: 'p2', file: 'prompts/p2.md', type: 'prompt' }
        ]
      };
      const writer = new UserScopeWriter({
        fs: mockFs as any,
        env: { HOME: '/home/user' }
      });
      mockFs.files['/home/user/.config/Code/User/prompts/p1.md'] = '# P1';
      mockFs.files['/home/user/.config/Code/User/prompts/p2.md'] = '# P2';

      await writer.removeBundle(target, manifest);

      expect(mockFs.removed.length).toBe(2);
    });

    it('should clean empty directories after removal', async () => {
      const target: Target = {
        name: 'test-target',
        type: 'vscode',
        path: '/home/user/.config/Code/User',
        scope: 'user'
      };
      const manifest = {
        id: 'test-bundle',
        version: '1.0.0',
        prompts: [
          { id: 'p1', file: 'prompts/p1.md', type: 'prompt' }
        ]
      };
      const writer = new UserScopeWriter({
        fs: mockFs as any,
        env: { HOME: '/home/user' }
      });
      mockFs.files['/home/user/.config/Code/User/prompts/p1.md'] = '# P1';
      mockFs.dirs.add('/home/user/.config/Code/User/prompts');

      await writer.removeBundle(target, manifest);
    });
  });
});

import {
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  UninstallPipeline,
} from '../src/app/install/uninstall-pipeline';
import type {
  Target,
} from '../src/domain/install';

describe('UninstallPipeline', () => {
  const mockFs = {
    readFile: async (p: string): Promise<string> => {
      if (p === '/repo/prompt-registry.lock.json') {
        return JSON.stringify({
          schemaVersion: 1,
          entries: [
            {
              target: 'test-target',
              sourceId: 'test-source',
              bundleId: 'bundle1',
              bundleVersion: '1.0.0',
              installedAt: '2024-01-01T00:00:00Z',
              files: ['prompts/p1.md', 'prompts/p2.md']
            },
            {
              target: 'test-target',
              sourceId: 'test-source',
              bundleId: 'bundle2',
              bundleVersion: '1.0.0',
              installedAt: '2024-01-01T00:00:00Z',
              files: ['instructions/i1.md']
            }
          ]
        });
      }
      return '{}';
    },
    writeFile: async (p: string, contents: string): Promise<void> => {
      mockFs.files[p] = contents;
    },
    remove: async (p: string): Promise<void> => {
      mockFs.removed.push(p);
    },
    exists: async (p: string): Promise<boolean> => {
      if (p === '/repo/prompt-registry.lock.json') {
        return true;
      }
      return p in mockFs.files;
    },
    files: {} as Record<string, string>,
    removed: [] as string[]
  };

  const target: Target = {
    name: 'test-target',
    type: 'vscode',
    path: '/home/user/.config/Code/User',
    scope: 'user'
  };

  const mockWriter = {
    remove: async (t: Target, filePath: string): Promise<void> => {
      mockFs.removed.push(filePath);
    },
    write: async (): Promise<{ written: string[]; skipped: string[] }> => {
      return { written: [], skipped: [] };
    }
  };

  beforeEach(() => {
    mockFs.files = {};
    mockFs.removed = [];
  });

  describe('planAll()', () => {
    it('should plan uninstall for all bundles for target', async () => {
      const pipeline = new UninstallPipeline({
        fs: mockFs as any,
        target,
        lockfile: '/repo/prompt-registry.lock.json',
        writerFactory: () => mockWriter as any
      });

      const plans = await pipeline.planAll();

      expect(plans.length).toBe(2);
      expect(plans[0].bundleId).toBe('bundle1');
      expect(plans[1].bundleId).toBe('bundle2');
    });

    it('should return empty array when no bundles for target', async () => {
      const pipeline = new UninstallPipeline({
        fs: mockFs as any,
        target: { ...target, name: 'other-target' },
        lockfile: '/repo/prompt-registry.lock.json',
        writerFactory: () => mockWriter as any
      });

      const plans = await pipeline.planAll();

      expect(plans.length).toBe(0);
    });
  });

  describe('runAll()', () => {
    it('should uninstall all bundles for target', async () => {
      const pipeline = new UninstallPipeline({
        fs: mockFs as any,
        target,
        lockfile: '/repo/prompt-registry.lock.json',
        writerFactory: () => mockWriter as any
      });

      const results = await pipeline.runAll();

      expect(results.length).toBe(2);
      expect(results[0].bundleId).toBe('bundle1');
      expect(results[1].bundleId).toBe('bundle2');
      expect(results[0].removed.length).toBeGreaterThan(0);
    });

    it('should update lockfile after removing all bundles', async () => {
      const pipeline = new UninstallPipeline({
        fs: mockFs as any,
        target,
        lockfile: '/repo/prompt-registry.lock.json',
        writerFactory: () => mockWriter as any
      });

      await pipeline.runAll();

      expect(mockFs.files['/repo/prompt-registry.lock.json']).toBeTruthy();
      const updatedLock = JSON.parse(mockFs.files['/repo/prompt-registry.lock.json']);
      expect(updatedLock.entries.length).toBe(0);
    });
  });

  describe('runFromLockfile()', () => {
    it('should uninstall all entries from lockfile for target', async () => {
      const pipeline = new UninstallPipeline({
        fs: mockFs as any,
        target,
        lockfile: '/repo/prompt-registry.lock.json',
        writerFactory: () => mockWriter as any
      });

      const results = await pipeline.runFromLockfile();

      expect(results.length).toBe(2);
      expect(results[0].bundleId).toBe('bundle1');
      expect(results[1].bundleId).toBe('bundle2');
    });

    it('should return empty array when lockfile does not exist', async () => {
      const pipeline = new UninstallPipeline({
        fs: {
          ...mockFs,
          readFile: async () => {
            throw new Error('File not found');
          }
        } as any,
        target,
        lockfile: '/repo/nonexistent.json',
        writerFactory: () => mockWriter as any
      });

      const results = await pipeline.runFromLockfile();

      expect(results.length).toBe(0);
    });
  });
});

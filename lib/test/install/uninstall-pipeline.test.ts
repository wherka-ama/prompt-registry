/**
 * TDD tests for UninstallPipeline enhancements.
 *
 * Tests the enhanced uninstall pipeline with:
 * - planAll() - plan all bundles for a target
 * - runAll() - run uninstall for all bundles for a target
 * - runFromLockfile() - run uninstall from lockfile
 */

import * as assert from 'node:assert';
import type {
  Target,
} from '../../src/domain/install';
import {
  UninstallPipeline,
} from '../../src/install/uninstall-pipeline';

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
      // Arrange
      const pipeline = new UninstallPipeline({
        fs: mockFs as any,
        target,
        lockfile: '/repo/prompt-registry.lock.json',
        writerFactory: () => mockWriter as any
      });

      // Act
      const plans = await pipeline.planAll();

      // Assert
      assert.strictEqual(plans.length, 2);
      assert.strictEqual(plans[0].bundleId, 'bundle1');
      assert.strictEqual(plans[1].bundleId, 'bundle2');
    });

    it('should return empty array when no bundles for target', async () => {
      // Arrange
      const pipeline = new UninstallPipeline({
        fs: mockFs as any,
        target: { ...target, name: 'other-target' },
        lockfile: '/repo/prompt-registry.lock.json',
        writerFactory: () => mockWriter as any
      });

      // Act
      const plans = await pipeline.planAll();

      // Assert
      assert.strictEqual(plans.length, 0);
    });
  });

  describe('runAll()', () => {
    it('should uninstall all bundles for target', async () => {
      // Arrange
      const pipeline = new UninstallPipeline({
        fs: mockFs as any,
        target,
        lockfile: '/repo/prompt-registry.lock.json',
        writerFactory: () => mockWriter as any
      });

      // Act
      const results = await pipeline.runAll();

      // Assert
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].bundleId, 'bundle1');
      assert.strictEqual(results[1].bundleId, 'bundle2');
      assert.ok(results[0].removed.length > 0);
    });

    it('should update lockfile after removing all bundles', async () => {
      // Arrange
      const pipeline = new UninstallPipeline({
        fs: mockFs as any,
        target,
        lockfile: '/repo/prompt-registry.lock.json',
        writerFactory: () => mockWriter as any
      });

      // Act
      await pipeline.runAll();

      // Assert - lockfile should be updated with entries removed
      assert.ok(mockFs.files['/repo/prompt-registry.lock.json']);
      const updatedLock = JSON.parse(mockFs.files['/repo/prompt-registry.lock.json']);
      assert.strictEqual(updatedLock.entries.length, 0);
    });
  });

  describe('runFromLockfile()', () => {
    it('should uninstall all entries from lockfile for target', async () => {
      // Arrange
      const pipeline = new UninstallPipeline({
        fs: mockFs as any,
        target,
        lockfile: '/repo/prompt-registry.lock.json',
        writerFactory: () => mockWriter as any
      });

      // Act
      const results = await pipeline.runFromLockfile();

      // Assert
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].bundleId, 'bundle1');
      assert.strictEqual(results[1].bundleId, 'bundle2');
    });

    it('should return empty array when lockfile does not exist', async () => {
      // Arrange
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

      // Act
      const results = await pipeline.runFromLockfile();

      // Assert
      assert.strictEqual(results.length, 0);
    });
  });
});

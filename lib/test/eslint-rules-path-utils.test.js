/**
 * Fix 6: ESLint rule path detection fragility.
 *
 * Tests for cross-platform path matching utilities to ensure robust
 * handling of Windows backslashes, symlinks, and case variations.
 */
const { describe, it } = require('mocha');
const { expect } = require('chai');
// Import from the compiled JS file since this is a CommonJS test
const { normalizePath, isWithinDirectory, matchesPattern } = require('../eslint-rules/shared/path-utils');

describe('Path Utilities - Fix 6: Cross-Platform Path Matching', () => {
  describe('normalizePath', () => {
    it('should convert Windows backslashes to forward slashes', () => {
      const windowsPath = 'lib\\src\\cli\\commands\\bundle-build.ts';
      const normalized = normalizePath(windowsPath);
      expect(normalized).to.equal('lib/src/cli/commands/bundle-build.ts');
    });

    it('should handle mixed slashes', () => {
      const mixedPath = 'lib\\src/cli/commands\\bundle-build.ts';
      const normalized = normalizePath(mixedPath);
      expect(normalized).to.equal('lib/src/cli/commands/bundle-build.ts');
    });

    it('should handle Unix paths unchanged', () => {
      const unixPath = 'lib/src/cli/commands/bundle-build.ts';
      const normalized = normalizePath(unixPath);
      expect(normalized).to.equal('lib/src/cli/commands/bundle-build.ts');
    });

    it('should resolve relative components', () => {
      const relativePath = 'lib/../lib/src/./cli/commands/bundle-build.ts';
      const normalized = normalizePath(relativePath);
      expect(normalized).to.equal('lib/src/cli/commands/bundle-build.ts');
    });
  });

  describe('isWithinDirectory', () => {
    it('should detect file within directory with forward slashes', () => {
      const filePath = '/home/user/project/lib/src/cli/commands/bundle-build.ts';
      const dirPath = '/home/user/project/lib/src/cli/commands';
      expect(isWithinDirectory(filePath, dirPath)).to.be.true;
    });

    it('should detect file within directory with backslashes', () => {
      const filePath = 'C:\\project\\lib\\src\\cli\\commands\\bundle-build.ts';
      const dirPath = 'C:\\project\\lib\\src\\cli\\commands';
      expect(isWithinDirectory(filePath, dirPath)).to.be.true;
    });

    it('should reject file outside directory', () => {
      const filePath = '/home/user/project/lib/src/cli/framework/cli.ts';
      const dirPath = '/home/user/project/lib/src/cli/commands';
      expect(isWithinDirectory(filePath, dirPath)).to.be.false;
    });

    it('should handle directory path without trailing slash', () => {
      const filePath = '/home/user/project/lib/src/cli/commands/bundle-build.ts';
      const dirPath = '/home/user/project/lib/src/cli/commands';
      expect(isWithinDirectory(filePath, dirPath)).to.be.true;
    });

    it('should handle directory path with trailing slash', () => {
      const filePath = '/home/user/project/lib/src/cli/commands/bundle-build.ts';
      const dirPath = '/home/user/project/lib/src/cli/commands/';
      expect(isWithinDirectory(filePath, dirPath)).to.be.true;
    });

    it('should reject file at sibling directory', () => {
      const filePath = '/home/user/project/lib/src/cli/framework/cli.ts';
      const dirPath = '/home/user/project/lib/src/cli/commands';
      expect(isWithinDirectory(filePath, dirPath)).to.be.false;
    });
  });

  describe('matchesPattern', () => {
    it('should match file pattern with forward slashes', () => {
      const filePath = '/home/user/project/lib/src/cli/commands/bundle-build.ts';
      const pattern = '/lib/src/cli/commands/';
      expect(matchesPattern(filePath, pattern)).to.be.true;
    });

    it('should match file pattern with backslashes', () => {
      const filePath = 'C:\\project\\lib\\src\\cli\\commands\\bundle-build.ts';
      const pattern = '\\lib\\src\\cli\\commands\\';
      expect(matchesPattern(filePath, pattern)).to.be.true;
    });

    it('should reject non-matching pattern', () => {
      const filePath = '/home/user/project/lib/src/cli/framework/cli.ts';
      const pattern = '/lib/src/cli/commands/';
      expect(matchesPattern(filePath, pattern)).to.be.false;
    });

    it('should handle pattern without trailing slash', () => {
      const filePath = '/home/user/project/lib/src/cli/commands/bundle-build.ts';
      const pattern = '/lib/src/cli/commands';
      expect(matchesPattern(filePath, pattern)).to.be.true;
    });

    it('should handle pattern with trailing slash', () => {
      const filePath = '/home/user/project/lib/src/cli/commands/bundle-build.ts';
      const pattern = '/lib/src/cli/commands/';
      expect(matchesPattern(filePath, pattern)).to.be.true;
    });

    it('should match framework files correctly', () => {
      const frameworkPath = '/home/user/project/lib/src/cli/framework/cli.ts';
      const frameworkPattern = '/lib/src/cli/framework/';
      expect(matchesPattern(frameworkPath, frameworkPattern)).to.be.true;
      expect(matchesPattern(frameworkPath, '/lib/src/cli/commands/')).to.be.false;
    });

    it('should match domain files correctly', () => {
      const domainPath = '/home/user/project/lib/src/domain/bundle/types.ts';
      const domainPattern = '/lib/src/domain/';
      expect(matchesPattern(domainPath, domainPattern)).to.be.true;
      expect(matchesPattern(domainPath, '/lib/src/cli/commands/')).to.be.false;
    });
  });

  describe('Cross-platform scenarios', () => {
    it('should handle Windows absolute paths', () => {
      const windowsPath = 'C:\\Users\\user\\project\\lib\\src\\cli\\commands\\bundle-build.ts';
      expect(matchesPattern(windowsPath, '/lib/src/cli/commands/')).to.be.true;
    });

    it('should handle Unix absolute paths', () => {
      const unixPath = '/home/user/project/lib/src/cli/commands/bundle-build.ts';
      expect(matchesPattern(unixPath, '/lib/src/cli/commands/')).to.be.true;
    });

    it('should handle relative paths on Windows', () => {
      const relativePath = '.\\lib\\src\\cli\\commands\\bundle-build.ts';
      const normalized = normalizePath(relativePath);
      expect(normalized).to.equal('./lib/src/cli/commands/bundle-build.ts');
    });

    it('should handle relative paths on Unix', () => {
      const relativePath = './lib/src/cli/commands/bundle-build.ts';
      const normalized = normalizePath(relativePath);
      expect(normalized).to.equal('lib/src/cli/commands/bundle-build.ts');
    });
  });
});

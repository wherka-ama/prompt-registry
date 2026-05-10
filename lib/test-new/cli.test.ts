import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  getPositionalArg,
  hasFlag,
  parseMultiArg,
  parseSingleArg,
} from '../src/cli';

describe('CLI Module', () => {
  describe('parseSingleArg()', () => {
    it('should parse single argument', () => {
      const argv = ['--collection-file', 'test.yml'];
      const result = parseSingleArg(argv, '--collection-file');
      expect(result).toBe('test.yml');
    });

    it('should return undefined for missing argument', () => {
      const argv = ['--other', 'value'];
      const result = parseSingleArg(argv, '--collection-file');
      expect(result).toBeUndefined();
    });

    it('should return undefined for flag without value', () => {
      const argv = ['--collection-file'];
      const result = parseSingleArg(argv, '--collection-file');
      expect(result).toBeUndefined();
    });

    it('should handle multiple arguments', () => {
      const argv = ['--first', 'one', '--second', 'two', '--third', 'three'];
      expect(parseSingleArg(argv, '--first')).toBe('one');
      expect(parseSingleArg(argv, '--second')).toBe('two');
      expect(parseSingleArg(argv, '--third')).toBe('three');
    });
  });

  describe('parseMultiArg()', () => {
    it('should parse multiple occurrences', () => {
      const argv = ['--changed-path', 'file1.md', '--changed-path', 'file2.md'];
      const result = parseMultiArg(argv, '--changed-path');
      expect(result).toStrictEqual(['file1.md', 'file2.md']);
    });

    it('should return empty array for missing argument', () => {
      const argv = ['--other', 'value'];
      const result = parseMultiArg(argv, '--changed-path');
      expect(result).toStrictEqual([]);
    });

    it('should handle single occurrence', () => {
      const argv = ['--changed-path', 'file1.md'];
      const result = parseMultiArg(argv, '--changed-path');
      expect(result).toStrictEqual(['file1.md']);
    });
  });

  describe('hasFlag()', () => {
    it('should return true for present flag', () => {
      const argv = ['--verbose', '--dry-run'];
      expect(hasFlag(argv, '--verbose')).toBe(true);
      expect(hasFlag(argv, '--dry-run')).toBe(true);
    });

    it('should return false for missing flag', () => {
      const argv = ['--verbose'];
      expect(hasFlag(argv, '--dry-run')).toBe(false);
    });

    it('should handle empty argv', () => {
      expect(hasFlag([], '--verbose')).toBe(false);
    });
  });

  describe('getPositionalArg()', () => {
    it('should get positional argument by index', () => {
      const argv = ['first', 'second', 'third'];
      expect(getPositionalArg(argv, 0)).toBe('first');
      expect(getPositionalArg(argv, 1)).toBe('second');
      expect(getPositionalArg(argv, 2)).toBe('third');
    });

    it('should skip flags and their values', () => {
      const argv = ['--flag', 'value', 'positional'];
      expect(getPositionalArg(argv, 0)).toBe('positional');
    });

    it('should return undefined for out of range index', () => {
      const argv = ['first'];
      expect(getPositionalArg(argv, 1)).toBeUndefined();
    });

    it('should handle mixed flags and positionals', () => {
      const argv = ['pos1', '--flag', 'value', 'pos2'];
      expect(getPositionalArg(argv, 0)).toBe('pos1');
      expect(getPositionalArg(argv, 1)).toBe('pos2');
    });
  });
});

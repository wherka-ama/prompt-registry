/**
 * Shared path utilities for ESLint rules.
 *
 * Provides robust cross-platform path matching to avoid issues with
 * Windows backslashes, symlinks, and case-insensitive filesystems.
 * @module eslint-rules/shared/path-utils
 */
import path from 'node:path';

/**
 * Normalize a path for comparison across platforms.
 * Converts backslashes to forward slashes and resolves relative components.
 * @param {string} filePath - The file path to normalize.
 * @returns {string} Normalized path with forward slashes.
 */
function normalizePath(filePath) {
  return path.normalize(filePath).replace(/\\/g, '/');
}

/**
 * Check if a file path is within a specific directory.
 * Uses normalized paths for cross-platform compatibility.
 * @param {string} filePath - The file path to check.
 * @param {string} dirPath - The directory path to check against.
 * @returns {boolean} True if filePath is within dirPath.
 */
function isWithinDirectory(filePath, dirPath) {
  const normalizedFile = normalizePath(filePath);
  const normalizedDir = normalizePath(dirPath);
  
  // Ensure directory path ends with a slash for proper prefix matching
  const dirWithSlash = normalizedDir.endsWith('/') 
    ? normalizedDir 
    : normalizedDir + '/';
    
  return normalizedFile.startsWith(dirWithSlash);
}

/**
 * Check if a file path matches a specific pattern.
 * Uses normalized paths for cross-platform compatibility.
 * Does substring matching (pattern can appear anywhere in path).
 * @param {string} filePath - The file path to check.
 * @param {string} pattern - The pattern to match (e.g., '/lib/src/cli/framework/').
 * @returns {boolean} True if filePath matches the pattern.
 */
function matchesPattern(filePath, pattern) {
  const normalizedFile = normalizePath(filePath);
  const normalizedPattern = normalizePath(pattern);
  
  // Ensure pattern ends with a slash for proper directory matching
  const patternWithSlash = normalizedPattern.endsWith('/') 
    ? normalizedPattern 
    : normalizedPattern + '/';
    
  return normalizedFile.includes(patternWithSlash);
}

export {
  normalizePath,
  isWithinDirectory,
  matchesPattern
};

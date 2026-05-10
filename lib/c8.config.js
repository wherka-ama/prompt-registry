/**
 * Coverage configuration for c8 (Istanbul).
 */
module.exports = {
  reporter: ['html', 'lcov', 'text', 'json'],
  exclude: [
    'dist/**',
    'dist-test/**',
    'node_modules/**',
    'test/**',
    'scripts/**',
    '*.config.js',
    '*.config.mjs',
    'tsconfig.json',
    'tsconfig.test.json'
  ],
  include: ['src/**/*.ts'],
  extension: ['.ts'],
  all: true,
  lines: 80,
  functions: 80,
  branches: 75,
  statements: 80
};

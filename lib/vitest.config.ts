import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    root: './',
    include: ['test-new/**/*.test.ts'],
    exclude: [
      'node_modules',
      'dist',
      'dist-test',
      'test',
      '**/*.js',
      '**/*.d.ts',
      'dist-test/**'
    ],
    globals: true,
    environment: 'node',
    typecheck: {
      enabled: false,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules',
        'dist',
        'dist-test',
        'test',
        'test-new'
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

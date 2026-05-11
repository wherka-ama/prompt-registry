import {
  defineConfig,
  globalIgnores,
} from 'eslint/config';
import {
  createSharedConfig,
  temporaryWarnRules,
  temporaryWarnRulesTs,
} from '../eslint.shared.mjs';
import noFrameworkImportsPlugin from './eslint-rules/no-framework-imports.js';
import noFeatureImportsInDomainPlugin from './eslint-rules/no-feature-imports-in-domain.js';
import noCliImportsInPublicPlugin from './eslint-rules/no-cli-imports-in-public.js';

export default defineConfig([
  globalIgnores(
    [
      'dist/',
      '**/*.d.ts',
      'node_modules/',
      'bin/'
    ],
    'collection-scripts/ignores'
  ),
  ...createSharedConfig({
    name: 'collection-scripts',
    tsProjects: ['tsconfig.eslint.json'],
    tsconfigRootDir: import.meta.dirname
  }),
  {
    // TODO to be discussed and fixed in a future PR
    name: 'collection-scripts/temporary-warn-rules-ts',
    files: ['**/*.ts'],
    rules: temporaryWarnRulesTs
  },
  {
    // TODO to be discussed and fixed in a future PR
    name: 'collection-scripts/temporary-warn-rules',
    files: ['**/*.{j,t}s'],
    rules: temporaryWarnRules
  },
  {
    name: 'collection-scripts/test-ts-rules',
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    name: 'collection-scripts/test-js-globals',
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly'
      }
    },
    rules: {
      'no-undef': 'off'
    }
  },
  {
    name: 'collection-scripts/cli-framework-invariants',
    files: ['src/cli/commands/**/*.ts'],
    plugins: {
      local: noFrameworkImportsPlugin
    },
    rules: {
      'local/no-framework-imports': 'error'
    }
  },
  {
    // Spec §14.2 invariant #1 — domain layer cannot depend on feature layers.
    // Phase 3 / Iter 2.
    name: 'collection-scripts/domain-layer-invariants',
    files: ['src/domain/**/*.ts'],
    plugins: {
      'local-domain': noFeatureImportsInDomainPlugin
    },
    rules: {
      'local-domain/no-feature-imports-in-domain': 'error'
    }
  },
  // TODO: Enable public API lint rule after fixing minimatch configuration issue
  // {
  //   // Phase 1 / Step 1.9 — public API cannot import from internal implementation layers.
  //   name: 'collection-scripts/public-api-invariants',
  //   files: ['src/public/**/*.ts'],
  //   plugins: {
  //     'local-public': noCliImportsInPublicPlugin
  //   },
  //   rules: {
  //     'local-public/no-cli-imports-in-public': 'error'
  //   }
  // }
]);

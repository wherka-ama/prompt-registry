# Getting Started

Guide for developers contributing to the collection scripts library.

## Prerequisites

- Node.js 18+ (matches VS Code's bundled Node version)
- npm 9+
- Git

## Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd prompt-registry/lib

# Install dependencies
npm install

# Build the library
npm run build

# Run tests
npm test

# Check linting
npm run lint
```

## Project Structure

```
lib/
├── src/                    # Source code
│   ├── cli/               # CLI commands and framework
│   ├── domain/            # Type definitions (no I/O)
│   ├── primitive-index/   # Search engine
│   ├── install/           # Installation system
│   ├── github/            # GitHub integration
│   ├── core/              # Barrel exports
│   ├── public/            # Public API
│   ├── registry/            # Registry namespace
│   └── *.ts               # Top-level modules
├── test/                  # Test suite
│   ├── cli/               # CLI tests
│   ├── fixtures/          # Test data
│   └── *.test.ts          # Module tests
├── dist/                  # Compiled output (gitignored)
├── dist-test/             # Compiled tests (gitignored)
├── docs/                  # Documentation
└── fixtures/              # Shared test fixtures
```

## Development Workflow

### 1. Making Changes

```bash
# Edit source files in src/
vim src/my-feature.ts

# Compile to check for errors
npm run build

# Run tests
npm test

# Run specific test
npm test -- --grep "my feature"
```

### 2. Adding Tests

```bash
# Create test file
touch test/my-feature.test.ts

# Write tests following existing patterns

# Compile tests
npm run compile-tests

# Run tests
npm test
```

### 3. Running CLI Locally

```bash
# Build first
npm run build

# Run CLI
node dist/cli/index.js --help
node dist/cli/index.js collection validate --verbose
```

### 4. Linting and Formatting

```bash
# Check linting
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Generate lint report
npm run lint:report
```

## Key Conventions

### Code Style

```typescript
// Use strict TypeScript
function process(input: string): string {
  // Not function(input) or function(input: any)
}

// Prefer const/let over var
const result = compute();

// Use camelCase for variables/functions
const myVariable = 'value';

// Use PascalCase for types/classes
interface MyInterface { }
class MyClass { }

// CLI flags use kebab-case
// --collection-file, --repo-slug
```

### Import Patterns

```typescript
// Domain layer - no feature imports
import { Primitive } from './domain/primitive/types';  // ✅
import { PrimitiveIndex } from '../primitive-index';    // ❌

// CLI commands - use framework
import { Context } from './framework';  // ✅
import * as vscode from 'vscode';       // ❌

// Barrel exports for public API
export * as core from './core';
export type { BundleManifest } from './public';
```

### Error Handling

```typescript
// Use RegistryError for structured errors
import { RegistryError } from './cli/framework';

throw new RegistryError({
  code: 'MODULE.ERROR_TYPE',
  message: 'Human-readable description',
  hint: 'How to fix this',
  context: { key: 'value' }
});
```

### Testing Patterns

```typescript
import { expect } from 'chai';

describe('Feature', () => {
  describe('function()', () => {
    it('should do expected thing', async () => {
      // Arrange
      const input = createInput();
      
      // Act
      const result = await functionUnderTest(input);
      
      // Assert
      expect(result).to.equal(expected);
    });
  });
});
```

## Common Tasks

### Add a New CLI Command

1. Create file in `src/cli/commands/my-command.ts`
2. Implement `createMyCommand()` function
3. Export from `src/cli/index.ts`
4. Add test in `test/cli/commands/my-command.test.ts`

### Add a New Domain Type

1. Add to appropriate file in `src/domain/`
2. Export from `src/domain/index.ts`
3. Re-export from `src/public/` if public API
4. Add validation in `src/validate.ts` if needed

### Add a New Primitive Kind

1. Add to `PRIMITIVE_KINDS` in `src/domain/primitive/types.ts`
2. Update `detectKindFromPath()` in `src/primitive-index/extract.ts`
3. Add extraction logic if needed
4. Update facet handling
5. Add tests

### Add GitHub API Integration

1. Add method to `src/github/client.ts`
2. Handle rate limits with backoff
3. Support ETag caching via `EtagStore`
4. Add tests with `nock`

## Debugging

### Debug Tests

```bash
# Run with Node debugger
node --inspect-brk node_modules/.bin/mocha dist-test/test/my.test.js

# Then attach VS Code debugger
```

### Debug CLI

```bash
# Build with source maps
npm run build:dev

# Run with debugger
node --inspect dist/cli/index.js my-command
```

### Verbose Logging

```bash
# Enable debug logging
DEBUG=prompt-registry:* node dist/cli/index.js command

# Or in code
const debug = require('debug')('prompt-registry:module');
debug('message %o', object);
```

## Troubleshooting

### Build Errors

```bash
# Clean and rebuild
rm -rf dist dist-test
npm run build
npm run compile-tests
```

### Test Failures

```bash
# Run specific test file
npx mocha dist-test/test/my.test.js

# Run with more output
npm test -- --reporter spec

# Stop on first failure
npm test -- --bail
```

### Import Errors

- Check that exports exist in barrel files
- Verify import paths are correct
- Ensure no circular dependencies

### Type Errors

```bash
# Check TypeScript compilation
npx tsc --noEmit

# For tests
npx tsc -p tsconfig.test.json --noEmit
```

## Next Steps

- Read [CLI Framework](./cli-framework.md) for command development
- Read [Primitive Index](./primitive-index.md) for search features
- Read [Testing Guide](../test/AGENTS.md) for testing patterns
- See [Architecture diagrams](../architecture/) for system overview

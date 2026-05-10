# Test Guidelines

Working in `test/` — Unit and integration tests for the library.

## Architecture Overview

```
test/
├── cli/               → CLI command tests
├── domain/            → Domain layer tests
├── primitive-index/   → Search/harvest tests
├── install/           → Installation tests
├── github/            → GitHub integration tests
├── fixtures/          → Test data
└── *.test.ts          → Top-level module tests
```

## Test Framework

- **Runner**: Mocha
- **Assertions**: Chai (expect-style)
- **Mocks**: `nock` (HTTP), `mock-fs` (filesystem), `sinon` (spies/stubs)
- **Compile target**: `dist-test/` via `tsconfig.test.json`

## Running Tests

```bash
cd lib
npm test                      # Run all tests
npm test -- --grep "pattern"  # Run specific tests
npm run compile-tests         # Compile without running
```

## Test Patterns

### Structure

```typescript
import { expect } from 'chai';

describe('Module / feature', () => {
  describe('functionName()', () => {
    it('should do something specific', async () => {
      // Arrange
      const input = createTestInput();
      
      // Act
      const result = await functionUnderTest(input);
      
      // Assert
      expect(result).to.equal(expected);
    });
  });
});
```

### Async Tests

```typescript
// ✅ OK: async/await
it('should handle async operation', async () => {
  const result = await asyncFunction();
  expect(result).to.be.true;
});

// ⚠️ Warning: Returns promise (fine, but prefer async/await)
it('should handle promise', () => {
  return asyncFunction().then(result => {
    expect(result).to.be.true;
  });
});
```

### Mocking HTTP

```typescript
import nock from 'nock';

beforeEach(() => {
  nock.cleanAll();
});

it('fetches from GitHub API', async () => {
  nock('https://api.github.com')
    .get('/repos/owner/repo/contents/file.txt')
    .reply(200, { content: Buffer.from('content').toString('base64') });
  
  const result = await fetchFromGitHub('owner/repo', 'file.txt');
  expect(result).to.equal('content');
});
```

### Mocking Filesystem

```typescript
import mockFs from 'mock-fs';

beforeEach(() => {
  mockFs({
    'collections/': {
      'test.collection.yml': 'id: test\nname: Test Collection'
    }
  });
});

afterEach(() => {
  mockFs.restore();
});
```

### Test Context for CLI

```typescript
import { createTestContext } from './helpers/test-context';

it('runs command', async () => {
  const ctx = createTestContext({
    cwd: '/test-repo',
    fs: mockFs  // In-memory fs
  });
  
  const result = await command.run({ ctx });
  expect(result).to.equal(0);
});
```

## Fixtures

Place reusable test data in `test/fixtures/`:

```
test/fixtures/
├── collections/
│   └── valid.collection.yml
├── bundles/
│   └── test-bundle.zip
└── manifests/
    └── deployment-manifest.yml
```

Load fixtures:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';

const fixture = readFileSync(
  join(__dirname, 'fixtures/collections/valid.collection.yml'),
  'utf-8'
);
```

## Best Practices

1. **One assertion per test** (generally)
2. **Descriptive names**: `it('should reject invalid version format')`
3. **Setup/Teardown**: Use `beforeEach`/`afterEach` for common setup
4. **Isolation**: Tests should not depend on order or shared state
5. **Coverage**: Aim for >80% coverage, 100% for critical paths

## Test Categories

| Category | Location | Pattern |
|----------|----------|---------|
| Unit tests | Same dir as source | `module.test.ts` |
| Integration | `test/cli/integration/` | End-to-end flows |
| Feature tests | `test/primitive-index/` | Complex feature testing |

## Debugging Tests

```bash
# Run with debugging
node --inspect-brk node_modules/.bin/mocha dist-test/test/some.test.js

# Verbose output
npm test -- --reporter spec

# Stop on first failure
npm test -- --bail
```

## See Also

- `../src/cli/AGENTS.md` — CLI patterns to test
- `../src/primitive-index/AGENTS.md` — Index testing patterns
- `cli/AGENTS.md` — CLI-specific test patterns

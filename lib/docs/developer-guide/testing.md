# Testing Guide

Comprehensive guide for testing the collection scripts library.

## Test Framework

- **Runner**: Mocha
- **Assertions**: Chai (expect-style)
- **Mocking**: `nock` (HTTP), `mock-fs` (filesystem), `sinon` (spies)

## Test Structure

```
test/
├── cli/                    # CLI tests
│   ├── commands/          # Individual command tests
│   ├── framework/         # Framework tests
│   └── integration/       # End-to-end tests
├── domain/                # Domain layer tests
├── primitive-index/       # Index/harvest tests
├── install/               # Installation tests
├── github/                # GitHub integration tests
├── fixtures/              # Test data
│   ├── collections/
│   ├── bundles/
│   └── manifests/
└── helpers/               # Test utilities
    ├── test-context.ts
    └── fixtures.ts
```

## Running Tests

```bash
# All tests
cd lib && npm test

# Specific test file
npm test -- --grep "bundle build"

# With pattern
npm test -- --grep "should.*validate"

# Bail on first failure
npm test -- --bail

# Verbose output
npm test -- --reporter spec
```

## Test Patterns

### Basic Test Structure

```typescript
import { expect } from 'chai';

describe('Module / Feature', () => {
  describe('functionName()', () => {
    it('should do expected thing', async () => {
      // Arrange
      const input = createInput();
      
      // Act
      const result = await functionUnderTest(input);
      
      // Assert
      expect(result).to.equal(expected);
    });
    
    it('should handle error case', async () => {
      // Error testing
      try {
        await functionUnderTest(invalidInput);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('expected error');
      }
    });
  });
});
```

### Async Test Patterns

```typescript
// ✅ Good: async/await
it('should handle async', async () => {
  const result = await asyncFunction();
  expect(result).to.be.true;
});

// ⚠️ OK: Promise chain
it('should handle promise', () => {
  return asyncFunction().then(result => {
    expect(result).to.be.true;
  });
});

// ❌ Bad: done callback (inconsistent)
it('should not use done', (done) => {
  asyncFunction().then(result => {
    expect(result).to.be.true;
    done();
  });
});
```

### Setup and Teardown

```typescript
describe('Feature', () => {
  // Run once before all tests
  before(() => {
    // One-time setup
  });
  
  // Run before each test
  beforeEach(() => {
    // Per-test setup
  });
  
  // Run after each test
  afterEach(() => {
    // Cleanup
  });
  
  // Run once after all tests
  after(() => {
    // Final cleanup
  });
});
```

## Mocking

### HTTP Mocking with nock

```typescript
import nock from 'nock';

describe('GitHub integration', () => {
  afterEach(() => {
    nock.cleanAll();
  });
  
  it('fetches repository contents', async () => {
    nock('https://api.github.com')
      .get('/repos/owner/repo/contents/file.txt')
      .reply(200, {
        content: Buffer.from('Hello World').toString('base64')
      });
    
    const result = await fetchFile('owner/repo', 'file.txt');
    expect(result).to.equal('Hello World');
  });
  
  it('handles 404 errors', async () => {
    nock('https://api.github.com')
      .get('/repos/owner/repo/contents/missing.txt')
      .reply(404, { message: 'Not Found' });
    
    await expect(
      fetchFile('owner/repo', 'missing.txt')
    ).to.be.rejectedWith('Not Found');
  });
  
  it('respects rate limits', async () => {
    nock('https://api.github.com')
      .get('/repos/owner/repo/contents/file.txt')
      .reply(403, {}, { 'X-RateLimit-Remaining': '0' });
    
    // Should handle rate limit gracefully
  });
});
```

### Filesystem Mocking with mock-fs

```typescript
import mockFs from 'mock-fs';

describe('Collection validation', () => {
  beforeEach(() => {
    mockFs({
      'collections/': {
        'valid.collection.yml': `
id: test-collection
name: Test Collection
items:
  - file: prompts/test.md
    kind: prompt
`,
        'invalid.collection.yml': 'not: valid yaml: ['
      },
      'prompts/': {
        'test.md': '# Test Prompt\n\nContent'
      }
    });
  });
  
  afterEach(() => {
    mockFs.restore();
  });
  
  it('validates correct collection', async () => {
    const result = await validateCollection('collections/valid.collection.yml');
    expect(result.valid).to.be.true;
  });
  
  it('rejects invalid YAML', async () => {
    const result = await validateCollection('collections/invalid.collection.yml');
    expect(result.valid).to.be.false;
    expect(result.errors[0]).to.include('YAML');
  });
});
```

### Spies and Stubs with sinon

```typescript
import sinon from 'sinon';

describe('With spies', () => {
  let sandbox: sinon.SinonSandbox;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });
  
  afterEach(() => {
    sandbox.restore();
  });
  
  it('calls dependency', async () => {
    const spy = sandbox.spy(dependency, 'method');
    
    await functionUnderTest();
    
    expect(spy.calledOnce).to.be.true;
    expect(spy.firstCall.args[0]).to.equal('expected-arg');
  });
  
  it('stubs return value', async () => {
    sandbox.stub(fs, 'readFile').resolves('mocked content');
    
    const result = await readSomething();
    expect(result).to.equal('mocked content');
  });
  
  it('mocks method', async () => {
    const mock = sandbox.mock(api);
    mock.expects('fetch').once().resolves({ data: [] });
    
    await functionUnderTest();
    
    mock.verify();
  });
});
```

## CLI Testing

### Creating Test Context

```typescript
// test/cli/helpers/test-context.ts
import type { Context } from '../../src/cli/framework';

export function createTestContext(overrides: Partial<Context> = {}): Context {
  return {
    cwd: () => '/test',
    env: {},
    stdout: { write: () => undefined },
    stderr: { write: () => undefined },
    fs: createMockFs(),
    ...overrides
  };
}

function createMockFs() {
  const files = new Map<string, string>();
  
  return {
    readFile: async (path: string) => {
      if (!files.has(path)) throw new Error('ENOENT');
      return files.get(path)!;
    },
    writeFile: async (path: string, data: string) => {
      files.set(path, data);
    },
    exists: async (path: string) => files.has(path),
    mkdir: async () => undefined,
    readdir: async () => []
  };
}
```

### Testing Command Output

```typescript
import { createTestContext } from './helpers/test-context';

describe('list command', () => {
  it('lists collections as JSON', async () => {
    const outputs: string[] = [];
    const ctx = createTestContext({
      fs: {
        readFile: async () => 'id: test\nname: Test',
        exists: async () => true,
        readdir: async () => ['test.collection.yml']
      },
      stdout: { write: (s) => outputs.push(s) }
    });
    
    const command = createListCommand({ output: 'json' });
    await command.run({ ctx });
    
    const result = JSON.parse(outputs.join(''));
    expect(result.data).to.have.length(1);
    expect(result.data[0].id).to.equal('test');
  });
});
```

### Testing Error Handling

```typescript
it('reports errors correctly', async () => {
  const errors: string[] = [];
  const ctx = createTestContext({
    fs: { exists: async () => false },
    stderr: { write: (s) => errors.push(s) }
  });
  
  const command = createCommand({ file: 'missing.txt' });
  const result = await command.run({ ctx });
  
  expect(result).to.equal(1);
  expect(errors.join('')).to.include('not found');
});
```

## Integration Testing

### End-to-End CLI Tests

```typescript
describe('CLI integration', () => {
  const tmpDir = path.join(tmpdir(), 'test-');
  
  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
  });
  
  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });
  
  it('full validation workflow', async () => {
    // Create test files
    await writeFile(
      path.join(tmpDir, 'collection.yml'),
      'id: test\nname: Test\nitems: []'
    );
    
    // Run CLI
    const result = spawnSync('node', [
      path.join(__dirname, '../../dist/cli/index.js'),
      'collection', 'validate',
      '--cwd', tmpDir
    ]);
    
    expect(result.status).to.equal(0);
    expect(result.stdout.toString()).to.include('valid');
  });
});
```

## Fixture Management

### Loading Fixtures

```typescript
// test/helpers/fixtures.ts
import { readFileSync } from 'fs';
import { join } from 'path';

export function loadFixture(name: string): string {
  return readFileSync(
    join(__dirname, '../fixtures', name),
    'utf-8'
  );
}

export function loadJsonFixture<T>(name: string): T {
  return JSON.parse(loadFixture(name));
}
```

### Fixture Organization

```
test/fixtures/
├── collections/
│   ├── valid.collection.yml
│   ├── invalid-id.collection.yml
│   └── missing-items.collection.yml
├── bundles/
│   ├── test-bundle/
│   │   ├── deployment-manifest.yml
│   │   └── prompts/
│   │       └── test.md
│   └── test-bundle.zip
├── manifests/
│   └── deployment-manifest.yml
└── golden-queries.json
```

## Coverage

### Running with Coverage

```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/index.html

# Check thresholds
npm run test:coverage -- --check-coverage
```

### Coverage Configuration

```javascript
// c8.config.js
module.exports = {
  exclude: [
    'dist/**',
    'dist-test/**',
    'test/**',
    '**/*.test.ts'
  ],
  reporter: ['text', 'html', 'lcov'],
  branches: 80,
  functions: 80,
  lines: 80,
  statements: 80
};
```

## Best Practices

### 1. Test Isolation

```typescript
// ✅ Each test independent
it('test 1', async () => {
  const data = await setup();
  // test with data
});

it('test 2', async () => {
  const data = await setup();  // Fresh setup
  // test with data
});
```

### 2. Descriptive Names

```typescript
// ✅ Good: describes behavior
it('should reject collections with invalid IDs');
it('should handle missing manifest gracefully');

// ❌ Bad: vague or implementation-focused
it('test1');
it('works');
it('calls functionA');
```

### 3. One Concept Per Test

```typescript
// ✅ Good: focused test
it('validates ID format', async () => {
  const result = await validateId('Invalid_ID');
  expect(result.valid).to.be.false;
  expect(result.errors[0]).to.include('lowercase');
});

// ❌ Bad: multiple concepts
it('validates everything', async () => {
  // Tests ID, version, items, files...
  // Hard to diagnose failures
});
```

### 4. Arrange-Act-Assert

```typescript
it('follows AAA pattern', async () => {
  // Arrange
  const input = { id: 'test', version: '1.0.0' };
  
  // Act
  const result = await validate(input);
  
  // Assert
  expect(result.valid).to.be.true;
});
```

### 5. Clean Up Resources

```typescript
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});
```

## Debugging Tests

### Verbose Output

```bash
npm test -- --reporter spec --grep "pattern"
```

### Debug Mode

```bash
# Run with debugger
node --inspect-brk node_modules/.bin/mocha dist-test/test/my.test.js

# Then attach VS Code debugger
```

### Skip Tests

```typescript
it.skip('skipped test', async () => {
  // Won't run
});

// Or from CLI
npm test -- --grep "other pattern"
```

### Focus Tests

```typescript
it.only('only this test runs', async () => {
  // Focus on debugging this one
});
```

## See Also

- [Mocha Documentation](https://mochajs.org/)
- [Chai Documentation](https://www.chaijs.com/)
- [nock Documentation](https://github.com/nock/nock)
- [CLI Testing](./cli-framework.md) — Testing CLI commands

# CLI Test Guidelines

Working in `test/cli/` — Testing CLI commands and framework.

## Structure

```
test/cli/
├── commands/          → Command-specific tests (29 files)
├── framework/         → Framework utility tests
├── integration/       → End-to-end CLI tests
└── helpers/           → Test utilities
    └── test-context.ts
```

## Testing Commands

### Basic Pattern

```typescript
import { expect } from 'chai';
import { createMyCommand } from '../../src/cli/commands/my-command';
import { createTestContext } from './helpers/test-context';

describe('my-command', () => {
  it('should succeed with valid input', async () => {
    const ctx = createTestContext({
      cwd: '/test-repo',
      fs: {
        readFile: async () => 'content',
        writeFile: async () => undefined,
        exists: async () => true
      }
    });
    
    const command = createMyCommand({
      requiredFlag: 'value'
    });
    
    const result = await command.run({ ctx });
    expect(result).to.equal(0);
  });
});
```

### Capturing Output

```typescript
it('should output formatted results', async () => {
  const outputs: string[] = [];
  const ctx = createTestContext({
    stdout: { write: (s: string) => outputs.push(s) }
  });
  
  const command = createListCommand({ output: 'json' });
  await command.run({ ctx });
  
  const output = outputs.join('');
  const parsed = JSON.parse(output);
  expect(parsed).to.have.property('data');
});
```

### Testing Errors

```typescript
it('should return error code on failure', async () => {
  const ctx = createTestContext({
    fs: { exists: async () => false }
  });
  
  const command = createCommand({ file: 'missing.txt' });
  const result = await command.run({ ctx });
  
  expect(result).to.equal(1);
});
```

## Integration Tests

Located in `test/cli/integration/`:

```typescript
describe('CLI integration', () => {
  it('full validation workflow', async () => {
    // Uses real filesystem in temp directory
    const tmpDir = await mkdtemp(join(tmpdir(), 'test-'));
    
    // Create test files
    await writeFile(join(tmpDir, 'collection.yml'), '...');
    
    // Run CLI as subprocess
    const result = spawnSync('node', [
      'dist/cli/index.js',
      'collection', 'validate',
      '--cwd', tmpDir
    ]);
    
    expect(result.status).to.equal(0);
  });
});
```

## Mock Context Helper

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
```

## Testing Output Formats

```typescript
describe('output formats', () => {
  const formats = ['text', 'json', 'yaml', 'ndjson'];
  
  formats.forEach(format => {
    it(`supports ${format} output`, async () => {
      const command = createCommand({ output: format });
      // Test format-specific output
    });
  });
});
```

## Best Practices

1. **Mock I/O**: Never touch real filesystem in unit tests
2. **Test exit codes**: Commands should return 0 (success) or 1 (failure)
3. **Test all formats**: If command supports JSON/YAML, test them
4. **Test errors**: Verify error messages are helpful
5. **Test edge cases**: Empty inputs, invalid flags, missing files

## Common Patterns

### Testing Argument Parsing

```typescript
it('parses multiple --changed-path flags', () => {
  const args = ['--changed-path', 'a.txt', '--changed-path', 'b.txt'];
  const paths = parseMultiArg(args, '--changed-path');
  expect(paths).to.deep.equal(['a.txt', 'b.txt']);
});
```

### Testing with Fixtures

```typescript
import { loadFixture } from '../helpers/fixtures';

it('validates collection from fixture', async () => {
  const collection = loadFixture('collections/valid.yml');
  const result = await validateCollection(collection);
  expect(result.valid).to.be.true;
});
```

## See Also

- `../../src/cli/AGENTS.md` — CLI implementation patterns
- `../AGENTS.md` — General test patterns

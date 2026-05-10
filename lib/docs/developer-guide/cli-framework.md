# CLI Framework

Guide for developing CLI commands using the framework.

## Overview

The CLI framework provides:
- **Command definitions**: Standardized command interface
- **Context abstraction**: Testable I/O operations
- **Error handling**: Structured errors with hints
- **Output formatting**: Text, JSON, YAML, ndjson
- **Argument parsing**: Helper functions

## Creating a Command

### Basic Structure

```typescript
import { defineCommand, type CommandDefinition, Context, RegistryError } from './framework';

export interface MyOptions {
  output?: OutputFormat;
  requiredFlag: string;
}

export function createMyCommand(opts: MyOptions): CommandDefinition {
  return defineCommand({
    // Command path for subcommands
    path: ['parent', 'child'],
    
    // Description for help
    description: 'What this command does',
    
    // Main execution function
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      try {
        // Command logic
        return 0;  // Success
      } catch (err) {
        // Error handling
        return 1;  // Failure
      }
    }
  });
}
```

### Using Context

The `Context` interface abstracts I/O for testability:

```typescript
interface Context {
  cwd(): string;                          // Current working directory
  env: Record<string, string | undefined>; // Environment variables
  stdout: OutputStream;                   // Standard output
  stderr: OutputStream;                   // Standard error
  fs: FileSystem;                         // File operations
}
```

#### File Operations

```typescript
// Read file
const content = await ctx.fs.readFile('/path/to/file');

// Write file
await ctx.fs.writeFile('/path/to/file', data);

// Check existence
const exists = await ctx.fs.exists('/path/to/file');

// Create directory
await ctx.fs.mkdir('/path/to/dir', { recursive: true });

// Read directory
const entries = await ctx.fs.readdir('/path/to/dir');
```

#### Output Streams

```typescript
// Write to stdout
ctx.stdout.write('Message\n');

// Write to stderr
ctx.stderr.write('Warning\n');
```

## Error Handling

### RegistryError

Structured errors with context:

```typescript
import { RegistryError } from './framework';

throw new RegistryError({
  code: 'CATEGORY.ERROR_TYPE',      // Hierarchical code
  message: 'Human-readable error',  // Main message
  hint: 'How to fix this',          // Optional help
  context: {                         // Structured data
    file: path,
    line: number
  },
  cause: originalError              // Optional wrapped error
});
```

### Error Categories

| Category | Purpose |
|----------|---------|
| `USAGE` | CLI usage errors |
| `BUNDLE` | Bundle-related errors |
| `COLLECTION` | Collection validation errors |
| `INSTALL` | Installation errors |
| `GITHUB` | GitHub API errors |
| `FS` | Filesystem errors |
| `INTERNAL` | Unexpected errors |

### Error Formatting

```typescript
import { renderError } from './framework';

// In catch block
renderError(err, ctx);
// Outputs formatted error to ctx.stderr
```

## Output Formatting

### formatOutput Helper

```typescript
import { formatOutput, type OutputFormat } from './framework';

formatOutput({
  ctx,
  command: 'command.name',
  output: opts.output ?? 'text',
  status: 'ok',           // or 'error'
  data: resultObject,
  textRenderer: (d) => `Result: ${d.field}\n`
});
```

### Supported Formats

| Format | Description |
|--------|-------------|
| `text` | Human-readable (default) |
| `json` | Single JSON object |
| `yaml` | YAML format |
| `ndjson` | Newline-delimited JSON |

### Text Renderer Tips

```typescript
textRenderer: (data) => {
  const lines = [
    `Bundle: ${data.id}`,
    `Version: ${data.version}`,
    `Files:`,
    ...data.files.map(f => `  - ${f}`)
  ];
  return lines.join('\n') + '\n';
}
```

## Argument Parsing

### Helper Functions

```typescript
import { parseSingleArg, parseMultiArg, hasFlag, getPositionalArg } from '..';

// Single value argument
const file = parseSingleArg(args, '--file');  // string | undefined

// Multiple values (can be repeated)
const paths = parseMultiArg(args, '--path');  // string[]

// Boolean flag
const verbose = hasFlag(args, '--verbose');   // boolean

// Positional argument
const command = getPositionalArg(args, 1);    // string | undefined
```

### Argument Patterns

```typescript
// Process arguments before command
const processedArgs: string[] = [];
let i = 0;
while (i < args.length) {
  const arg = args[i];
  
  if (arg === '--file') {
    const next = args[i + 1];
    if (next && !next.startsWith('-')) {
      // Store the value
      processedArgs.push(arg, next);
      i += 2;
    } else {
      // Handle missing value
      ctx.stderr.write('Error: --file requires a value\n');
      return 1;
    }
  } else {
    processedArgs.push(arg);
    i++;
  }
}
```

## Testing Commands

### Creating Test Context

```typescript
import { createTestContext } from '../test/cli/helpers/test-context';

const ctx = createTestContext({
  cwd: '/test-repo',
  env: { GITHUB_TOKEN: 'test-token' },
  fs: {
    readFile: async (path) => 'content',
    writeFile: async (path, data) => undefined,
    exists: async (path) => true,
    mkdir: async (path, opts) => undefined,
    readdir: async (path) => []
  }
});
```

### Capturing Output

```typescript
const outputs: string[] = [];
const ctx = createTestContext({
  stdout: { write: (s) => outputs.push(s) }
});

const command = createMyCommand({ ... });
const result = await command.run({ ctx });

// Verify output
expect(outputs.join('')).to.include('Expected text');
```

### Testing Errors

```typescript
it('should handle missing file', async () => {
  const ctx = createTestContext({
    fs: { exists: async () => false }
  });
  
  const command = createMyCommand({ file: 'missing.txt' });
  const result = await command.run({ ctx });
  
  expect(result).to.equal(1);
  expect(outputs.join('')).to.include('not found');
});
```

## Best Practices

### 1. Use Context for All I/O

```typescript
// ✅ Good
const content = await ctx.fs.readFile(path);

// ❌ Bad
import { readFileSync } from 'fs';
const content = readFileSync(path);
```

### 2. Validate Early

```typescript
run: async ({ ctx }) => {
  // Validate inputs first
  if (!opts.requiredFlag) {
    ctx.stderr.write('Error: --required-flag is required\n');
    return 1;
  }
  
  // Then do work
  // ...
}
```

### 3. Provide Helpful Errors

```typescript
throw new RegistryError({
  code: 'INSTALL.TARGET_NOT_FOUND',
  message: `Target '${targetId}' not found`,
  hint: 'Run "prompt-registry target list" to see available targets'
});
```

### 4. Support All Output Formats

```typescript
formatOutput({
  ctx,
  command: 'my.command',
  output: opts.output ?? 'text',
  status: 'ok',
  data,
  textRenderer: (d) => formatForHumans(d),
  // json/yaml/ndjson auto-generated from data
});
```

### 5. Handle Async Properly

```typescript
// ✅ Good
const results = await Promise.all(
  items.map(item => processItem(item))
);

// ❌ Bad (fire and forget)
items.forEach(item => processItem(item));
```

## Advanced Patterns

### Subcommand Dispatch

```typescript
// Parent command dispatches to children
export function createParentCommand(): CommandDefinition {
  return defineCommand({
    path: ['parent'],
    description: 'Parent command with subcommands',
    run: async ({ ctx, args }) => {
      const subcommand = args[0];
      
      switch (subcommand) {
        case 'child1':
          return createChild1Command({}).run({ ctx, args: args.slice(1) });
        case 'child2':
          return createChild2Command({}).run({ ctx, args: args.slice(1) });
        default:
          ctx.stderr.write('Unknown subcommand\n');
          return 1;
      }
    }
  });
}
```

### Progress Reporting

```typescript
run: async ({ ctx }) => {
  const items = await getItems();
  
  for (let i = 0; i < items.length; i++) {
    ctx.stdout.write(`Processing ${i + 1}/${items.length}...\r`);
    await process(items[i]);
  }
  
  ctx.stdout.write('\nDone!\n');
  return 0;
}
```

### Spinner Pattern

```typescript
run: async ({ ctx }) => {
  const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  
  const interval = setInterval(() => {
    ctx.stdout.write(`\r${spinner[i]} Working...`);
    i = (i + 1) % spinner.length;
  }, 100);
  
  try {
    await longOperation();
    clearInterval(interval);
    ctx.stdout.write('\r✓ Done!    \n');
    return 0;
  } catch (err) {
    clearInterval(interval);
    ctx.stdout.write('\r✗ Failed   \n');
    throw err;
  }
}
```

## See Also

- [Getting Started](./getting-started.md) — Setup and workflow
- [Testing Guide](../test/AGENTS.md) — Testing CLI commands
- [Architecture](../../architecture/) — System diagrams

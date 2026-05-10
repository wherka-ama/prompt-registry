# CLI Layer Guidelines

Working in `src/cli/` — CLI framework and command implementations.

## Architecture Overview

```
src/cli/
├── commands/          → Individual CLI commands (29 files)
│   ├── bundle-build.ts
│   ├── bundle-manifest.ts
│   ├── collection-validate.ts
│   ├── index-search.ts
│   └── ...
├── framework/         → CLI framework abstractions
│   ├── index.ts       → Core types (CommandDefinition, Context)
│   ├── errors.ts      → RegistryError hierarchy
│   ├── formatters.ts  → Output formatting (text, json, yaml, ndjson)
│   └── production-context.ts → Real filesystem implementation
└── index.ts           → CLI entry point, argument parsing
```

## Key Conventions

### No Framework Imports

**CRITICAL**: Commands in `src/cli/commands/` cannot import VS Code or other UI frameworks:

```typescript
// ❌ FORBIDDEN
import * as vscode from 'vscode';
import { window } from 'vscode';

// ✅ OK: Use framework abstractions
import { Context, RegistryError } from './framework';
```

Enforced by ESLint rule `local/no-framework-imports`.

### Command Structure

Every command follows this pattern:

```typescript
import { defineCommand, type CommandDefinition } from './framework';

export interface MyCommandOptions {
  output?: OutputFormat;
  requiredFlag: string;
}

export const createMyCommand = (opts: MyCommandOptions): CommandDefinition =>
  defineCommand({
    path: ['command', 'subcommand'],      // e.g., ['bundle', 'build']
    description: 'What this command does',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      try {
        // Command logic here
        return 0;  // Success exit code
      } catch (err) {
        // Error handling
        return 1;  // Failure exit code
      }
    }
  });
```

### Context Usage

Use `ctx` for all I/O operations (enables testing):

```typescript
// ✅ OK: Use Context.fs
const content = await ctx.fs.readFile(path);
await ctx.fs.writeFile(path, data);
const exists = await ctx.fs.exists(path);

// ❌ FORBIDDEN: Direct fs usage (except in framework/)
import { readFileSync } from 'fs';
```

### Output Formats

Support multiple output formats via `formatOutput`:

```typescript
import { formatOutput, type OutputFormat } from './framework';

formatOutput({
  ctx,
  command: 'command.name',
  output: opts.output ?? 'text',
  status: 'ok',
  data: resultData,
  textRenderer: (d) => `Human-readable: ${d.field}\n`
});
```

### Error Handling

Use `RegistryError` with structured codes:

```typescript
import { RegistryError } from './framework';

throw new RegistryError({
  code: 'BUNDLE.NOT_FOUND',           // Hierarchical code
  message: 'Bundle manifest not found',
  hint: 'Check the path or run from repo root',
  context: { path: manifestPath }     // Structured context
});
```

### Argument Parsing

Use helpers from `src/cli/index.ts`:

```typescript
import { parseSingleArg, parseMultiArg, hasFlag } from '..';

const collectionFile = parseSingleArg(args, '--collection-file');
const changedPaths = parseMultiArg(args, '--changed-path');
const verbose = hasFlag(args, '--verbose');
```

## Testing Commands

See `test/cli/AGENTS.md` for testing patterns.

Key points:
- Mock `Context.fs` for file operations
- Capture `ctx.stdout.write` for output assertions
- Use `createTestContext()` helper

## See Also

- `../framework/index.ts` — Framework types and utilities
- `../../test/cli/AGENTS.md` — Testing CLI commands

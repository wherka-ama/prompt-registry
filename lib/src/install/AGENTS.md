# Installation System Guidelines

Working in `src/install/` — Bundle installation, target management, and scope writers.

## Architecture Overview

```
src/install/
├── target-state-store.ts    → Target configuration management
├── repository-scope-writer.ts → Repository-scoped installation
├── user-scope-writer.ts    → User-scoped installation
├── uninstall-pipeline.ts   → Uninstall orchestration
├── lockfile.ts             → Lockfile operations
├── target-writer.ts        → Target writer interface and implementation
└── types.ts                → Installation types (in domain/)
```

## Key Concepts

### Target

An installation destination with a specific type:

```typescript
interface Target {
  id: string;
  type: 'vscode' | 'vscode-insiders' | 'copilot-cli' | 'kiro' | 'windsurf';
  path: string;  // Installation directory
}
```

Five reserved target types with known installation paths.

### Scope

Installation scope determines where files are written:

| Scope | Location | Lockfile |
|-------|----------|----------|
| `user` | User config directory | No |
| `workspace` | Workspace config directory | No |
| `repository` | `.github/` in repo root | `prompt-registry.lock.json` |

### Lockfile

Repository-scoped installations use a lockfile for tracking:

```typescript
interface Lockfile {
  version: string;
  bundles: Array<{
    id: string;
    version: string;
    installedAt: string;
    manifest: DeploymentManifest;
  }>;
}
```

## Installation Flow

```
1. Validate bundle (deployment-manifest.yml)
2. Determine target path from target type
3. Write files to appropriate scope directory
4. Update lockfile (if repository scope)
5. Record installation metadata
```

## Uninstall Flow

```
1. Read lockfile to find installed bundle entry
2. Plan file removals based on target scope
3. Execute removals via scope writer
4. Update lockfile (remove entry)
5. Update target state
6. Clean empty directories
7. Remove from git exclude (if repository scope, local-only mode)
```

## Scope Writers

### RepositoryScopeWriter

Writes to `.github/` directory:

- `prompts/` → `.github/prompts/`
- `instructions/` → `.github/instructions/`
- `skills/` → `.github/skills/`

Handles skill directory merging and cleanup.

### UserScopeWriter

Writes to user config directories:

- VS Code: `~/.config/Code/User/prompts/`
- Platform-specific paths via `${HOME}` expansion

Implements `TargetWriter` interface with write and remove capabilities for uninstall symmetry.

## Target Configuration

Targets are stored in `prompt-registry.yml`:

```yaml
targets:
  my-vscode:
    type: vscode
    path: /custom/path  # Optional override
```

## Best Practices

1. **Atomic operations**: Write to temp, then rename
2. **Backup**: Keep backups before destructive operations
3. **Validation**: Validate bundle before installation
4. **Cleanup**: Remove temp files even on error
5. **Platform paths**: Use `path.join()`, never hardcode separators

## Error Handling

```typescript
throw new RegistryError({
  code: 'INSTALL.TARGET_NOT_FOUND',
  message: `Target '${targetId}' not found`,
  hint: 'Run "prompt-registry target list" to see available targets',
  context: { targetId }
});
```

## Testing

See `test/install/AGENTS.md`

Key patterns:
- Use `mock-fs` for filesystem mocking
- Test both install and remove operations
- Verify lockfile updates
- Test both user and repository scopes

## UninstallPipeline

The `UninstallPipeline` class orchestrates uninstall operations:

- `plan(bundleId)` - Plan uninstall for a single bundle
- `run(bundleId)` - Execute uninstall for a single bundle
- `planAll()` - Plan uninstall for all bundles on target
- `runAll()` - Execute uninstall for all bundles on target
- `runFromLockfile()` - Execute uninstall from lockfile (handles missing file gracefully)

The pipeline ensures full symmetry with install: all files are removed, lockfile entries are deleted, and cleanup operations (empty directories, git exclude) are performed.

## See Also

- `../cli/commands/AGENTS.md` — Install command implementation
- `../domain/install/AGENTS.md` — Installation types

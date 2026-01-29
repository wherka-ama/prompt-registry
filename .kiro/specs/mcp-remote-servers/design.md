# MCP Remote Server Support and Duplicate Detection - Design Document

## Problem Statement

### Issue 1: Remote MCP Server Configurations Not Handled

The current MCP implementation only supports stdio-based servers. Remote servers (HTTP/SSE) are:
1. Read from collection/bundle configuration correctly as strings
2. Incorrectly typed as `McpStdioServerConfig` instead of `McpRemoteServerConfig`
3. Processed by `McpConfigService.processServerDefinition()` which only handles stdio properties
4. Missing URL/headers handling in the config service

### Issue 2: Duplicate MCP Servers Across Bundles

When multiple bundles define the same MCP server (by URL or command signature), they are all installed, leading to:
1. Duplicate entries in `mcp.json`
2. Potential conflicts and confusion
3. No way to identify and disable duplicates

## Design Goals

1. **Proper Type Discrimination**: Fix the type system to properly distinguish stdio vs remote servers
2. **Remote Server Support**: Handle HTTP/SSE servers in `McpConfigService` and `McpServerManager`
3. **Duplicate Detection**: Identify semantically equivalent servers across bundles
4. **Duplicate Handling**: Disable duplicates while preserving their configuration for reference

## Type System Refactoring

### Current Types (Problematic)

```typescript
// PROBLEM: McpServerDefinition is aliased to stdio-only
export type McpServerDefinition = McpStdioServerConfig;
export type McpServersManifest = Record<string, McpServerDefinition>;
```

### Proposed Types

```typescript
/**
 * Type guard to check if a server config is stdio-based
 */
export function isStdioServerConfig(config: McpServerConfig): config is McpStdioServerConfig {
    return !('url' in config) || config.type === 'stdio' || config.type === undefined;
}

/**
 * Type guard to check if a server config is remote (HTTP/SSE)
 */
export function isRemoteServerConfig(config: McpServerConfig): config is McpRemoteServerConfig {
    return 'url' in config && (config.type === 'http' || config.type === 'sse');
}

/**
 * Union type for server definitions (replaces legacy alias)
 */
export type McpServerDefinition = McpServerConfig;

/**
 * Manifest of MCP servers (supports both stdio and remote)
 */
export type McpServersManifest = Record<string, McpServerConfig>;
```

## McpConfigService Changes

### New Method: `processServerDefinition()` (Refactored)

```typescript
processServerDefinition(
    serverName: string,
    definition: McpServerConfig,
    bundleId: string,
    bundleVersion: string,
    bundlePath: string
): McpServerConfig {
    const context: McpVariableContext = { bundlePath, bundleId, bundleVersion, env: process.env };

    if (isRemoteServerConfig(definition)) {
        return this.processRemoteServerDefinition(definition, context);
    } else {
        return this.processStdioServerDefinition(definition, context);
    }
}

private processRemoteServerDefinition(
    definition: McpRemoteServerConfig,
    context: McpVariableContext
): McpRemoteServerConfig {
    return {
        type: definition.type,
        url: this.substituteVariables(definition.url, context)!,
        headers: definition.headers ? Object.fromEntries(
            Object.entries(definition.headers).map(([k, v]) => [
                k,
                this.substituteVariables(v, context)!
            ])
        ) : undefined,
        disabled: definition.disabled,
        description: definition.description
    };
}

private processStdioServerDefinition(
    definition: McpStdioServerConfig,
    context: McpVariableContext
): McpStdioServerConfig {
    return {
        type: definition.type,
        command: this.substituteVariables(definition.command, context)!,
        args: definition.args?.map(arg => this.substituteVariables(arg, context)!),
        env: definition.env ? Object.fromEntries(
            Object.entries(definition.env).map(([k, v]) => [k, this.substituteVariables(v, context)!])
        ) : undefined,
        envFile: this.substituteVariables(definition.envFile, context),
        disabled: definition.disabled,
        description: definition.description
    };
}
```

## Duplicate Detection Strategy

### Server Identity

Two servers are considered duplicates if they have the same "identity":

**For Stdio Servers:**
- Same `command` AND same `args` (after variable substitution)

**For Remote Servers:**
- Same `url` (after variable substitution)

### Duplicate Handling

When duplicates are detected:
1. Keep the **first** installed server enabled
2. Mark subsequent duplicates as `disabled: true`
3. Add a `description` noting the duplicate status and which bundle owns the original
4. Store duplicate relationship in tracking metadata

### New Method: `detectAndDisableDuplicates()`

```typescript
interface DuplicateInfo {
    serverName: string;
    duplicateOf: string;
    bundleId: string;
    originalBundleId: string;
}

async detectAndDisableDuplicates(
    scope: 'user' | 'workspace'
): Promise<{ duplicatesDisabled: DuplicateInfo[]; config: McpConfiguration }> {
    const config = await this.readMcpConfig(scope);
    const tracking = await this.readTrackingMetadata(scope);
    
    const serverIdentities = new Map<string, { serverName: string; bundleId: string }>();
    const duplicatesDisabled: DuplicateInfo[] = [];
    
    for (const [serverName, serverConfig] of Object.entries(config.servers)) {
        const identity = this.computeServerIdentity(serverConfig);
        const existing = serverIdentities.get(identity);
        
        if (existing && !serverConfig.disabled) {
            // This is a duplicate - disable it
            config.servers[serverName] = {
                ...serverConfig,
                disabled: true,
                description: `Duplicate of ${existing.serverName} (from bundle ${existing.bundleId})`
            };
            
            const metadata = tracking.managedServers[serverName];
            duplicatesDisabled.push({
                serverName,
                duplicateOf: existing.serverName,
                bundleId: metadata?.bundleId || 'unknown',
                originalBundleId: existing.bundleId
            });
        } else if (!serverConfig.disabled) {
            const metadata = tracking.managedServers[serverName];
            serverIdentities.set(identity, {
                serverName,
                bundleId: metadata?.bundleId || 'unknown'
            });
        }
    }
    
    return { duplicatesDisabled, config };
}

private computeServerIdentity(config: McpServerConfig): string {
    if (isRemoteServerConfig(config)) {
        return `remote:${config.url}`;
    } else {
        const argsStr = config.args?.join('|') || '';
        return `stdio:${config.command}:${argsStr}`;
    }
}
```

## Integration Points

### McpServerManager.installServers()

After installing servers, call `detectAndDisableDuplicates()`:

```typescript
async installServers(...): Promise<McpInstallResult> {
    // ... existing installation logic ...
    
    // After successful installation, detect and disable duplicates
    const { duplicatesDisabled, config } = await this.configService.detectAndDisableDuplicates(options.scope);
    
    if (duplicatesDisabled.length > 0) {
        await this.configService.writeMcpConfig(config, options.scope, false);
        result.warnings?.push(
            `Disabled ${duplicatesDisabled.length} duplicate server(s): ${duplicatesDisabled.map(d => d.serverName).join(', ')}`
        );
    }
    
    return result;
}
```

## Test Scenarios

### Type Guards
1. `isStdioServerConfig` returns true for stdio configs
2. `isStdioServerConfig` returns true for configs without type (backward compat)
3. `isRemoteServerConfig` returns true for http configs
4. `isRemoteServerConfig` returns true for sse configs
5. `isRemoteServerConfig` returns false for stdio configs

### Remote Server Processing
1. Process HTTP server with URL substitution
2. Process SSE server with headers substitution
3. Process remote server with all variable types (bundlePath, env)
4. Preserve disabled and description fields

### Stdio Server Processing (Existing + Enhanced)
1. Process stdio server with command/args substitution
2. Process stdio server with env substitution
3. Process stdio server with envFile substitution
4. Handle type field correctly

### Duplicate Detection
1. Detect duplicate stdio servers (same command + args)
2. Detect duplicate remote servers (same URL)
3. First server remains enabled, duplicates disabled
4. Duplicate description references original
5. No false positives for different servers
6. Handle mixed stdio/remote without cross-type duplicates

### Integration
1. Install bundle with remote servers
2. Install bundle with mixed stdio/remote servers
3. Install multiple bundles, duplicates auto-disabled
4. Uninstall bundle, duplicates re-enabled if applicable

## Migration Notes

- `McpServerDefinition` type alias change is backward compatible (union includes original type)
- Existing stdio-only manifests continue to work
- No changes to collection schema required (already supports remote)

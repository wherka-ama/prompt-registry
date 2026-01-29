# Bug Report: MCP Servers Not Installed from GitHub Release Bundles

## Description
MCP servers defined in collection files are not being installed when bundles are installed from GitHub Releases. The log shows "No MCP servers to install for bundle" even though the collection repository clearly contains MCP server definitions.

## Steps to Reproduce
1. Add a GitHub Release source pointing to a repository with MCP servers defined in the collection (e.g., `https://github.com/example-org/example-collection`)
2. Install a bundle from that source (e.g., "Example Bundle v0.1.1")
3. Check the installation logs
4. Observe that MCP servers are not detected or installed

## Expected Behavior
- The MCP servers defined in the collection's `mcp.items` field should be extracted during bundle build
- The `deployment-manifest.yml` should include the `mcpServers` field
- During installation, the extension should detect and install the MCP servers to the appropriate scope

## Actual Behavior
- The log shows: `[2026-01-26T15:13:39.945Z] DEBUG: No MCP servers to install for bundle example-org-example-collection-example-0.1.1`
- MCP servers are not installed despite being defined in the source collection
- The `deployment-manifest.yml` generated during bundle build does not include the `mcpServers` field

## Error Logs
```
[2026-01-26T15:13:39.924Z] INFO: Installing bundle from buffer: Example Bundle v0.1.1
[2026-01-26T15:13:39.925Z] DEBUG: Created temp directory: /home/user/.config/Code - Insiders/User/globalStorage/example.prompt-registry/temp/bundle-1769440419925
[2026-01-26T15:13:39.926Z] DEBUG: Wrote bundle buffer to: /home/user/.config/Code - Insiders/User/globalStorage/example.prompt-registry/temp/bundle-1769440419925/example-org-example-collection-example-0.1.1.zip (9294 bytes)
[2026-01-26T15:13:39.937Z] DEBUG: Extracted bundle to: /home/user/.config/Code - Insiders/User/globalStorage/example.prompt-registry/temp/bundle-1769440419925/extracted
[2026-01-26T15:13:39.938Z] DEBUG: Validating manifest: /home/user/.config/Code - Insiders/User/globalStorage/example.prompt-registry/temp/bundle-1769440419925/extracted/deployment-manifest.yml
[2026-01-26T15:13:39.939Z] DEBUG: Bundle manifest validation passed
[2026-01-26T15:13:39.939Z] DEBUG: Bundle validation passed
[2026-01-26T15:13:39.939Z] DEBUG: Installation directory: /home/user/.config/Code - Insiders/User/globalStorage/example.prompt-registry/bundles/example-org-example-collection-example-0.1.1
[2026-01-26T15:13:39.943Z] DEBUG: Files copied to installation directory
[2026-01-26T15:13:39.945Z] DEBUG: Temp directory cleaned up
[2026-01-26T15:13:39.945Z] DEBUG: No MCP servers to install for bundle example-org-example-collection-example-0.1.1
[2026-01-26T15:13:39.945Z] DEBUG: MCP servers installation completed
```

## Root Cause
The `lib/bin/generate-manifest.js` script, which is used by the CI workflow to build GitHub Release bundles, was not copying the `mcp` or `mcpServers` field from the collection YAML file to the generated `deployment-manifest.yml`. This resulted in bundles that had no MCP server definitions in their manifest, causing the extension to skip MCP installation.

## Operating System
Linux (Ubuntu)

## VS Code Version
VS Code Insiders

## Extension Version
0.0.2

## Registry Source Type
GitHub

## Additional Context
- **Affected file:** `lib/bin/generate-manifest.js` (lines 120-136)
- **Collection schema:** MCP servers are defined under `mcp.items` in the collection schema (`schemas/collection.schema.json`)
- **Remote collection:** https://github.com/example-org/example-collection
- **Fix applied:** Modified `generate-manifest.js` to extract and include `mcpServers` in the deployment manifest
- **Verification:** All tests pass (lib: 102 passing, extension: 2180 passing)

## Fix
The fix has been implemented in `lib/bin/generate-manifest.js`:

```javascript
// Extract MCP servers from either 'mcp.items' or 'mcpServers' field (matching AwesomeCopilotAdapter)
const mcpServers = collection.mcpServers || (collection.mcp && collection.mcp.items);

// Create deployment manifest
const manifest = {
  id: manifestId,
  version: args.version,
  name: collection.name || packageJson.description,
  description: collection.description || packageJson.description,
  author: collection.author || packageJson.author || 'Prompt Registry',
  tags: collection.tags || packageJson.keywords || [],
  environments: ['vscode', 'windsurf', 'cursor'],
  license: packageJson.license || 'MIT',
  repository: packageJson.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '') || '',
  prompts: prompts,
  dependencies: [],
  ...(mcpServers && Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
};
```

**Note:** Existing GitHub Release bundles will need to be rebuilt and republished for the fix to take effect.

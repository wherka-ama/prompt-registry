## Description

This PR adds comprehensive support for remote MCP servers (HTTP/SSE) and implements automatic duplicate detection to prevent conflicts when multiple collections define the same MCP server.

**Key improvements:**
- Remote MCP servers can now be defined alongside stdio servers
- Automatic duplicate detection ensures only one instance of each server is active
- JSONC parser handles VS Code's `mcp.json` format (trailing commas, comments)
- Comprehensive test coverage with 43 new tests

## Type of Change

- [x] ✨ New feature (non-breaking change which adds functionality)
- [x] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [x] 📝 Documentation update
- [x] 🧪 Test coverage improvement

## Related Issues

Relates to MCP integration improvements and collection schema enhancements.

## Changes Made

### Type System
- Added `isStdioServerConfig()` and `isRemoteServerConfig()` type guards for proper server type discrimination
- Updated `McpServerDefinition` to support union of stdio and remote server configs
- Fixed type aliasing issue where remote servers were incorrectly treated as stdio-only

### Core Functionality
- **Remote Server Support**: Refactored `McpConfigService.processServerDefinition()` to handle both stdio and remote (HTTP/SSE) servers
- **Variable Substitution**: Extended to support URLs and headers in remote servers (e.g., `${env:API_TOKEN}`)
- **Duplicate Detection**: Added `computeServerIdentity()` to generate unique identities:
  - Stdio: `stdio:{command}:{args|joined|by|pipe}`
  - Remote: `remote:{url}`
- **Automatic Deduplication**: Added `detectAndDisableDuplicates()` that:
  - Keeps first installed server enabled
  - Disables subsequent duplicates with descriptive messages
  - Re-enables a duplicate when the active server is removed
  - Maintains invariant: at least one active until all bundles removed
- **JSONC Parsing**: Use `jsonc-parser` to handle VS Code's `mcp.json` format (trailing commas, comments)

### Integration
- Integrated duplicate detection into `McpServerManager.installServers()` lifecycle
- Updated `MarketplaceViewProvider` to display both stdio (⚡) and remote (🌐) server types with appropriate details

### Documentation
- **Author Guide** (`docs/author-guide/collection-schema.md`): Added remote server examples and duplicate detection behavior
- **Contributor Guide** (`docs/contributor-guide/architecture/mcp-integration.md`): Added algorithm details, flowchart, and type guard documentation
- **Design Document** (`.kiro/specs/mcp-remote-servers/design.md`): Comprehensive design rationale and implementation details

## Testing

### Test Coverage

- [x] Unit tests added/updated
- [x] Integration tests added/updated
- [x] Manual testing completed
- [x] All existing tests pass

**43 new tests added:**
- `McpConfigService.remoteServers.test.ts` (22 tests): Type guards, remote server processing, variable substitution
- `McpConfigService.duplicateDetection.test.ts` (16 tests): Identity computation, duplicate detection logic, edge cases
- `McpConfigService.duplicateLifecycle.test.ts` (5 tests): Install multiple collections, gradual removal, invariant verification

**Test Results:**
- All 2223 tests passing (2218 existing + 5 new lifecycle tests)
- No regressions introduced

### Manual Testing Steps

1. Create collection with remote MCP server (HTTP/SSE)
2. Install collection and verify server appears in VS Code's `mcp.json`
3. Install second collection with same server (same URL or command+args)
4. Verify duplicate is disabled with description noting the original
5. Uninstall first collection
6. Verify second collection's server becomes active
7. Test JSONC parsing by adding trailing comma to `mcp.json`

### Tested On

- [x] Linux
- [x] VS Code Insiders

## Screenshots

N/A - Backend changes with no UI modifications (except MCP server display icons)

## Checklist

- [x] My code follows the project's style guidelines
- [x] I have performed a self-review of my code
- [x] I have commented my code, particularly in hard-to-understand areas
- [x] I have made corresponding changes to the documentation
- [x] My changes generate no new warnings or errors
- [x] I have added tests that prove my fix is effective or that my feature works
- [x] New and existing unit tests pass locally with my changes
- [x] Any dependent changes have been merged and published

## Documentation

- [x] JSDoc comments added/updated
- [x] Documentation updated:
  - `docs/author-guide/collection-schema.md` - Remote server examples, duplicate behavior
  - `docs/contributor-guide/architecture/mcp-integration.md` - Algorithm details, flowchart
  - `.kiro/specs/mcp-remote-servers/design.md` - Design document

## Additional Notes

### Breaking Change

The `McpServerDefinition` type now includes remote server configurations. Existing code that assumes all MCP servers are stdio-based may need updates. However, the change is backward compatible for collection manifests - existing stdio servers continue to work without modification.

### JSONC Parser

The switch to `jsonc-parser` fixes a critical bug where VS Code's `mcp.json` files with trailing commas or comments would fail to parse. This is a common issue since VS Code's JSON editor allows these by default.

### Duplicate Detection Algorithm

The algorithm is designed to be transparent and predictable:
1. **Identity-based**: Two servers are duplicates if they have the same identity (command+args for stdio, URL for remote)
2. **First-wins**: The first installed server remains active
3. **Lifecycle-aware**: When the active server is removed, a disabled duplicate is re-enabled
4. **Type-safe**: Stdio and remote servers never conflict (different identity prefixes)

## Reviewer Guidelines

Please pay special attention to:

- **Type safety**: Verify type guards correctly discriminate stdio vs remote servers
- **Duplicate detection logic**: Review `computeServerIdentity()` and `detectAndDisableDuplicates()` for edge cases
- **Test coverage**: Ensure lifecycle tests cover all scenarios (install, uninstall, re-enable)
- **Documentation clarity**: Verify author-facing docs explain duplicate behavior clearly
- **JSONC parsing**: Confirm error handling for malformed JSON

---

**By submitting this pull request, I confirm that my contribution is made under the terms of the Apache License 2.0.**

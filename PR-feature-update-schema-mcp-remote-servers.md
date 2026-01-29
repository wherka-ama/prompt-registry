## Description

This PR enhances the MCP (Model Context Protocol) schema to support remote HTTP and SSE-based servers, aligning with VS Code Copilot Chat's official specification. The implementation adds comprehensive support for multiple transport types, authentication headers, environment file loading, and various URL formats including Unix sockets and Windows named pipes.

## Type of Change

- [x] ✨ New feature (non-breaking change which adds functionality)
- [x] 📝 Documentation update
- [x] 🧪 Test coverage improvement

## Related Issues

Relates to #102 (incorporates all feedback from PR review)

## Changes Made

### MCP Schema Enhancements (`schemas/collection.schema.json`)

- **Transport Types**: Added `sse` transport type alongside `stdio` and `http`
- **Conditional Validation**: Implemented JSON Schema `allOf`/`if`/`then` for type-specific requirements:
  - `stdio` type requires `command` field
  - `http`/`sse` types require `url` field
  - Backward compatible: servers without `type` default to `stdio` and require `command`
- **New Properties**:
  - `envFile`: Path to environment file for stdio servers (supports `${workspaceFolder}/.env`, `${bundlePath}/.env`)
  - `headers`: HTTP headers object for http/sse authentication (supports `${input:api-token}` variables)
  - `url`: Remote server endpoint with multiple format support:
    - HTTP/HTTPS URLs: `http://localhost:3000/mcp`, `https://api.example.com/mcp`
    - Unix domain sockets: `unix:///tmp/mcp.sock`
    - Windows named pipes: `pipe:///pipe/mcp-server`

### TypeScript Type System (`src/types/mcp.ts`)

- Created discriminated union types for type safety:
  - `McpStdioServerConfig`: Local process servers with `command`, `args`, `env`, `envFile`
  - `McpRemoteServerConfig`: HTTP/SSE remote servers with `url` and `headers`
  - `McpServerConfig`: Union type of both
- Maintained backward compatibility with `McpServerDefinition` type alias

### Test Coverage (`test/services/SchemaValidator.test.ts`)

Added 15 comprehensive test cases covering:
- HTTP MCP servers with URL validation
- SSE MCP servers with URL validation
- HTTP/SSE servers with authentication headers
- Validation that HTTP/SSE require URL (fails without it)
- Stdio servers with `envFile` property
- Stdio servers with both `env` and `envFile`
- Unix socket URLs (`unix:///path`)
- Windows named pipe URLs (`pipe:///pipe/name`)
- Standard HTTP/HTTPS URLs
- Backward compatibility (stdio without explicit type)
- Proper error handling for invalid configurations

### Bug Fixes

- Fixed TypeScript compilation error in `McpServerManager.repositoryScope.test.ts` by adding type guard for union type access

## Testing

### Test Coverage

- [x] Unit tests added/updated (15 new test cases)
- [x] Integration tests added/updated
- [x] Manual testing completed
- [x] All existing tests pass (2,230+ tests passing)

### Manual Testing Steps

1. Validated schema with stdio MCP server (backward compatible)
2. Validated schema with HTTP MCP server with headers
3. Validated schema with SSE MCP server
4. Tested Unix socket URL format validation
5. Tested Windows named pipe URL format validation
6. Verified conditional validation logic (command vs url requirements)
7. Ran full validation pipeline: `.github/workflows/scripts/validate-locally.sh`

### Tested On

- [x] Linux
- [x] VS Code (via test suite)

### Validation Results

All 11 validation steps passed:
1. ✅ Clean build artifacts
2. ✅ Install dependencies
3. ✅ Security audit (npm) - 0 vulnerabilities
4. ✅ ESLint validation
5. ✅ TypeScript compilation
6. ✅ Compile test suite
7. ✅ Unit tests - 2,230 tests passing
8. ✅ Integration tests - 12 scenarios passing
9. ✅ Package VSIX (production mode)
10. ✅ Validate VSIX package
11. ✅ License compliance check

## Screenshots

N/A - Schema and type system changes

## Checklist

- [x] My code follows the project's style guidelines
- [x] I have performed a self-review of my code
- [x] I have commented my code, particularly in hard-to-understand areas
- [x] I have made corresponding changes to the documentation (schema descriptions)
- [x] My changes generate no new warnings or errors
- [x] I have added tests that prove my fix is effective or that my feature works
- [x] New and existing unit tests pass locally with my changes
- [x] Any dependent changes have been merged and published

## Documentation

- [x] Schema documentation updated (inline descriptions and examples)
- [x] JSDoc comments added/updated in TypeScript types
- [ ] README.md updated (not required for this change)

## Additional Notes

### Alignment with VS Code Copilot Chat

This implementation is based on thorough analysis of the `vscode-copilot-chat` repository, specifically:
- `src/extension/mcp/vscode-node/nuget.ts` - `IMcpStdioServerConfiguration` and `IMcpRemoteServerConfiguration` interfaces
- `src/extension/agents/copilotcli/node/mcpHandler.ts` - `MCPServerConfig` types

The schema now matches VS Code's official MCP configuration format, ensuring compatibility with Copilot Chat's MCP server integration.

### Backward Compatibility

All existing MCP configurations continue to work:
- Servers without `type` field default to `stdio` behavior
- Existing `command`, `args`, and `env` properties work as before
- No breaking changes to existing collection manifests

### Future Enhancements

Potential future additions (not in this PR):
- `cwd` property for stdio servers (working directory)
- `dev` property for development mode configuration
- Additional transport types as they become available in the MCP specification

## Reviewer Guidelines

Please pay special attention to:

- **Conditional validation logic**: Verify the JSON Schema `allOf`/`if`/`then` conditions correctly enforce type-specific requirements
- **Type safety**: Check that the TypeScript discriminated unions properly prevent accessing properties that don't exist on specific server types
- **Test coverage**: Review the 15 new test cases to ensure they cover all edge cases and error scenarios
- **Backward compatibility**: Confirm that existing stdio-only configurations still validate correctly
- **Documentation**: Verify that schema descriptions and examples are clear and accurate

---

**By submitting this pull request, I confirm that my contribution is made under the terms of the Apache License 2.0.**

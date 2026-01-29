# [Feature]: Support for Remote HTTP-based MCP Servers in Collection Schema

## Problem Statement

The current `collection.schema.json` only supports local stdio-based MCP (Model Context Protocol) servers that require a `command` field to execute a local process. This prevents users from defining remote HTTP-based MCP servers in their collection manifests.

When attempting to configure a remote MCP server that exposes an HTTP endpoint (e.g., `https://api.example.com/mcp`), the schema validation fails because it always requires the `command` property, which is inappropriate for remote servers that don't need to spawn a local process.

This limitation blocks users from:
- Connecting to cloud-hosted MCP services
- Using centralized MCP servers shared across teams
- Integrating with third-party MCP API providers
- Deploying MCP servers as microservices

## Proposed Solution

Update the `collection.schema.json` to support both local (stdio) and remote (http) MCP server types through conditional validation:

1. **Add a `type` field** (required) with enum values `['stdio', 'http']`
2. **Implement conditional validation** using JSON Schema's `allOf` with `if/then` clauses:
   - When `type: 'stdio'` → require `command` field
   - When `type: 'http'` → require `url` field
3. **Add `url` property** with URI format validation for HTTP endpoints

### Example Configuration

**Stdio MCP Server (local process):**
```yaml
mcp:
  items:
    local-server:
      type: stdio
      command: node
      args: ['server.js']
      env:
        LOG_LEVEL: debug
```

**HTTP MCP Server (remote endpoint):**
```yaml
mcp:
  items:
    remote-server:
      type: http
      url: https://api.example.com/mcp
      env:
        API_KEY: ${env:API_KEY}
```

## Alternatives Considered

1. **Separate `mcp` and `mcp-remote` sections**: Would require duplicating configuration structure and complicate the schema
2. **Auto-detect based on presence of `command` vs `url`**: Less explicit and could lead to ambiguous configurations
3. **Use a single `endpoint` field**: Would require complex validation logic to distinguish between command paths and URLs

The proposed solution with an explicit `type` field is the cleanest and most maintainable approach.

## Examples

This pattern is used in similar tools:
- **Docker Compose**: Uses `build` vs `image` to distinguish local vs remote containers
- **Kubernetes**: Uses different resource types (Deployment vs Service) with explicit `type` fields
- **MCP Specification**: The official MCP spec supports both stdio and HTTP transport types

## Component

Configuration

## Priority (from your perspective)

Medium - Would improve my workflow

## Contribution

- [x] I would be willing to submit a PR for this feature
- [x] I can help with testing
- [x] I can help with documentation

## Additional Context

### Implementation Details

The schema change uses JSON Schema Draft 07's conditional validation:

```json
{
  "allOf": [
    {
      "if": {
        "properties": { "type": { "const": "stdio" } }
      },
      "then": {
        "required": ["command"]
      }
    },
    {
      "if": {
        "properties": { "type": { "const": "http" } }
      },
      "then": {
        "required": ["url"]
      }
    }
  ]
}
```

### Backward Compatibility

This is a **breaking change** for existing collections with MCP server definitions. Existing configurations will need to add `type: 'stdio'` to their MCP server definitions.

**Migration path**: Add `type: 'stdio'` to all existing MCP server configurations that use the `command` field.

### Testing

Comprehensive test coverage includes:
- Validation of stdio MCP servers with `command` field
- Validation of http MCP servers with `url` field
- Error detection for missing `type` field
- Error detection for stdio servers missing `command`
- Error detection for http servers missing `url`
- Support for environment variables in both types

### Related Work

This aligns with the MCP specification's support for multiple transport types and enables the extension to work with the growing ecosystem of cloud-hosted MCP services.

---
name: resource-discovery
description: Discover and recommend Copilot resources (prompts, instructions, agents, skills, chatmodes, MCP servers) based on project context, tech stack, and activity. Use this skill when the user asks for resource recommendations, context-aware suggestions, or help finding relevant resources for their current project.
license: SEE LICENSE IN LICENSE.txt
metadata:
  author: Prompt Registry Maintainers
  version: 1.0.0
compatibility: Requires Prompt Registry CLI with primitive index support.
---

# Resource Discovery Skill

Use this skill when the user asks about:
- Finding relevant Copilot resources for their project
- Getting recommendations based on tech stack or domain
- Discovering prompts, instructions, agents, or skills for specific use cases
- Context-aware resource suggestions
- Profile generation based on project analysis

This skill analyzes the current project context (tech stack, domain, activity) and searches the primitive index to recommend relevant resources.

## Context Analysis

Before searching for resources, analyze the project context:

1. **Tech Stack Detection**: Identify programming languages, frameworks, build tools, and testing frameworks from:
   - `package.json` (dependencies, devDependencies)
   - `tsconfig.json`
   - `go.mod`
   - `pyproject.toml` or `requirements.txt`
   - Lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml)

2. **Domain Detection**: Infer project characteristics from:
   - Directory structure (src, test, public, api, components, etc.)
   - File naming patterns
   - Common domain indicators (auth, payment, order, etc.)

3. **Activity Detection**: Track recent work from:
   - Recently modified files
   - Git branch and commit history
   - Working directory context

## Resource Search Strategy

Based on detected context, construct search queries for the primitive index:

1. **Tech Stack Queries**: Search for resources matching detected languages and frameworks
   - Example: TypeScript + React → search for "react typescript component"
   - Example: Go + gRPC → search for "go grpc"

2. **Domain Queries**: Search for resources relevant to the detected domain
   - Example: authentication domain → search for "auth login user session"
   - Example: ecommerce domain → search for "cart checkout payment"

3. **Activity Queries**: Search for resources related to recent work
   - Example: recent work on API routes → search for "api endpoint rest"
   - Example: recent work on tests → search for "test unit integration"

## Search Execution

Use the primitive index search to find relevant resources:

```
prompt-registry search --index <path> -q "<query>" --kinds <kinds> --limit <limit>
```

Parameters:
- `-q`: Free-text search query
- `--kinds`: Filter by primitive kind (prompt, instruction, agent, skill, chatmode, mcp-server)
- `--sources`: Filter by source ID
- `--bundles`: Filter by bundle ID
- `--tags`: Filter by tags
- `--limit`: Cap number of results (default: 10)
- `--offset`: Skip first N results

## Recommendation Strategy

When presenting recommendations:

1. **Rank by Relevance**: Sort results by score and relevance to detected context
2. **Provide Context**: Explain why each resource is recommended
3. **Show Metadata**: Display kind, source, bundle, and tags
4. **Suggest Next Actions**: Provide install commands or profile generation options

## Profile Generation

For comprehensive setup, offer to generate a profile:

1. **Collect Selected Resources**: Allow user to select multiple resources
2. **Generate Profile YAML**: Create a profile configuration
3. **Save Profile**: Save to appropriate location (user config or project)

Profile structure:
```yaml
id: <profile-id>
name: <profile-name>
description: <profile-description>
bundles:
  - source: <source-id>
    id: <bundle-id>
    version: <version>
```

## CLI Integration

The skill can recommend CLI commands:

### Install Individual Resources
```bash
prompt-registry install <bundle-id> --source <hub-id> --target <target>
```

### Interactive Selection
```bash
prompt-registry install --source <hub-id> --interactive --target <target>
```

### Profile Activation
```bash
prompt-registry profile activate <profile-id>
```

### Apply (Idempotent Setup)
```bash
prompt-registry apply
```

## Example Workflows

### Workflow 1: React Project Setup
**Context**: TypeScript, React, Vite detected
**Query**: "react component typescript"
**Recommendations**: React component templates, TypeScript type guards, Vite configuration prompts
**Next Action**: Generate profile with selected resources

### Workflow 2: API Development
**Context**: Express, TypeScript, testing detected
**Query**: "api endpoint typescript express"
**Recommendations**: API route templates, request validation prompts, error handling instructions
**Next Action**: Install selected resources individually

### Workflow 3: Testing Setup
**Context**: Jest, Vitest detected
**Query**: "test unit integration typescript"
**Recommendations**: Test templates, mocking utilities, coverage prompts
**Next Action**: Interactive selection and installation

## Error Handling

If the primitive index is not found:
1. Suggest running `prompt-registry index build` or `prompt-registry index harvest`
2. Provide guidance on index creation
3. Offer to help set up the index

If no relevant resources are found:
1. Suggest broadening the search query
2. Try searching with fewer filters
3. Recommend checking available hubs and sources

## Outcome

Provide recommendations that are:
- **Context-aware**: Based on detected tech stack, domain, and activity
- **Relevant**: Ranked by relevance to the user's current project
- **Actionable**: Include clear next steps (install commands, profile generation)
- **Explained**: Provide rationale for each recommendation
- **Flexible**: Allow user to refine search or select specific resources

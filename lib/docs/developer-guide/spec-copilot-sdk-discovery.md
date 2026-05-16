# Specification: Copilot SDK Context-Aware Discovery Enhancement

## Document Information

- **Status**: Draft (Iteration 1)
- **Author**: AI Assistant
- **Date**: 2025-01-16
- **Related Design**: [copilot-sdk-context-aware-discovery-design.md](./copilot-sdk-context-aware-discovery-design.md)
- **TDD Approach**: Test-Driven Development
- **Architecture**: Clean Architecture (Domain → App → Infra → CLI)

---

## Executive Summary

This specification enhances the existing `discover` command with Copilot SDK integration to provide AI-powered resource recommendations. The enhancement builds upon the current context detection and primitive index search foundation, adding intelligent recommendation capabilities while maintaining backward compatibility.

**Current State**: Basic context-aware search using query building from detected context.
**Target State**: AI-powered recommendations using Copilot SDK with optional fallback to current behavior.

---

## 1. Requirements Analysis

### 1.1 Functional Requirements

#### FR-1: Context Detection (Existing)
- **Priority**: P0 (Already Implemented)
- **Status**: ✅ Complete
- **Description**: Detect tech stack, domain, and activity from project structure
- **Implementation**: `ContextDetector` in `src/app/context-detection/`

#### FR-2: Primitive Index Search (Existing)
- **Priority**: P0 (Already Implemented)
- **Status**: ✅ Complete
- **Description**: Search primitive index using BM25 algorithm
- **Implementation**: `PrimitiveIndex` in `src/infra/search/`

#### FR-3: AI-Powered Recommendations (New)
- **Priority**: P1
- **Description**: Use Copilot SDK to generate intelligent recommendations based on context
- **Acceptance Criteria**:
  - When Copilot SDK is available, use AI to rank and explain recommendations
  - When Copilot SDK is unavailable, fall back to current query-based search
  - Provide reasoning for each recommendation
  - Support streaming responses for real-time feedback

#### FR-4: Custom Skill for Resource Discovery (New)
- **Priority**: P1
- **Description**: Create a Copilot custom skill specialized for resource discovery
- **Acceptance Criteria**:
  - Skill defines the resource discovery workflow
  - Skill understands prompt-registry resource types (profiles, bundles, primitives)
  - Skill provides structured JSON output for recommendations

#### FR-5: MCP Server Integration (New)
- **Priority**: P2
- **Description**: Expose resource search as an MCP tool
- **Acceptance Criteria**:
  - MCP server provides `search_resources` tool
  - Tool accepts query, type filters, and context
  - Tool returns structured recommendations

#### FR-6: Interactive Selection UI (New)
- **Priority**: P2
- **Description**: Interactive multi-selection interface for reviewing recommendations
- **Acceptance Criteria**:
  - Support multi-select with preview
  - Category filters (profiles, bundles, primitives)
  - Relevance ranking display
  - "Select all" and "select recommended" shortcuts

#### FR-7: Profile Generation (New)
- **Priority**: P2
- **Description**: Generate profile YAML from selections
- **Acceptance Criteria**:
  - Generate valid profile YAML
  - Include selected resources with versions
  - Provide dry-run preview before applying

#### FR-8: One-Click Activation (New)
- **Priority**: P3
- **Description**: Activate generated profile with single command
- **Acceptance Criteria**:
  - Add profile to hub (optional)
  - Sync hub
  - Activate profile on target

### 1.2 Non-Functional Requirements

#### NFR-1: Performance
- Context detection: < 500ms
- Index search: < 100ms (already achieved: 19,410 QPS)
- AI recommendations: < 3s (with streaming feedback)

#### NFR-2: Reliability
- Graceful fallback when Copilot SDK unavailable
- No data loss during profile generation
- Idempotent operations

#### NFR-3: Maintainability
- Clean Architecture compliance (domain layer invariants)
- TDD approach (tests before implementation)
- Comprehensive test coverage (> 90%)

#### NFR-4: Backward Compatibility
- Existing `discover` command continues to work without Copilot SDK
- No breaking changes to existing APIs
- Opt-in AI features via flags

---

## 2. Architecture Design

### 2.1 Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI Layer                               │
│  src/cli/commands/discover.ts (enhanced)                        │
│  - Add --ai flag for Copilot SDK integration                     │
│  - Add --interactive flag for UI mode                            │
│  - Maintain backward compatibility                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Application Layer                             │
│  src/app/discovery/ (new module)                                │
│  - recommendation-engine.ts (orchestrates AI + search)          │
│  - profile-generator.ts (generates profiles from selections)    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Domain Layer                                │
│  src/domain/discovery/ (new module)                             │
│  - types.ts (recommendation, selection, profile draft)          │
│  - validators.ts (profile draft validation)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Infrastructure Layer                           │
│  src/infra/discovery/ (new module)                              │
│  - copilot-sdk-client.ts (Copilot SDK adapter)                 │
│  - skill-loader.ts (loads custom skills)                        │
│  - mcp-server.ts (MCP server implementation)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Ports                                     │
│  src/ports/ (new interfaces)                                    │
│  - copilot-sdk.ts (Copilot SDK interface)                       │
│  - mcp-server.ts (MCP server interface)                          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Domain Types

```typescript
// src/domain/discovery/types.ts

/**
 * Resource recommendation with AI reasoning
 */
export interface ResourceRecommendation {
  /** Resource type: profile, bundle, or primitive */
  type: 'profile' | 'bundle' | 'primitive';
  /** Unique resource identifier */
  id: string;
  /** Display name */
  name: string;
  /** Brief description */
  description: string;
  /** Relevance score (0-1) */
  relevanceScore: number;
  /** AI-generated reasoning for recommendation */
  reasoning: string;
  /** Source hub or repository */
  source: string;
  /** Primitive kind (if applicable) */
  kind?: string;
  /** Whether this is recommended by AI */
  aiRecommended: boolean;
}

/**
 * User selection from recommendations
 */
export interface ResourceSelection {
  /** Resource identifier */
  id: string;
  /** Whether selected */
  selected: boolean;
  /** Selection timestamp */
  selectedAt?: string;
}

/**
 * Profile draft for generation
 */
export interface ProfileDraft {
  /** Profile ID */
  id: string;
  /** Profile name */
  name: string;
  /** Profile description */
  description: string;
  /** Profile icon */
  icon?: string;
  /** Selected resources */
  selections: ResourceSelection[];
  /** Draft creation timestamp */
  createdAt: string;
}

/**
 * Discovery options
 */
export interface DiscoveryOptions {
  /** Enable AI-powered recommendations */
  enableAI: boolean;
  /** Enable interactive mode */
  interactive: boolean;
  /** Working directory */
  cwd: string;
  /** Index file path */
  indexFile?: string;
  /** Maximum recommendations */
  limit?: number;
  /** Filter by primitive kinds */
  kinds?: string[];
}
```

### 2.3 Port Interfaces

```typescript
// src/ports/copilot-sdk.ts

/**
 * Copilot SDK interface for AI integration
 */
export interface CopilotSdk {
  /**
   * Create a Copilot session with custom skills
   */
  createSession(options: SessionOptions): Promise<CopilotSession>;

  /**
   * Check if Copilot SDK is available
   */
  isAvailable(): boolean;
}

export interface SessionOptions {
  /** Model to use */
  model?: string;
  /** Skill directories to load */
  skillDirectories: string[];
  /** Permission request handler */
  onPermissionRequest: (request: PermissionRequest) => Promise<PermissionResponse>;
}

export interface CopilotSession {
  /**
   * Send a prompt and wait for response
   */
  sendAndWait(prompt: string): Promise<string>;

  /**
   * Send a prompt with streaming response
   */
  sendWithStream(prompt: string, onChunk: (chunk: string) => void): Promise<string>;

  /**
   * Close the session
   */
  close(): Promise<void>;
}

export interface PermissionRequest {
  kind: string;
}

export interface PermissionResponse {
  kind: 'approved' | 'denied';
}

// src/ports/mcp-server.ts

/**
 * MCP Server interface for tool integration
 */
export interface McpServer {
  /**
   * Start the MCP server
   */
  start(): Promise<void>;

  /**
   * Stop the MCP server
   */
  stop(): Promise<void>;

  /**
   * Register a tool
   */
  registerTool(tool: McpTool): void;
}

export interface McpTool {
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** Input schema (JSON Schema) */
  inputSchema: Record<string, unknown>;
  /** Tool handler */
  handler: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}
```

---

## 3. Test-Driven Development Plan

### 3.1 Test Structure

```
test/
├── domain/
│   └── discovery/
│       ├── types.test.ts
│       └── validators.test.ts
├── app/
│   └── discovery/
│       ├── recommendation-engine.test.ts
│       └── profile-generator.test.ts
├── infra/
│   └── discovery/
│       ├── copilot-sdk-client.test.ts
│       ├── skill-loader.test.ts
│       └── mcp-server.test.ts
└── cli/
    └── commands/
        └── discover-ai.test.ts
```

### 3.2 Test Priority (TDD Order)

#### Phase 1: Domain Types (P0)
1. **test/domain/discovery/types.test.ts**
   - Test type definitions and validation
   - Test branded types for IDs
   - Test discriminated unions

#### Phase 2: Recommendation Engine (P1)
2. **test/app/discovery/recommendation-engine.test.ts**
   - Test fallback to current behavior when AI unavailable
   - Test AI-powered recommendations when available
   - Test ranking and scoring
   - Test reasoning generation

#### Phase 3: Profile Generator (P1)
3. **test/app/discovery/profile-generator.test.ts**
   - Test profile draft generation
   - Test YAML serialization
   - Test validation

#### Phase 4: Copilot SDK Client (P1)
4. **test/infra/discovery/copilot-sdk-client.test.ts**
   - Test session creation
   - Test prompt sending
   - Test streaming responses
   - Test error handling

#### Phase 5: Skill Loader (P2)
5. **test/infra/discovery/skill-loader.test.ts**
   - Test skill directory loading
   - Test skill validation
   - Test skill injection

#### Phase 6: MCP Server (P2)
6. **test/infra/discovery/mcp-server.test.ts**
   - Test server start/stop
   - Test tool registration
   - Test tool execution

#### Phase 7: CLI Integration (P1)
7. **test/cli/commands/discover-ai.test.ts**
   - Test --ai flag
   - Test --interactive flag
   - Test backward compatibility
   - Test error handling

---

## 4. Implementation Plan

### 4.1 Phase 1: Foundation (P0) - Current State

**Status**: ✅ Complete
- Context detection implemented
- Primitive index search implemented
- Basic discover command implemented

### 4.2 Phase 2: Domain Layer (P1)

**Tasks**:
1. Create `src/domain/discovery/types.ts`
2. Create `src/domain/discovery/validators.ts`
3. Write tests for domain types
4. Ensure no feature imports (enforced by ESLint)

**Acceptance Criteria**:
- All domain types are pure (no I/O)
- Domain types have comprehensive JSDoc
- Tests cover all type validations
- ESLint passes with no feature imports

### 4.3 Phase 3: Port Interfaces (P1)

**Tasks**:
1. Create `src/ports/copilot-sdk.ts`
2. Create `src/ports/mcp-server.ts`
3. Write tests for port interfaces (using mocks)
4. Update `src/ports/index.ts` to export new ports

**Acceptance Criteria**:
- Port interfaces are abstract (no implementation)
- Port interfaces are testable with mocks
- Port interfaces have comprehensive JSDoc

### 4.4 Phase 4: Application Layer (P1)

**Tasks**:
1. Create `src/app/discovery/recommendation-engine.ts`
2. Create `src/app/discovery/profile-generator.ts`
3. Write tests for recommendation engine
4. Write tests for profile generator

**Acceptance Criteria**:
- Recommendation engine orchestrates AI + search
- Falls back to current behavior when AI unavailable
- Profile generator produces valid YAML
- Tests cover all code paths

### 4.5 Phase 5: Infrastructure Layer (P1)

**Tasks**:
1. Create `src/infra/discovery/copilot-sdk-client.ts`
2. Create custom skill in `skills/resource-discovery/SKILL.md`
3. Create `src/infra/discovery/skill-loader.ts`
4. Write tests for all infra components

**Acceptance Criteria**:
- Copilot SDK client implements port interface
- Skill loader loads and validates skills
- Tests use mocks for external dependencies
- Error handling is comprehensive

### 4.6 Phase 6: CLI Integration (P1)

**Tasks**:
1. Enhance `src/cli/commands/discover.ts` with --ai flag
2. Add --interactive flag for UI mode
3. Write tests for CLI integration
4. Update documentation

**Acceptance Criteria**:
- Backward compatibility maintained
- --ai flag enables AI recommendations
- --interactive flag enables UI mode
- Tests cover all flag combinations

### 4.7 Phase 7: MCP Server (P2)

**Tasks**:
1. Create `src/infra/discovery/mcp-server.ts`
2. Implement `search_resources` tool
3. Write tests for MCP server
4. Document MCP server usage

**Acceptance Criteria**:
- MCP server implements port interface
- Tool accepts query, filters, context
- Tool returns structured recommendations
- Server can be started/stopped cleanly

### 4.8 Phase 8: Interactive UI (P2)

**Tasks**:
1. Implement interactive selection UI
2. Add category filters
3. Add preview functionality
4. Write tests for UI components

**Acceptance Criteria**:
- UI supports multi-select
- Category filters work correctly
- Preview shows resource details
- Keyboard navigation works

### 4.9 Phase 9: Profile Generation (P2)

**Tasks**:
1. Implement profile generation from selections
2. Add dry-run preview
3. Add activation flow
4. Write tests for generation flow

**Acceptance Criteria**:
- Profile YAML is valid
- Dry-run shows what will be created
- Activation flow works end-to-end
- Tests cover error cases

### 4.10 Phase 10: Documentation (P1)

**Tasks**:
1. Update README.md with AI features
2. Create user guide for AI discovery
3. Update contributor guide
4. Add examples

**Acceptance Criteria**:
- Documentation is comprehensive
- Examples are runnable
- Architecture is documented
- Migration guide provided

---

## 5. Validation Steps

### 5.1 Code Quality

- **ESLint**: Zero errors, zero warnings
- **TypeScript**: Strict mode, no `any` types
- **Tests**: > 90% coverage
- **TDD**: Tests written before implementation

### 5.2 Architecture Validation

- **Domain Layer**: No feature imports (ESLint enforced)
- **Port Interfaces**: Pure abstractions
- **Clean Architecture**: Dependencies flow inward only
- **SOLID Principles**: Single responsibility, open/closed, etc.

### 5.3 Integration Validation

- **Existing Tests**: All existing tests pass
- **Backward Compatibility**: Existing discover command works
- **Fallback**: Graceful fallback when Copilot SDK unavailable
- **End-to-End**: Full workflow works with AI enabled/disabled

### 5.4 Performance Validation

- **Context Detection**: < 500ms
- **Index Search**: < 100ms
- **AI Recommendations**: < 3s (with streaming)
- **Memory**: No memory leaks

### 5.5 Documentation Validation

- **API Docs**: All public APIs documented
- **User Docs**: User guide complete
- **Contributor Docs**: Architecture documented
- **Examples**: All examples runnable

---

## 6. Success Metrics

### 6.1 Functional Metrics

- **AI Availability**: Copilot SDK integration works when available
- **Fallback**: Fallback to current behavior when AI unavailable
- **Recommendation Quality**: AI recommendations are relevant (user testing)
- **Profile Generation**: Generated profiles are valid and activatable

### 6.2 Quality Metrics

- **Test Coverage**: > 90%
- **ESLint**: Zero errors/warnings
- **TypeScript**: Strict mode, no `any`
- **Backward Compatibility**: 100% (existing tests pass)

### 6.3 Performance Metrics

- **Context Detection**: < 500ms
- **Index Search**: < 100ms
- **AI Recommendations**: < 3s
- **Cold Start**: < 5s (including context detection + AI)

### 6.4 User Experience Metrics

- **Time to Value**: Reduced from 8+ steps to 1-2 steps (with AI)
- **Discovery Accuracy**: AI recommendations relevant > 80% (user testing)
- **Satisfaction**: User survey > 4/5 stars

---

## 7. Risk Mitigation

### 7.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Copilot SDK unavailable | High | Medium | Graceful fallback to current behavior |
| AI recommendations irrelevant | Medium | High | User feedback loop, model tuning |
| Performance degradation | Medium | Medium | Streaming responses, caching |
| Breaking changes | Low | High | Backward compatibility tests |

### 7.2 Project Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Scope creep | Medium | Medium | Phase-based delivery, P0/P1/P2 priorities |
| Test coverage low | Low | High | TDD mandate, coverage gates |
| Documentation incomplete | Medium | Medium | Documentation as part of each phase |
| Integration issues | Medium | Medium | Integration tests, continuous integration |

---

## 8. Iteration Plan

### Iteration 1: Domain Layer (Current)
- ✅ Research complete
- 🔄 Write domain types
- ⏳ Write domain tests
- ⏳ Validate domain layer invariants

### Iteration 2: Port Interfaces
- ⏳ Define Copilot SDK port
- ⏳ Define MCP server port
- ⏳ Write port tests
- ⏳ Update barrel exports

### Iteration 3: Recommendation Engine
- ⏳ Implement recommendation engine
- ⏳ Write recommendation tests
- ⏳ Test fallback behavior
- ⏳ Validate AI integration

### Iteration 4: Profile Generator
- ⏳ Implement profile generator
- ⏳ Write profile tests
- ⏳ Test YAML generation
- ⏳ Validate profile structure

### Iteration 5: Copilot SDK Client
- ⏳ Implement SDK client
- ⏳ Write SDK tests
- ⏳ Test session management
- ⏳ Validate error handling

### Iteration 6: Custom Skill
- ⏳ Create resource discovery skill
- ⏳ Write skill tests
- ⏳ Validate skill structure
- ⏳ Test skill injection

### Iteration 7: CLI Integration
- ⏳ Add --ai flag
- ⏳ Add --interactive flag
- ⏳ Write CLI tests
- ⏳ Validate backward compatibility

### Iteration 8: MCP Server
- ⏳ Implement MCP server
- ⏳ Write MCP tests
- ⏳ Test tool registration
- ⏳ Validate tool execution

### Iteration 9: Interactive UI
- ⏳ Implement selection UI
- ⏳ Add category filters
- ⏳ Write UI tests
- ⏳ Validate user experience

### Iteration 10: Documentation
- ⏳ Update README
- ⏳ Write user guide
- ⏳ Update contributor guide
- ⏳ Add examples

---

## 9. Acceptance Criteria Summary

### Phase 1 (P0): Foundation
- ✅ Context detection works
- ✅ Primitive index search works
- ✅ Basic discover command works

### Phase 2 (P1): AI Integration
- ⏳ Domain types defined and tested
- ⏳ Port interfaces defined and tested
- ⏳ Recommendation engine implemented and tested
- ⏳ Copilot SDK client implemented and tested
- ⏳ CLI integration tested
- ⏳ Backward compatibility validated

### Phase 3 (P2): Advanced Features
- ⏳ Custom skill created and tested
- ⏳ MCP server implemented and tested
- ⏳ Interactive UI implemented and tested
- ⏳ Profile generation implemented and tested

### Phase 4 (P3): Polish
- ⏳ Documentation complete
- ⏳ Examples complete
- ⏳ Performance validated
- ⏳ User testing complete

---

## 10. Next Steps (Immediate)

1. **Write Domain Types** (Iteration 1)
   - Create `src/domain/discovery/types.ts`
   - Define all domain types
   - Write `test/domain/discovery/types.test.ts`
   - Run tests and validate

2. **Write Port Interfaces** (Iteration 2)
   - Create `src/ports/copilot-sdk.ts`
   - Create `src/ports/mcp-server.ts`
   - Write tests for ports
   - Update barrel exports

3. **Implement Recommendation Engine** (Iteration 3)
   - Create `src/app/discovery/recommendation-engine.ts`
   - Write tests
   - Implement fallback logic
   - Validate with tests

4. **Continue with remaining iterations**

---

## Appendix A: Custom Skill Template

```markdown
---
title: Resource Discovery Assistant
description: Helps users discover and select prompt-registry resources based on their context
user_invocable: true
disable_model_invocation: false
---

# Resource Discovery Assistant

You are a specialized assistant for discovering prompt-registry resources (profiles, bundles, primitives) based on user context.

## Your Capabilities

You have access to:
- Hub configurations (profiles, bundles from various sources)
- Primitive index (searchable index of prompts, skills, agents)
- User context (tech stack, domain, intended activity)

## Workflow

1. **Understand Context**: Analyze the user's tech stack, domain, and intended activity
2. **Search Resources**: Query the available resources (hubs, index) for relevant matches
3. **Rank Results**: Rank by relevance to the user's context
4. **Present Recommendations**: Present categorized results with explanations
5. **Refine**: Allow user to refine their requirements and re-rank

## Output Format

Return recommendations in the following JSON structure:

```json
{
  "recommendations": [
    {
      "type": "profile|bundle|primitive",
      "id": "resource-id",
      "name": "Resource Name",
      "description": "Brief description",
      "relevance_score": 0.95,
      "reasoning": "Why this is relevant to the user's context",
      "source": "hub-id|local|github-repo"
    }
  ],
  "categories": {
    "profiles": ["profile-id-1", "profile-id-2"],
    "bundles": ["bundle-id-1", "bundle-id-2"],
    "primitives": ["primitive-id-1", "primitive-id-2"]
  },
  "summary": "Brief summary of recommendations"
}
```

## Example Interaction

User: "I'm working on a Java microservice using Spring Boot and need to implement code reviews"

Your response should:
1. Identify tech stack: Java, Spring Boot
2. Identify domain: Microservices
3. Identify activity: Code review
4. Search for relevant resources (e.g., "code-review" profiles, "spring-boot" bundles)
5. Present ranked recommendations with reasoning
```

---

## Appendix B: MCP Tool Schema

```json
{
  "name": "search_resources",
  "description": "Search for prompt-registry resources (profiles, bundles, primitives)",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search query"
      },
      "type": {
        "type": "string",
        "enum": ["profile", "bundle", "primitive", "all"],
        "description": "Resource type to search"
      },
      "context": {
        "type": "object",
        "properties": {
          "techStack": {
            "type": "array",
            "items": {"type": "string"}
          },
          "domain": {
            "type": "string"
          },
          "activity": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

---

**End of Specification**

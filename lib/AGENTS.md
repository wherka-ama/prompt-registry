# Copilot Instructions for lib/ Contributors

Library: `@prompt-registry/collection-scripts` — Shared scripts for building, validating, and publishing Copilot prompt collections.

**🚨 MANDATORY FIRST STEP: Read Folder-Specific Guidance BEFORE Writing Code 🚨**

Before working in any folder, **MUST READ** the corresponding AGENTS.md file:

| Working in... | Read first |
|---------------|------------|
| `src/cli/` | `src/cli/AGENTS.md` — CLI framework, command patterns, argument parsing |
| `src/domain/` | `src/domain/AGENTS.md` — Domain layer invariants, type definitions |
| `src/primitive-index/` | `src/primitive-index/AGENTS.md` — Indexing, search, harvesting patterns |
| `src/install/` | `src/install/AGENTS.md` — Installation, target management, scope writers |
| `test/` | `test/AGENTS.md` — Test patterns, fixtures, mocking strategies |
| `test/cli/` | `test/cli/AGENTS.md` — CLI testing patterns, framework testing |

---

## Quick Context

### What is this library?

A Node.js/TypeScript library providing:
- **CLI tools** for collection validation, bundle building, and publishing
- **Primitive Index** — LLM-free search engine over agentic primitives (prompts, skills, agents, etc.)
- **Installation system** — Local bundle installation with target management
- **GitHub integration** — Hub harvesting, release analysis

### Key Architecture Layers

```
src/
├── cli/              → CLI framework + commands (commands/, framework/)
├── domain/           → Core types: bundles, primitives, hubs, registry config
├── primitive-index/  → BM25 search, harvesting, indexing
├── install/          → Installation, targets, scope writers
├── github/           → GitHub API client, asset fetching, blob cache
├── core/             → Barrel exports
├── public/           → Public API surface
└── registry/         → Registry namespace exports
```

### Build & Test Commands

```bash
cd lib
npm install                    # Install dependencies
npm run build                  # Compile to dist/
npm run compile-tests          # Compile tests to dist-test/
npm test                       # Run mocha tests
npm run lint                   # ESLint (v9 flat config)
npm run lint:report            # Generate eslint-report.json
```

---

## Development Methodology

### Bug Fixes: Test First

1. **Reproduce first**: Create a failing test in `test/`
2. **Confirm failure**: Run `npm test`, verify it fails
3. **Fix the code**: Make minimal change in `src/`
4. **Confirm fix**: Run `npm test`, verify it passes
5. **No regression**: Run related tests

### Testing Conventions

- Tests compile to `lib/dist-test/` via `tsconfig.test.json`
- Use `mocha` + `chai` (expect-style assertions)
- HTTP mocking with `nock`
- File system with `mock-fs` or temporary directories
- See `test/AGENTS.md` for detailed patterns

### Code Style

- **Strict TypeScript**: Enable all strict flags
- **Naming**: camelCase for variables/functions, PascalCase for types/classes
- **CLI flags**: kebab-case (`--collection-file`)
- **Comments**: JSDoc for public APIs, inline for complex logic
- **ESLint**: v9 flat config, zero warnings policy for errors

---

## Project Conventions

### Domain Layer Invariants

**CRITICAL**: Domain layer (`src/domain/`) cannot import from feature layers.

```typescript
// ✅ OK: domain imports domain
import { BundleManifest } from '../bundle/types';

// ❌ FORBIDDEN: domain importing from primitive-index
import { PrimitiveIndex } from '../../primitive-index';
```

Enforced by custom ESLint rule `no-feature-imports-in-domain`.

### CLI Framework Invariants

CLI commands in `src/cli/commands/` cannot import VS Code or other framework-specific modules:

```typescript
// ❌ FORBIDDEN in cli/commands/
import * as vscode from 'vscode';
```

Use the framework abstraction in `src/cli/framework/` instead.

### Type Exports

Public API is curated through `src/public/` and re-exported via `src/index.ts`:

```typescript
// Public API surface
export type { BundleManifest, Primitive } from './public';

// Namespace exports for organization
export * as registry from './registry';
export * as hub from './hub';
export * as core from './core';
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/cli/index.ts` | CLI argument parsing, command routing |
| `src/cli/framework/` | CLI framework (Context, OutputStream, errors) |
| `src/primitive-index/index.ts` | PrimitiveIndex class — main search API |
| `src/install/target-state-store.ts` | Target management |
| `src/domain/bundle/types.ts` | Core bundle type definitions |
| `src/github/client.ts` | GitHub API client |
| `src/validate.ts` | Collection validation logic |

---

## Documentation

- **README.md** — Usage guide, CLI reference, API examples
- **PRIMITIVE_INDEX_DESIGN.md** — Full design of the search engine
- **AGENTS.md** (this file) — AI assistant guidance
- **Nested AGENTS.md** — Folder-specific patterns (see table above)

---

## What to Avoid

- Don't add dependencies without justification — keep library lightweight
- Don't use `any` — use `unknown` with type guards
- Don't duplicate validation logic — use `src/validate.ts`
- Don't break domain layer invariants — no feature imports in domain
- Don't use sync file operations in async contexts

---

## Integration Points

| Integration | Pattern |
|-------------|---------|
| **GitHub API** | `GitHubClient` class with rate limit handling |
| **File System** | `Context.fs` abstraction for testability |
| **HTTP** | `axios` with retry logic via `p-limit` |
| **ZIP** | `adm-zip` for bundle extraction |
| **YAML** | `js-yaml` for manifest parsing |

---

## Migration Notes

- Legacy `bin/*.js` scripts are deprecated in favor of unified `prompt-registry` CLI
- See Phase 4/5 documentation for migration paths
- Maintain backward compatibility during deprecation period

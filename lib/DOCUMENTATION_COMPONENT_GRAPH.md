# Documentation Component Graph

**Purpose:** High-level mental map of all components in scope for documentation review.

## Layer Architecture (Clean Architecture)

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI Layer                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ CLI Commands │  │ CLI Framework │  │  CLI Main    │      │
│  │  (47 files)  │  │  (11 files)  │  │   (1 file)   │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │                  │                  │
┌─────────┼──────────────────┼──────────────────┼──────────────┐
│         │       ┌──────────▼──────────┐       │              │
│         │       │  Application Layer   │       │              │
│         │       │  app/ (19 files)     │       │              │
│         │       │  - collection/       │       │              │
│         │       │  - discovery/        │       │              │
│         │       │  - install/          │       │              │
│         │       │  - registry/         │       │              │
│         │       │  - search/           │       │              │
│         │       └──────────┬───────────┘       │              │
│         │                  │                  │              │
│         │       ┌──────────▼──────────┐       │              │
│         │       │   Domain Layer      │◄──────┘              │
│         │       │  domain/ (27 files) │                      │
│         │       │  - bundle/          │                      │
│         │       │  - collection/      │                      │
│         │       │  - hub/             │                      │
│         │       │  - install/         │                      │
│         │       │  - primitive/       │                      │
│         │       │  - registry/        │                      │
│         │       │  - skill/           │                      │
│         │       └──────────┬───────────┘                      │
│         │                  │                                  │
│         │       ┌──────────▼──────────┐                       │
│         │       │  Infrastructure     │                       │
│         │       │  infra/ (60 files)  │                       │
│         │       │  - checksum/        │                       │
│         │       │  - discovery/       │                       │
│         │       │  - downloaders/    │                       │
│         │       │  - extractors/     │                       │
│         │       │  - fs/              │                       │
│         │       │  - github/          │                       │
│         │       │  - harvest/         │                       │
│         │       │  - http/            │                       │
│         │       │  - resolvers/       │                       │
│         │       │  - search/          │                       │
│         │       │  - stores/          │                       │
│         │       │  - writers/         │                       │
│         │       └──────────┬───────────┘                       │
│         │                  │                                  │
│         │       ┌──────────▼──────────┐                       │
│         │       │      Ports          │                       │
│         │       │  ports/ (13 files)  │                       │
│         │       └──────────┬───────────┘                       │
│         │                  │                                  │
│         │       ┌──────────▼──────────┐                       │
│         │       │     Public API      │                       │
│         │       │  public/ (1 file)   │                       │
│         │       └──────────┬───────────┘                       │
│         │                  │                                  │
└─────────┼──────────────────┼──────────────────────────────────┘
          │                  │
          ▼                  ▼
    ┌──────────┐      ┌──────────┐
    │ src/     │      │ docs/    │
    │ index.ts │      │ (10 md)  │
    └──────────┘      └──────────┘
```

## Component Relationships

### Domain Layer (Foundation)
- **Role:** Pure types, no dependencies, business logic
- **Consumed by:** All other layers
- **Key types:** Bundle, Primitive, Hub, Target, RegistryConfig

### Application Layer (Use Cases)
- **Role:** Orchestrates domain and infrastructure
- **Consumed by:** CLI commands
- **Key modules:** Collection, Discovery, Install, Registry, Search

### Infrastructure Layer (Implementations)
- **Role:** Concrete implementations of ports
- **Consumed by:** Application layer
- **Key modules:** GitHub client, Filesystem, Stores, Writers

### Ports Layer (Interfaces)
- **Role:** Abstractions for external dependencies
- **Consumed by:** Infrastructure (implements), Application (uses)
- **Key ports:** Filesystem, HTTP, GitHub API, Target Writer

### CLI Layer (Entry Point)
- **Role:** User-facing commands
- **Consumes:** Framework, Application, Domain, Infrastructure
- **Key modules:** Commands, Framework, Main

## Documentation Files in Scope

### Higher Level Documentation (10 files)
```
docs/
├── architecture/ (4 files)
│   ├── c4-component.md
│   ├── c4-container.md
│   ├── c4-system-context.md
│   └── data-flow.md
├── reference/ (2 files)
│   ├── cli-commands.md
│   └── public-api.md
└── developer-guide/ (4 files) - FOCUS
    ├── getting-started.md
    ├── cli-framework.md
    ├── installation-system.md
    └── testing.md
```

## Key Patterns to Look For

### Documentation Format Consistency
- File headers: Single-line description + detailed description
- JSDoc: `@param`, `@returns`, `@throws` tags
- Comments: Concise, factual, practical (not essays)

### Development Stage References to Remove
- "Spec §P3"
- "Phase 1 / Step 1.3"
- "Phase 6 / Iter 41-50"
- "Default-local-hub synthesis (D23)"
- "Phase 6 / Iter 61-65 - ProfileActivator (D21, D22)"

### Layer Invariant Rules
- Domain layer cannot import from feature layers
- CLI commands cannot import VS Code
- Use framework abstractions for I/O

## Review Strategy

1. **Start with developer-guide** (4 files) - Focus area
2. **Move to architecture** (4 files) - High-level context
3. **Review reference** (2 files) - API documentation
4. **Systematic src/ review** (166 files) - Inline documentation
   - Start with domain/ (27 files) - Foundation
   - Move to ports/ (13 files) - Interfaces
   - Review infra/ (60 files) - Implementations
   - Review app/ (19 files) - Use cases
   - Review cli/ (47 files) - Commands
   - Review public/ (1 file) - Public API
   - Review index.ts (1 file) - Entry point

## Progress Tracking

Use `DOCUMENTATION_REVIEW_PROGRESS.md` for detailed file-by-file tracking.

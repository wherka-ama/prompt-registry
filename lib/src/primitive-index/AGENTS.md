# Primitive Index Guidelines

Working in `src/primitive-index/` — LLM-free search engine over agentic primitives.

## Architecture Overview

```
src/primitive-index/
├── bm25.ts            → BM25 scoring algorithm
├── extract.ts         → Frontmatter extraction, primitive detection
├── harvester.ts       → Bundle harvesting from sources
├── index.ts           → PrimitiveIndex class (main API)
├── persistence.ts     → Index serialization/deserialization
├── search.ts          → Search query execution
├── shortlist.ts       → Shortlist management
├── types.ts           → Index-specific types
└── ...
```

## Key Concepts

### Primitive

The smallest independently addressable agentic unit:

| Kind | File Pattern | Frontmatter |
|------|-------------|-------------|
| `prompt` | `*.prompt.md` | title, description, tags |
| `instruction` | `*.instructions.md` | title, applyTo, tags |
| `chat-mode` | `*.chatmode.md` | title, description, tools |
| `agent` | `*.agent.md` | title, description, model |
| `skill` | `skills/*/SKILL.md` | name, description |
| `mcp-server` | From manifest | id, command, url |

### Primitive ID

Stable identifier computed from source:

```typescript
primitiveId = sha1(sourceId + '|' + bundleId + '|' + relativePath).slice(0, 16)
```

### Index Structure

```typescript
interface PrimitiveIndexData {
  schemaVersion: string;
  generatedAt: string;
  primitives: Map<PrimitiveId, Primitive>;
  postings: Map<Field, Map<Term, PostingList>>;  // BM25 inverted index
  facets: {
    kind: Map<PrimitiveKind, Set<PrimitiveId>>;
    tag: Map<Tag, Set<PrimitiveId>>;
    sourceId: Map<SourceId, Set<PrimitiveId>>;
    bundleId: Map<BundleId, Set<PrimitiveId>>;
  };
}
```

## Key Classes

### PrimitiveIndex

Main API for search and indexing:

```typescript
const idx = await PrimitiveIndex.buildFrom(provider);
const results = idx.search({ 
  q: 'code review', 
  kinds: ['prompt'], 
  limit: 10 
});
```

### Harvester

Resolves bundles from sources:

```typescript
const harvester = new Harvester({
  provider: bundleProvider,
  cacheDir: './.cache',
  concurrency: 5
});
const result = await harvester.harvest();
```

### BM25

Hand-rolled BM25 scoring (zero dependencies):

```typescript
const scorer = new BM25Index({
  k1: 1.2,      // Term saturation parameter
  b: 0.75      // Length normalization
});
```

## Concurrency Patterns

Use `p-limit` style concurrency for GitHub API calls:

```typescript
const limit = pLimit(5);  // Max 5 concurrent
const results = await Promise.all(
  urls.map(url => limit(() => fetch(url)))
);
```

## Caching Strategy

1. **Blob cache**: Content-addressed by SHA1
2. **ETag store**: Cache GitHub API responses
3. **Progress log**: Append-only JSONL for resumability

## Testing

See `test/primitive-index/AGENTS.md`

Key patterns:
- Mock `BundleProvider` for harvesting tests
- Use `LocalFolderBundleProvider` with test fixtures
- Test BM25 scoring with known corpus

## Performance Targets

- Index build: <10s for 1000 primitives
- Search query: <10ms
- Memory: <50MB for typical hub (25k primitives)

## See Also

- `../../PRIMITIVE_INDEX_DESIGN.md` — Full design document
- `../github/AGENTS.md` — GitHub API integration
- `../domain/AGENTS.md` — Primitive type definitions

# Primitive Index — developer architecture

This document is the contributor-facing "engine-room" view of the
primitive index: the lifecycle, layers, data flow, and extension
points. For the product-level user guide, see
[`../user-guide/primitive-index.md`](../user-guide/primitive-index.md).
For the authoritative written spec with the BM25 math and ranking
tuning, see [`spec-primitive-index.md`](spec-primitive-index.md).

## High-level lifecycle

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant CLI as primitive-index CLI
  participant PM as PrimitiveIndexManager<br/>(VS Code extension)
  participant Hub as HubHarvester
  participant Prov as BundleProvider
  participant GH as GitHub API
  participant Cache as Blob + ETag cache
  participant IDX as PrimitiveIndex<br/>(on disk JSON)

  User->>CLI: hub-harvest --hub-repo owner/repo
  alt running in VS Code
    User->>PM: Primitive Index: Harvest from hub…
    PM->>Hub: buildFromHub({hubOwner, hubRepo, extraSources})
  else CLI path
    CLI->>Hub: new HubHarvester(sources, …)
  end
  Hub->>Hub: parallel sources (concurrency N)
  loop per source
    Hub->>Prov: listBundles()
    Prov->>GH: /commits/:branch (conditional, ETag)
    alt commit sha unchanged
      GH-->>Prov: 304 Not Modified
      Prov-->>Hub: reuse snapshot → skip source
    else commit sha new
      GH-->>Prov: 200 {sha}
      Prov->>GH: /git/trees/:sha?recursive=1
      GH-->>Prov: tree
      loop per candidate blob (parallel)
        Prov->>Cache: lookup by SHA
        alt cache hit
          Cache-->>Prov: bytes
        else cache miss
          Prov->>GH: /git/blobs/:sha
          GH-->>Prov: {encoding, content}
          Prov->>Cache: store(SHA, bytes)
        end
      end
      Prov-->>Hub: Primitive[]
    end
  end
  Hub->>IDX: fromPrimitives() + save()
  IDX-->>User: .cache/prompt-registry/primitive-index.json
```

## Layer map

```mermaid
graph TB
  subgraph "CLI entry"
    cli[bin/primitive-index.js<br/>→ src/primitive-index/cli.ts]
  end

  subgraph "Reusable layers (barrels)"
    core[core barrel<br/>BundleRef · BundleManifest · Primitive · BundleProvider]
    hub[hub barrel<br/>GitHub client · Blob/ETag caches · Harvester · Plugin parsers]
    paths[default-paths<br/>XDG cache + index]
  end

  subgraph "Primitive-index feature"
    extract[extract.ts<br/>frontmatter → Primitive]
    harvest[harvester.ts<br/>per-bundle parallel]
    idx[primitive-index.ts<br/>BM25 + filter + facet]
    store[store.ts<br/>saveIndex/loadIndex]
    evalp[eval-pattern.ts]
    bench[bench.ts]
  end

  subgraph "VS Code extension"
    pm[PrimitiveIndexManager]
    cmds[primitive-index-commands]
  end

  cli --> paths
  cli --> idx
  cli --> evalp
  cli --> bench
  cli --> hub

  pm --> hub
  pm --> idx
  pm --> core
  cmds --> pm

  harvest --> core
  harvest --> extract
  idx --> core

  hub -.->|depends on| core
```

All hub / bundle / primitive machinery is pure TypeScript with **zero
VS Code dependencies** — the extension consumes the same API surface
that the CLI does.

## Primitive data shape

```mermaid
classDiagram
  class Primitive {
    +id: string  // hash(sourceId, bundleId, path)
    +bundle: BundleRef
    +kind: PrimitiveKind  // prompt | instruction | chat-mode | agent | skill | mcp-server
    +path: string
    +title: string
    +description: string
    +tags: string[]
    +authors?: string[]
    +applyTo?: string
    +tools?: string[]
    +model?: string
    +bodyPreview: string  // truncated for BM25 recall
    +contentHash: string
    +rating?: number
    +updatedAt?: string
  }

  class BundleRef {
    +sourceId: string
    +sourceType: string
    +bundleId: string
    +bundleVersion: string  // commit sha for GitHub sources
    +installed: boolean
  }

  class BundleProvider {
    <<interface>>
    +listBundles() AsyncIterable~BundleRef~
    +readManifest(ref) Promise~BundleManifest~
    +readFile(ref, relPath) Promise~string~
  }

  Primitive *-- BundleRef
  BundleProvider ..> BundleRef : yields
  BundleProvider ..> BundleManifest : produces
```

Every bundle source — `GitHubSingleBundleProvider`,
`AwesomeCopilotPluginBundleProvider`, `LocalFolderBundleProvider` —
implements the same three-method `BundleProvider` interface. Adding a
new source type = drop a class in `hub/`, wire it into
`HubHarvester.processSource()`'s dispatch on `spec.type`, register it
on the `hub/index.ts` barrel.

## Search ranking

```mermaid
graph LR
  q[query: 'typescript mcp']
  t[tokenize<br/>'typescript', 'mcp']
  f[facet filter<br/>kinds/sources/bundles/tags]
  c[(candidate set)]
  bm25[BM25 per field<br/>title:3  desc:2<br/>tags:2  bodyPreview:1]
  norm[normalise BM25 / maxScore]
  tie[stable tie-break<br/>rating → bundleId → path]
  hits[SearchResult]

  q --> t
  t --> bm25
  q --> f
  f --> c
  c --> bm25
  bm25 --> norm
  norm --> tie
  tie --> hits
```

Key properties (from `src/primitive-index/index.ts` + `bm25.ts`):

- **Field weights** (`tuning.ts`): `title=3`, `description=2`, `tags=2`,
  `bodyPreview=1`. Raise title's weight and short titles dominate;
  balance as shown today keeps longer descriptions competitive.
- **IDF is clamped to ≥0** so a term appearing in every document
  contributes zero — no degenerate "return everything".
- **Empty-query fallback** (line 217 of `index.ts`): when `q` is absent
  but facet filters are present, the candidate set is returned with
  score 0 sorted by tie-breakers. A *present-but-non-matching* query
  returns **zero hits** (regression test pins this behaviour).

## Warm-path cost model

```mermaid
flowchart TD
  start[warm hub-harvest<br/>same sha on every source]
  per[per source:<br/>1× /commits/ conditional GET]
  etag[ETag store supplies<br/>If-None-Match header]
  resp{GitHub response}
  304[304 Not Modified]
  skip[apply snapshot →<br/>skip enumeration + blobs]
  total[Total warm-path cost<br/>= N × one conditional GET]

  start --> per --> etag --> resp
  resp -->|304| 304 --> skip --> total
```

On the combined 20-source (343-primitive) live index this yields
**1.3s warm / ~83 HTTP calls** (all 304s). The cost is linear in the
source count, not in the primitive count.

## Extension points

| You want to… | Touch | Don't touch |
|---|---|---|
| Add a new source type (e.g. `gitlab`, `zip-over-http`) | Add `hub/<name>-bundle-provider.ts` implementing `BundleProvider`; register in `HubHarvester.processSource()` and `hub/index.ts` | `harvester.ts` (per-bundle pipeline) |
| Change ranking weights | `primitive-index/tuning.ts` | The BM25 engine (`bm25.ts`) |
| Store extra metadata on primitives | `types.ts` `Primitive` + `extract.ts` | The hub layer — the hub layer doesn't know about primitives |
| Add a new subcommand (list/install/…) | Consume `registry` barrel from `lib/src/registry/` | Internals of `primitive-index/` |
| Expose new facets | `primitive-index/index.ts` `facetCounts()` + `filter()` | `bm25.ts` |

## Testing strategy

- **Pure unit** (no filesystem, no network): `bm25.ts`, `extract.ts`,
  `plugin-manifest.ts`, `extra-source.ts`, `default-paths.ts`,
  `eval-pattern.ts`, `bench.ts`.
- **Adapter-level with fake fetch**: `github-bundle-provider.ts`,
  `plugin-bundle-provider.ts`, `plugin-tree-enumerator.ts`,
  `github-api-client.ts` (nock-style injected `fetch`).
- **End-to-end in-memory**: `hub-harvester.test.ts` drives multi-source
  runs through fake trees; covers skip/error/plugin branches + MCP
  primitive extraction.
- **CLI integration**: `cli.test.ts` builds fixtures on disk, drives
  every subcommand, asserts JSON output and exit codes.
- **Relevance gate (CI-optional)**: `eval-pattern` subcommand + the
  20-query `lib/fixtures/golden-queries.json` golden set. `bench`
  captures p50/p95 + QPS for regression detection.

Run everything:

```bash
cd lib
npm run compile-tests
npm test              # 285+ tests, <5s
npx eslint src test   # 0 errors
```

## See also

- [`spec-primitive-index.md`](spec-primitive-index.md) — authoritative spec.
- [`primitive-index-hub-iterations.md`](primitive-index-hub-iterations.md) — sprint iteration log.
- [`primitive-index-reusable-layers.md`](primitive-index-reusable-layers.md) — barrel namespace guide.
- [`../user-guide/primitive-index.md`](../user-guide/primitive-index.md) — end-user how-to.
- [`../../lib/PRIMITIVE_INDEX_DESIGN.md`](../../lib/PRIMITIVE_INDEX_DESIGN.md) — engine-level design.

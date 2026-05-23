# Primitive Index

The Primitive Index is a searchable, locally-cached registry of agentic primitives (skills, agents, prompts, instructions, chat modes, MCP servers) harvested from one or more GitHub-hosted hub configurations. This document covers both end-user usage and the internal architecture.

---

## User Guide

### Prerequisites

- Node.js 18+
- A GitHub personal access token with `repo` scope stored in `GH_TOKEN` or `GITHUB_TOKEN` (required for private repos)

### Quickstart

```bash
# Harvest a hub and write a local index
prompt-registry index harvest --hub-repo OWNER/REPO

# Search the resulting index
prompt-registry index search -q "incident investigation"

# View index stats
prompt-registry index stats
```

### Harvest command

```
prompt-registry index harvest [options]
```

| Flag | Description |
|------|-------------|
| `--hub-repo OWNER/REPO` | GitHub repo hosting the hub config. Required unless `--hub-config-file` or `--no-hub-config` is given. |
| `--hub-branch BRANCH` | Branch of the hub repo. Defaults to `main`. |
| `--hub-config-file FILE` | Path to a local hub-config.yml (skips remote fetch). |
| `--no-hub-config` | Harvest from `--extra-source` flags only (no hub config). |
| `--extra-source SPEC` | Additional source(s). Format: `github:OWNER/REPO` or `local:/path`. Can be repeated. |
| `--sources-include ID...` | Harvest only these source IDs. |
| `--sources-exclude ID...` | Skip these source IDs. |
| `--cache-dir DIR` | Override cache directory. Default: `$PROMPT_REGISTRY_CACHE` → `$XDG_CACHE_HOME/prompt-registry` → `~/.cache/prompt-registry`. |
| `--out-file FILE` | Override output index file path. Default: `<cache-dir>/primitive-index.json`. |
| `--progress-file FILE` | Path for the progress log. Default: `<cache-dir>/harvest-progress.json`. |
| `--concurrency N` | Number of sources to process in parallel. Default: 4. |
| `--force` | Ignore cached commit SHAs and re-harvest every source. |
| `--dry-run` | Print what would be harvested without writing files. |
| `--verbose` | Emit a JSON event line per source operation to stderr. |
| `--token-env VAR` | Environment variable name holding the GitHub token (default: auto-detected). |

#### Warm vs. cold runs

The harvester records each source's commit SHA in a progress log. On subsequent runs it skips sources whose SHA hasn't changed, making warm runs fast (typically < 2 s for 20+ sources). Use `--force` to bypass this optimisation.

#### Authentication

For **private repositories**, a GitHub token is required for the raw file fetch step. The token is read from (in priority order):

1. The value of the env var named by `--token-env` if provided
2. `GH_TOKEN` environment variable
3. `GITHUB_TOKEN` environment variable
4. The `gh` CLI keychain (`gh auth token`)

### Search command

```
prompt-registry index search -q QUERY [options]
```

| Flag | Description |
|------|-------------|
| `-q QUERY` | Full-text query string (BM25 ranked). |
| `--kinds KIND...` | Filter by kind: `skill`, `agent`, `prompt`, `instruction`, `chat-mode`, `mcp-server`. |
| `--sources ID...` | Filter by source ID. |
| `--bundles ID...` | Filter by bundle ID. |
| `--tags TAG...` | Filter by tag. |
| `--limit N` | Max results to return. Default 10. |
| `--offset N` | Skip first N results (pagination). |
| `--explain` | Show per-field BM25 score breakdown. |
| `--json` | Output JSON instead of text. |
| `--index FILE` | Index file to search (default: auto-detected). |

### Stats and report

```bash
# Count primitives by kind / source / bundle
prompt-registry index stats [--index FILE] [--json]

# Summarise the last harvest run
prompt-registry index report [--hub-repo OWNER/REPO] [--json]
```

### Cache layout

```
~/.cache/prompt-registry/
├── primitive-index.json          # Serialised index (BM25 + metadata)
├── primitive-index.json.sig      # HMAC integrity sidecar
├── harvest-progress.json         # Per-source commitSha snapshot (warm-run guard)
└── blobs/
    └── <git-blob-sha>            # Content-addressed file cache (one file per blob SHA)
```

---

## Developer Guide

### Architecture overview

```
prompt-registry index harvest
         │
         ▼
  IndexHarvestCommand          (cli/commands/index-harvest.ts)
         │  options
         ▼
   harvestHub()                (infra/harvest/hub-harvester.ts)
         │
         ├─ 1. Fetch hub-config.yml via GitHubClient
         │
         ├─ 2. parseHubConfig() → HubSourceSpec[]
         │                       (infra/harvest/hub-config-parser.ts)
         │
         ├─ 3. For each spec (parallel, concurrency=4):
         │       processSource()
         │         │
         │         ├─ Skip if commitSha unchanged (progress log)
         │         │
         │         ├─ Create BundleProvider
         │         │     type=github / awesome-copilot  → GitHubSingleBundleProvider
         │         │     type=awesome-copilot-plugin    → AwesomeCopilotPluginBundleProvider
         │         │
         │         └─ harvest(provider)
         │               │
         │               ├─ provider.listBundles()        → BundleRef[]
         │               └─ harvestBundle(provider, ref)
         │                     │
         │                     ├─ provider.readManifest(ref) → BundleManifest
         │                     │     (synthetic from tree scan)
         │                     │
         │                     ├─ harvestManifestItems()
         │                     │     For each item path:
         │                     │       provider.readFile(ref, path) → string
         │                     │       extractFromFile()             → Primitive | null
         │                     │
         │                     └─ extractMcpPrimitives()
         │                           (from manifest.mcp.items)
         │
         └─ 4. saveIndex(primitives[])
                   (infra/stores/)
```

### Step 1 — Fetch hub-config.yml

`harvestHub` fetches `hub-config.yml` from the given GitHub repo using `GitHubClient.getJson`. The client adds `Authorization: Bearer <token>` automatically and handles retries, rate-limit sleeps, and ETag conditional requests.

**Key file:** `src/infra/harvest/hub-harvester.ts`

### Step 2 — Parse hub config

`parseHubConfig(yaml)` converts the YAML document into a list of `HubSourceSpec` objects. Each spec captures:

| Field | Source |
|-------|--------|
| `id` | `sources[].id` in the YAML (or `owner-repo` if absent) |
| `type` | `sources[].type` — `github`, `awesome-copilot`, or `awesome-copilot-plugin` |
| `owner`, `repo` | Extracted from `sources[].url` |
| `branch` | `sources[].config.branch` — defaults to `main` |
| `collectionsPath` | `sources[].config.collectionsPath` |
| `pluginsPath` | `sources[].config.pluginsPath` — only for `awesome-copilot-plugin` |

Sources with `enabled: false` or unsupported types are silently dropped (forward-compat).

**Key file:** `src/infra/harvest/hub-config-parser.ts`

### Step 3 — Process sources

Sources are processed with `p-limit` up to `concurrency` at a time. For each source:

#### 3a. Warm-run guard

`HubHarvester.processSource` resolves the current commit SHA of the source repo via `GET /repos/{owner}/{repo}/commits/{branch}`. This is compared against the SHA stored in `harvest-progress.json`. If unchanged, the source is skipped and its previously computed primitives are re-used.

#### 3b. Select bundle provider

| Source type | Provider |
|-------------|----------|
| `github` | `GitHubSingleBundleProvider` |
| `awesome-copilot` | `GitHubSingleBundleProvider` |
| `awesome-copilot-plugin` | `AwesomeCopilotPluginBundleProvider` |

**Key files:** `src/infra/harvest/bundle-providers/`

#### 3c. GitHubSingleBundleProvider — tree enumeration

For `github` and `awesome-copilot` sources, the provider fetches the full recursive git tree via `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`. Each blob entry is tested against `isPrimitiveCandidatePath()`.

A path is a **primitive candidate** if it matches one of these patterns:

| Pattern | Kind hint |
|---------|-----------|
| `*.prompt.md` | `prompt` |
| `*.instructions.md` | `instruction` |
| `*.chatmode.md` | `chat-mode` |
| `*.agent.md` or `*/agent.md` | `agent` |
| `*skill.md` (case-insensitive) | `skill` |
| `*mcp.json` (case-insensitive) | `mcp-server` |
| `*.collection.yml` | `unknown` (skipped later) |
| `deployment-manifest.yml` | `unknown` (skipped later) |

Files under `.github/` are excluded. Files larger than 256 KiB are excluded.

The result — commit SHA + list of candidate `{ path, blobSha, size }` — is memoised for the lifetime of the provider instance.

**Key file:** `src/infra/harvest/tree-enumerator.ts`

#### 3d. readManifest — synthetic manifest

`GitHubSingleBundleProvider.readManifest()` returns a synthetic `BundleManifest` where `items` is the list of candidate paths (each annotated with the kind hint from step 3c). No network call is made — this reuses the memoised enumeration.

#### 3e. readFile — authenticated raw content fetch

`GitHubSingleBundleProvider.readFile(ref, relPath)` fetches the file content from:

```
https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{relPath}
```

The fetch goes through `GitHubClient.getText()` which adds the `Authorization: Bearer <token>` header. This is essential for **private repositories**: without the token, `raw.githubusercontent.com` returns HTTP 404.

Results are stored in the blob cache keyed by git blob SHA (`BlobCache.getOrFetch`). Subsequent calls for the same blob (same SHA, same or different repos) are served from disk without a network call.

**Key files:**
- `src/infra/harvest/bundle-providers/github-bundle-provider.ts`
- `src/infra/github/client.ts`
- `src/infra/github/blob-cache.ts`

#### 3f. harvestManifestItems — extract primitives

For each path in the manifest items, `harvestManifestItems`:

1. Calls `provider.readFile(ref, path)` for all paths concurrently (Promise.allSettled)
2. For each resolved file, calls `extractFromFile({ ref, manifest }, { path, content })`
3. Failed reads are reported via `opts.onError` and skipped

`extractFromFile` in `src/infra/harvest/extractor.ts`:

1. **Determine kind**: `hint.kind` → `detectKindFromPath(path)` → path-contains-`/skills/` fallback
2. **Parse frontmatter**: splits `--- ... ---` YAML preamble from body. Falls back to zero frontmatter if absent.
3. **Extract title**: `frontmatter.title` → first `# Heading` in body → humanised file name
4. **Extract description**: `frontmatter.description` → first non-heading paragraph
5. **Extract tags**: `frontmatter.tags[]` merged with kind-specific manifest tags
6. **Build `Primitive`**: `{ kind, id, title, description, tags, path, sourceId, bundleId, bundleVersion, author }`

`collection.yml` and `deployment-manifest.yml` files are candidates but produce `null` in `extractFromFile` (their kind maps to nothing meaningful), so they are silently dropped.

**Key file:** `src/infra/harvest/extractor.ts`

#### 3g. AwesomeCopilotPluginBundleProvider

For `awesome-copilot-plugin` sources, the provider uses `enumeratePluginRepo` to find `plugins/` subdirectories, each treated as a separate bundle. Within each plugin, candidate files are found the same way as the single-bundle provider. MCP server entries are synthesised from `plugin.json` manifests via `extractPluginMcpServers`.

**Key file:** `src/infra/harvest/bundle-providers/plugin-bundle-provider.ts`

### Step 4 — Save index

`saveIndex` serialises all harvested `Primitive[]` into JSON and writes it to `primitive-index.json`. An HMAC-SHA256 sidecar (`primitive-index.json.sig`) is written alongside it to detect tampering or corruption on load.

**Key file:** `src/infra/stores/`

### Caching layers

| Layer | Key | Location | Purpose |
|-------|-----|----------|---------|
| Blob cache | git blob SHA1 | `<cache-dir>/blobs/<sha>` | Avoid re-fetching unchanged file content |
| Progress log | `sourceId` → `commitSha` | `<cache-dir>/harvest-progress.json` | Skip unchanged sources entirely on warm runs |
| ETag store | URL → ETag | `<cache-dir>/etags.json` | 304 Not Modified on hub-config + tree endpoints |

### Known limitations

- **`collection.yml` metadata ignored**: For `github` and `awesome-copilot` type sources, primitive files are found via tree scan using file name patterns. Titles, descriptions, and tags declared in `collection.yml` are not used; the extractor reads them from each file's YAML frontmatter instead.
- **Template files as false positives**: Files whose names end with `skill.md` but are reference templates (e.g., `references/templates/application-skill.md`) are harvested as skills. Add explicit frontmatter `kind: none` to exclude them, or rename to avoid the pattern.
- **Single bundle per repo**: For `github`/`awesome-copilot` sources, all primitives from all collections in the repo are grouped under one bundle ID. Per-collection granularity requires publishing separate releases or using `awesome-copilot-plugin` source type.

### Extending the harvester

**Add a new primitive kind:**
1. Add the file-name pattern to `isPrimitiveCandidatePath` in `tree-enumerator.ts`
2. Add the `pathKindHint` mapping in `github-bundle-provider.ts` (and `plugin-bundle-provider.ts`)
3. Add the `detectKindFromPath` case in `extractor.ts`
4. Add the new kind to `PrimitiveKind` in `src/domain/primitive/types.ts`

**Add a new source type:**
1. Implement `BundleProvider` interface
2. Register it in `HubHarvester.processSource` with a type guard
3. Add the type to `isSupportedType` in `hub-config-parser.ts`

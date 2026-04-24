# @prompt-registry/collection-scripts

Shared scripts for building, validating, and publishing Copilot prompt collections.

## Installation

### Option 1: Use with npx (Recommended)
No installation required - run from anywhere:

```bash
npx --package @prompt-registry/collection-scripts validate-collections
```

### Option 2: Install locally
```bash
npm install @prompt-registry/collection-scripts
```

### Option 3: Install globally
```bash
npm install -g @prompt-registry/collection-scripts
```

## Usage

### npx (No Installation Required)

```bash
# Validate collections
npx --package @prompt-registry/collection-scripts validate-collections --verbose

# Create a new skill (interactive)
npx --package @prompt-registry/collection-scripts create-skill

# Create a skill (non-interactive)
npx --package @prompt-registry/collection-scripts create-skill my-skill --description "A helpful skill" --non-interactive

# Validate skills
npx --package @prompt-registry/collection-scripts validate-skills

# Build collection bundle
npx --package @prompt-registry/collection-scripts build-collection-bundle --collection-file collections/my.collection.yml --version 1.0.0

# List collections
npx --package @prompt-registry/collection-scripts list-collections

# Publish affected collections (CI/CD)
npx --package @prompt-registry/collection-scripts publish-collections

# Analyze hub release downloads
npx --package @prompt-registry/collection-scripts hub-release-analyzer https://github.com/owner/repo
npx --package @prompt-registry/collection-scripts hub-release-analyzer ./hub-config.yml --output-dir ./reports
```

### After Installation

If installed locally or globally, you can run commands directly:

```bash
validate-collections --verbose
create-skill my-skill --description "A helpful skill"
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `validate-collections` | Validate collection YAML files |
| `validate-skills` | Validate skill folders following Agent Skills spec |
| `build-collection-bundle` | Build a collection bundle ZIP |
| `compute-collection-version` | Compute next version from git tags |
| `detect-affected-collections` | Detect collections affected by file changes |
| `generate-manifest` | Generate deployment manifest |
| `publish-collections` | Build and publish affected collections |
| `list-collections` | List all collections in repo |
| `create-skill` | Create a new skill directory structure |
| `hub-release-analyzer` | Analyze GitHub release download statistics for hub configs |
| `primitive-index` | Build, search, shortlist and export agentic primitives across bundles |

## Primitive Index

A deterministic, LLM-free search engine over **agentic primitives** (prompts,
instructions, chat modes, agents, skills, MCP servers) reachable from a local
hub cache or an extension's installed bundles.

```bash
# Build an index over a folder of bundle directories
primitive-index build --root ./my-hub-cache --out primitive-index.json

# Search — stable JSON output for skills/scripts
primitive-index search --index primitive-index.json \
  --q "terraform module" --kinds prompt --limit 5 --json

# Collect into a shortlist then export as a hub-schema profile
primitive-index shortlist new    --index primitive-index.json --name rust-onboarding
primitive-index shortlist add    --index primitive-index.json --id sl_... --primitive <primId>
primitive-index export           --index primitive-index.json \
  --shortlist sl_... --profile-id rust-onboarding --out-dir ./out --suggest-collection
```

Programmatic API:

```typescript
import {
  PrimitiveIndex,
  LocalFolderBundleProvider,
  exportShortlistAsProfile,
  saveIndex, loadIndex,
  runEval,
} from '@prompt-registry/collection-scripts';

const provider = new LocalFolderBundleProvider({ root: './my-hub-cache' });
const idx = await PrimitiveIndex.buildFrom(provider);
const res = idx.search({ q: 'review pull request', kinds: ['prompt'], limit: 10 });
```

See [`PRIMITIVE_INDEX_DESIGN.md`](./PRIMITIVE_INDEX_DESIGN.md) for the full
design, tech choices, eval thresholds and extension points (including the
pluggable `EmbeddingProvider` hook for hybrid ranking).

### Harvesting a real hub over GitHub

When you point the engine at a hub repo (one containing `hub-config.yml`)
it can walk every configured source, fetch primitives directly from the
GitHub API and assemble the index end-to-end:

```bash
# Token resolution: explicit flag > GITHUB_TOKEN > GH_TOKEN > `gh auth token`
primitive-index hub-harvest \
  --hub-repo Amadeus-xDLC/genai.prompt-registry-config \
  --cache-dir .primitive-index/cache \
  --concurrency 8 --json

# Post-run markdown report (per-source status, commit shas, blob-cache size)
primitive-index hub-report \
  --progress .primitive-index/cache/progress.jsonl \
  --cache-dir .primitive-index/cache
```

Design highlights:

- **Resumable**: append-only JSONL progress log survives SIGKILL.
- **Smart rebuild**: commit-sha comparison + `If-None-Match` 304 replay
  keeps warm runs near-free.
- **Content-addressed cache**: every git blob cached by its SHA1, with
  a tamper guard on insertion. Cross-source dedup is free.
- **Rate-limit aware**: primary + secondary rate limits handled with
  exponential + jittered backoff; `lastRateLimit` surfaced for
  observability.
- **Optional integrity**: `PRIMITIVE_INDEX_SIGN_KEY` env var enables a
  HMAC-SHA256 sidecar file, detectable via `verifyIndexIntegrity()`.
- **Resulting speed** on the 19-source Amadeus hub: **7.2s cold**
  (vs 86.2s serial baseline, 12×), **1.7s warm** (10×). 0 errors.

#### Plugin-format sources (`awesome-copilot-plugin`)

A second source type handles the awesome-copilot plugin layout (one
`plugin.json` per `plugins/<id>/.github/plugin/` directory, introduced
by PR #245). One repo = N bundles (one per plugin), all sharing the
repo commit sha for smart-rebuild.

Enable in `hub-config.yml`:

```yaml
sources:
  - id: upstream-ac
    type: awesome-copilot-plugin
    url: https://github.com/github/awesome-copilot
    enabled: true
    config:
      branch: main
      pluginsPath: plugins
```

Or inject on the CLI without touching the hub config:

```bash
primitive-index hub-harvest --no-hub-config \
  --cache-dir .primitive-index/cache \
  --extra-source 'id=upstream-ac,type=awesome-copilot-plugin,url=https://github.com/github/awesome-copilot,branch=main,pluginsPath=plugins'
```

Live benchmark on `github/awesome-copilot` (55 plugins, 133 skills):

| Optimisation | Cold |
|---|---:|
| Serial plugins + serial manifests | 44.8s |
| Parallel plugins | 28.4s |
| + Parallel manifests | **7.1s** |

Warm run: 1.7s (source-level smart-rebuild short-circuits the entire
55-plugin enumeration via one conditional `/commits/` 304).


## Programmatic API

```typescript
import {
  // Validation
  validateCollectionId,
  validateVersion,
  validateItemKind,
  validateCollectionFile,
  validateAllCollections,
  generateMarkdown,
  VALIDATION_RULES,
  
  // Collections
  listCollectionFiles,
  readCollection,
  resolveCollectionItemPaths,
  
  // Bundle ID
  generateBundleId,
  
  // CLI utilities
  parseSingleArg,
  parseMultiArg,
  hasFlag,
  getPositionalArg,
} from '@prompt-registry/collection-scripts';
```

## Usage in package.json

```json
{
  "scripts": {
    "validate": "validate-collections",
    "build": "build-collection-bundle --collection-file collections/my.collection.yml --version 1.0.0",
    "publish": "publish-collections"
  }
}
```

## Development

```bash
cd lib
npm install
npm run build
npm test
```

### Releasing

The package is configured to use provenance signing for npm publish. Make sure to set up OIDC authentication if publishing to npm.
The version is taken from the package.json file. Therefore it is important to bump the version before publishing 

```bash
npm version <patch|minor|major>
```

## License

Apache License Version 2.0

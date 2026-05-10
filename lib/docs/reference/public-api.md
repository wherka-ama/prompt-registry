# Public API Reference

Complete reference for the `@prompt-registry/collection-scripts` public API.

## Installation

```bash
npm install @prompt-registry/collection-scripts
```

## Imports

```typescript
// Main entry point
import { ... } from '@prompt-registry/collection-scripts';

// Namespace imports
import { registry, hub, core } from '@prompt-registry/collection-scripts';

// Specific modules
import { PrimitiveIndex } from '@prompt-registry/collection-scripts/registry';
import { GitHubClient } from '@prompt-registry/collection-scripts/hub';
```

## Core Types

### Bundle Types

```typescript
interface BundleManifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  items: ManifestItem[];
}

interface ManifestItem {
  file: string;
  kind: PrimitiveKind;
  id: string;
  title: string;
  description?: string;
}

type PrimitiveKind = 
  | 'prompt' 
  | 'skill' 
  | 'agent' 
  | 'instruction' 
  | 'chat-mode' 
  | 'mcp-server';

interface BundleRef {
  id: string;
  version: string;
  url: string;
}
```

### Primitive Types

```typescript
interface Primitive {
  kind: PrimitiveKind;
  id: string;
  bundleId: string;
  sourceId: string;
  title: string;
  description?: string;
  tags?: string[];
  path: string;
}

interface PromptPrimitive extends Primitive {
  kind: 'prompt';
  body: string;
}

interface SkillPrimitive extends Primitive {
  kind: 'skill';
  files: string[];
}
```

### Hub Types

```typescript
interface HubConfig {
  id: string;
  name: string;
  sources: HubSource[];
}

interface HubSource {
  type: 'github' | 'local-folder' | 'apm';
  owner?: string;
  repo?: string;
  path?: string;
}
```

## Classes

### PrimitiveIndex

Full-text search index over primitives.

```typescript
class PrimitiveIndex {
  // Build from bundle provider
  static async buildFrom(
    provider: BundleProvider,
    options?: BuildOptions
  ): Promise<PrimitiveIndex>;
  
  // Build from raw primitives
  static buildFromPrimitives(
    primitives: Primitive[]
  ): PrimitiveIndex;
  
  // Search
  search(params: SearchParams): SearchResult;
  
  // Facet filtering
  facet(filter: FacetFilter): Primitive[];
  
  // Shortlist management
  createShortlist(id: string): Shortlist;
  getShortlist(id: string): Shortlist | undefined;
  listShortlists(): Shortlist[];
  
  // Persistence
  saveIndex(path: string): Promise<void>;
  static loadIndex(path: string): Promise<PrimitiveIndex>;
  
  // Statistics
  stats(): IndexStats;
}
```

#### SearchParams

```typescript
interface SearchParams {
  q?: string;              // Search query
  kinds?: PrimitiveKind[]; // Filter by kind
  sources?: string[];      // Filter by source
  bundles?: string[];      // Filter by bundle
  tags?: string[];         // Filter by tag
  limit?: number;          // Max results (default: 20)
  offset?: number;         // Pagination offset
  explain?: boolean;       // Include scoring explanation
}
```

#### SearchResult

```typescript
interface SearchResult {
  hits: SearchHit[];
  total: number;
  took: number;  // Milliseconds
}

interface SearchHit {
  primitive: Primitive;
  score: number;
  explanation?: ScoreExplanation;
}
```

### GitHubClient

GitHub API client with rate limiting and caching.

```typescript
class GitHubClient {
  constructor(options?: ClientOptions);
  
  // Repository contents
  getContents(owner: string, repo: string, path: string): Promise<Content>;
  getTree(owner: string, repo: string, sha: string): Promise<TreeEntry[]>;
  
  // Releases
  listReleases(owner: string, repo: string): Promise<Release[]>;
  getReleaseByTag(owner: string, repo: string, tag: string): Promise<Release>;
  
  // Rate limiting
  getRateLimit(): Promise<RateLimit>;
  
  // Authentication
  setToken(token: string): void;
}

interface ClientOptions {
  token?: string;
  baseUrl?: string;
  timeout?: number;
}
```

### Harvester

Bundle discovery and content fetching.

```typescript
class Harvester {
  constructor(options: HarvesterOptions);
  
  // Harvest all bundles from provider
  harvest(options?: HarvestOptions): Promise<HarvestResult>;
  
  // Harvest single bundle
  harvestBundle(ref: BundleRef): Promise<HarvestedBundle>;
}

interface HarvesterOptions {
  provider: BundleProvider;
  cacheDir: string;
  concurrency?: number;
  onEvent?: (event: HarvestEvent) => void;
}

interface HarvestResult {
  primitives: Primitive[];
  errors: HarvestError[];
  stats: HarvestStats;
}
```

### BundleInstaller

Multi-target bundle installation.

```typescript
class BundleInstaller {
  constructor(options: InstallerOptions);
  
  // Install bundle
  install(params: InstallParams): Promise<InstallResult>;
  
  // Uninstall bundle
  uninstall(params: UninstallParams): Promise<void>;
}

interface InstallParams {
  bundlePath: string;
  targetId: string;
  scope: 'user' | 'workspace' | 'repository';
}

interface InstallResult {
  installedFiles: string[];
  lockfileUpdated: boolean;
}
```

### TargetStateStore

Target configuration management.

```typescript
class TargetStateStore {
  constructor(configDir: string);
  
  // Target CRUD
  addTarget(target: Target): Promise<void>;
  removeTarget(id: string): Promise<void>;
  getTarget(id: string): Promise<Target | undefined>;
  listTargets(): Promise<Target[]>;
  
  // Default target
  setDefaultTarget(id: string): Promise<void>;
  getDefaultTarget(): Promise<Target | undefined>;
}

interface Target {
  id: string;
  type: 'vscode' | 'vscode-insiders' | 'copilot-cli' | 'kiro' | 'windsurf' | string;
  path?: string;  // Custom path override
}
```

## Functions

### Validation

```typescript
// Validate collection YAML
function validateCollectionFile(
  content: string
): ValidationResult;

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

interface ValidationError {
  path: string;
  message: string;
  code: string;
}
```

### Building

```typescript
// Build collection bundle
function buildCollectionBundle(
  collectionPath: string,
  version: string
): Promise<BundlePath>;

// Create deterministic ZIP
function createDeterministicZip(
  files: Map<string, Buffer>,
  manifest: BundleManifest
): Promise<Buffer>;
```

### Publishing

```typescript
// Detect affected collections from git changes
function detectAffectedCollections(
  changedPaths: string[]
): string[];

// Compute next semantic version
function computeNextVersion(
  currentVersion: string,
  changeType: 'major' | 'minor' | 'patch'
): string;
```

### Extraction

```typescript
// Extract primitives from file content
function extractFromFile(
  content: string,
  filePath: string
): ExtractedPrimitive[];

// Detect primitive kind from path
function detectKindFromPath(filePath: string): PrimitiveKind | undefined;

// Extract MCP server primitives
function extractMcpServers(
  manifest: any
): McpPrimitive[];
```

## CLI Framework

### Command Definition

```typescript
import { defineCommand, CommandDefinition } from '@prompt-registry/collection-scripts/cli';

const command: CommandDefinition = defineCommand({
  path: ['collection', 'validate'],
  description: 'Validate a collection file',
  run: async ({ ctx, args }) => {
    // Command implementation
    return 0;
  }
});
```

### Context Interface

```typescript
interface Context {
  cwd(): string;
  env: Record<string, string | undefined>;
  stdout: OutputStream;
  stderr: OutputStream;
  fs: FileSystem;
}

interface OutputStream {
  write(chunk: string): void;
}

interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
}
```

### Error Handling

```typescript
import { RegistryError } from '@prompt-registry/collection-scripts/cli';

throw new RegistryError({
  code: 'CATEGORY.ERROR_TYPE',
  message: 'Human-readable description',
  hint: 'How to fix this',
  context: { key: 'value' }
});
```

## Constants

```typescript
// Primitive kinds
const PRIMITIVE_KINDS: PrimitiveKind[] = [
  'prompt',
  'skill',
  'agent',
  'instruction',
  'chat-mode',
  'mcp-server'
];

// Reserved target types
const RESERVED_TARGET_TYPES: string[] = [
  'vscode',
  'vscode-insiders',
  'copilot-cli',
  'kiro',
  'windsurf'
];

// Default paths
const DEFAULT_CACHE_DIR = '~/.cache/prompt-registry';
const DEFAULT_INDEX_PATH = '~/.cache/prompt-registry/index.json';
```

## Type Guards

```typescript
// Primitive kind guards
function isPrompt(p: Primitive): p is PromptPrimitive;
function isSkill(p: Primitive): p is SkillPrimitive;
function isAgent(p: Primitive): p is AgentPrimitive;

// Bundle provider guard
function isBundleProvider(obj: unknown): obj is BundleProvider;
```

## Examples

### Search Primitives

```typescript
import { PrimitiveIndex } from '@prompt-registry/collection-scripts';

const idx = await PrimitiveIndex.loadIndex('./index.json');

const results = idx.search({
  q: 'code review',
  kinds: ['prompt'],
  limit: 10
});

for (const hit of results.hits) {
  console.log(`${hit.primitive.title}: ${hit.score}`);
}
```

### Harvest from Hub

```typescript
import { Harvester, GitHubClient } from '@prompt-registry/collection-scripts';
import { HubBundles } from '@prompt-registry/collection-scripts/hub';

const client = new GitHubClient({ token: process.env.GITHUB_TOKEN });
const provider = new HubBundles(client, hubConfig);

const harvester = new Harvester({
  provider,
  cacheDir: './.cache',
  concurrency: 5
});

const result = await harvester.harvest();
console.log(`Harvested ${result.primitives.length} primitives`);
```

### Install Bundle

```typescript
import { BundleInstaller, TargetStateStore } from '@prompt-registry/collection-scripts';

const targetStore = new TargetStateStore('./.config');
const installer = new BundleInstaller({ targetStore });

const result = await installer.install({
  bundlePath: './my-bundle',
  targetId: 'vscode',
  scope: 'repository'
});

console.log(`Installed ${result.installedFiles.length} files`);
```

### Validate Collection

```typescript
import { validateCollectionFile } from '@prompt-registry/collection-scripts';

const content = await fs.readFile('collection.yml', 'utf-8');
const result = validateCollectionFile(content);

if (!result.valid) {
  for (const error of result.errors) {
    console.error(`${error.path}: ${error.message}`);
  }
}
```

## Version Compatibility

| Library Version | Node.js | TypeScript |
|----------------|---------|------------|
| 1.x | >= 18 | >= 5.0 |
| 2.x | >= 20 | >= 5.0 |

## Error Codes Reference

| Category | Code | Description |
|----------|------|-------------|
| USAGE | USAGE.UNKNOWN_COMMAND | Unknown CLI command |
| USAGE | USAGE.MISSING_ARGUMENT | Required argument missing |
| BUNDLE | BUNDLE.MANIFEST_NOT_FOUND | deployment-manifest.yml missing |
| BUNDLE | BUNDLE.INVALID_VERSION | Version mismatch or invalid |
| COLLECTION | COLLECTION.INVALID_YAML | YAML parsing error |
| COLLECTION | COLLECTION.INVALID_ID | Collection ID format error |
| INSTALL | INSTALL.TARGET_NOT_FOUND | Target doesn't exist |
| INSTALL | INSTALL.PERMISSION_DENIED | Filesystem permission error |
| GITHUB | GITHUB.RATE_LIMIT | API rate limit exceeded |
| GITHUB | GITHUB.NOT_FOUND | Resource not found |
| FS | FS.NOT_FOUND | File not found |
| INTERNAL | INTERNAL.UNEXPECTED | Unexpected error |

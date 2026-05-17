# Package Split and SEA Binary Distribution Design

## Current State

The project is currently distributed as a single npm package `@prompt-registry/collection-scripts` that includes:
- **Domain types** (bundles, primitives, hubs, registry config)
- **Ports/interfaces** (filesystem, HTTP, GitHub API)
- **Application layer** (use cases for collection, harvest, install, registry, search)
- **CLI framework and commands** (12 different CLI tools)
- **Infrastructure implementations** (downloaders, extractors, resolvers, stores, writers)

### Current Exports
```json
{
  ".": "./dist/index.js",
  "./domain": "./dist/domain/index.js",
  "./ports": "./dist/ports/index.js",
  "./app": "./dist/app/index.js"
}
```

### Current CLI Binaries
- `prompt-registry` (unified CLI)
- `validate-collections`
- `validate-skills`
- `build-collection-bundle`
- `compute-collection-version`
- `detect-affected-collections`
- `generate-manifest`
- `publish-collections`
- `list-collections`
- `create-skill`
- `hub-release-analyzer`

## Proposed Package Split

### Strategy 1: Minimal Disruption Split (Recommended)

Split into three packages while maintaining backward compatibility:

#### 1. `@prompt-registry/sdk` (New)
**Purpose**: Core SDK for programmatic consumption by clients (VS Code extension, other tools)

**Contents**:
- Domain types (pure, no I/O)
- Port interfaces (contracts only)
- Application layer (use cases with I/O via ports)
- Public API surface

**Exports**:
```json
{
  ".": "./dist/index.js",
  "./domain": "./dist/domain/index.js",
  "./ports": "./dist/ports/index.js",
  "./app": "./dist/app/index.js"
}
```

**Dependencies**: Minimal (js-yaml, semver, archiver, yauzl)

#### 2. `@prompt-registry/cli` (New)
**Purpose**: Unified CLI tool for developers and collection authors

**Contents**:
- CLI framework (Context, OutputStream, errors, config)
- CLI commands (all 12 commands)
- Infrastructure implementations (downloaders, extractors, resolvers, stores, writers)
- Depends on `@prompt-registry/sdk`

**Binary**: SEA (Single Executable Application) for distribution

**Distribution**:
- npm package (for `npx` usage)
- GitHub CLI extension (gh extension install)
- Standalone binaries (for direct download)

#### 3. `@prompt-registry/collection-scripts` (Legacy, Deprecated)
**Purpose**: Backward compatibility for existing consumers

**Contents**:
- Re-exports from `@prompt-registry/sdk`
- Re-exports from `@prompt-registry/cli` (binaries only)
- Deprecation notice in README

**Migration Path**: Document migration to new packages

### Strategy 2: Monorepo with Workspaces (Alternative)

Use npm workspaces with pnpm/yarn:
```
packages/
├── sdk/          # @prompt-registry/sdk
├── cli/          # @prompt-registry/cli
└── scripts/      # @prompt-registry/collection-scripts (legacy)
```

**Pros**: Better dependency management, shared dev tools
**Cons**: More complex setup, requires build system changes

## SEA Binary Distribution

### Build Matrix

Following the gh-app-auth pattern, build binaries for:
- `linux-amd64`
- `linux-arm64`
- `darwin-amd64` (macOS Intel)
- `darwin-arm64` (macOS Apple Silicon)
- `windows-amd64`
- `windows-arm64`

### Build Process

#### Local Build
```bash
# Build for current platform
npm run build:sea

# Build for specific platform
npm run build:sea:linux-amd64
npm run build:sea:darwin-arm64
```

#### CI Build
GitHub Actions workflow that:
1. Builds for all platforms in matrix
2. Uploads artifacts as release assets
3. Attaches checksums for verification
4. Promotes release to latest

### Package Naming Convention

```
prompt-registry-{version}-{platform}.{ext}

Examples:
prompt-registry-1.0.5-linux-amd64
prompt-registry-1.0.5-darwin-arm64
prompt-registry-1.0.5-windows-amd64.exe
```

### GitHub CLI Extension

#### Extension Manifest
Create `extension.yml` in CLI package:
```yaml
name: prompt-registry
description: Prompt Registry CLI for managing Copilot prompt collections
version: "{{ version }}"
commands:
  - name: prompt-registry
    help: Manage prompt collections
    alias: pr
```

#### Installation
```bash
# Install from release
gh extension install AmadeusITGroup/prompt-registry

# Install from local build
gh extension install ./dist/prompt-registry-darwin-arm64
```

#### Release Workflow
1. On release (tagged), trigger CI
2. Build SEA binaries for all platforms
3. Upload to GitHub release as assets
4. Set release as latest
5. GitHub CLI automatically picks up binaries for extension install

### CI/CD Pipeline

#### Workflow: `.github/workflows/release.yml`

```yaml
name: Release

on:
  release:
    types: [prereleased]

permissions:
  contents: write

jobs:
  build-binaries:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        platform:
          - linux-amd64
          - linux-arm64
          - darwin-amd64
          - darwin-arm64
          - windows-amd64
          - windows-arm64
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build:sea:${{ matrix.platform }}
      - uses: actions/upload-artifact@v4
        with:
          name: prompt-registry-${{ matrix.platform }}
          path: dist/prompt-registry-${{ matrix.platform }}*

  release:
    needs: build-binaries
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          path: dist/
      - name: Upload release assets
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          VERSION="${{ github.event.release.tag_name }}"
          gh release upload "$VERSION" dist/* --clobber
          gh release edit "$VERSION" --prerelease=false --latest
```

### Local Testing Flow

```bash
# Build SEA for current platform
npm run build:sea

# Install as local GitHub CLI extension
gh extension install ./dist/prompt-registry-$(uname -s)-$(uname -m)

# Test the extension
prompt-registry --help
prompt-registry collection validate --help

# Uninstall when done
gh extension remove prompt-registry
```

## Implementation Plan

### Phase 1: Package Structure (High Priority)
1. Create `packages/sdk/` directory structure
2. Move domain, ports, app, public to SDK
3. Update package.json for SDK
4. Create `packages/cli/` directory structure
5. Move CLI framework, commands, infra to CLI
6. Update CLI package.json to depend on SDK
7. Mark `@prompt-registry/collection-scripts` as deprecated

### Phase 2: SEA Binary Build (High Priority)
1. Enhance existing SEA build script
2. Add cross-platform build support
3. Add platform-specific build scripts
4. Test local builds for current platform
5. Add checksum generation

### Phase 3: GitHub CLI Extension (Medium Priority)
1. Create extension.yml manifest
2. Test local extension install
3. Document installation flow
4. Add extension-specific commands if needed

### Phase 4: CI/CD Pipeline (Medium Priority)
1. Create release workflow
2. Add build matrix for all platforms
3. Configure artifact upload
4. Test with prerelease
5. Add checksum verification

### Phase 5: Documentation (Low Priority)
1. Document package split
2. Document migration path
3. Document SEA binary usage
4. Document GitHub CLI extension installation
5. Update README with new distribution options

## Migration Path for Consumers

### For Extension Developers
```bash
# Before
import { PrimitiveIndex } from '@prompt-registry/collection-scripts';

# After
import { PrimitiveIndex } from '@prompt-registry/sdk';
```

### For CLI Users
```bash
# Before (npm)
npx @prompt-registry/collection-scripts prompt-registry

# After (npm)
npx @prompt-registry/cli

# After (GitHub CLI extension)
gh extension install AmadeusITGroup/prompt-registry
prompt-registry --help
```

### For Collection Authors
```bash
# Before
npx @prompt-registry/collection-scripts validate-collections

# After (unified CLI)
npx @prompt-registry/cli collection validate
```

## Backward Compatibility

The `@prompt-registry/collection-scripts` package will:
1. Re-export everything from SDK and CLI
2. Add deprecation warnings in README
3. Provide migration guide
4. Maintain for at least 2 major versions before removal

## Considerations

### Dependencies
- SDK should have minimal dependencies (pure library)
- CLI can have more dependencies (infrastructure)
- Avoid circular dependencies between packages

### Versioning
- Use independent versioning for SDK and CLI
- Or use lerna/changesets for monorepo versioning
- Document version compatibility matrix

### Build System
- Update TypeScript config for workspace
- Update ESLint config for workspace
- Update test runner for workspace
- Consider using turborepo or nx for monorepo tooling

### Performance
- SEA binaries should be optimized for size
- Use compression for release assets
- Provide checksums for verification

## References

- [gh-app-auth Makefile](https://github.com/AmadeusITGroup/gh-app-auth/blob/main/Makefile)
- [gh-app-auth Release Workflow](https://github.com/AmadeusITGroup/gh-app-auth/blob/main/.github/workflows/release.yml)
- [Node.js SEA Documentation](https://nodejs.org/api/single-executable-applications.html)
- [GitHub CLI Extensions](https://docs.github.com/en/github-cli/github-cli/creating-github-cli-extensions)

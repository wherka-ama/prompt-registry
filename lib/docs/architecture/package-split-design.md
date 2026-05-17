# Package Split and Distribution Strategy Design

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

## Distribution Strategy Overview

The project will be distributed through two channels:

1. **npm packages** for Node.js environments (extension, programmatic usage, npx)
2. **GitHub CLI extension** for standalone CLI usage without Node.js requirement

### Key Insight: Sidecar Repository for GitHub CLI Extension

GitHub CLI extensions have strict naming requirements:
- Repository name **must** start with `gh-`
- Binary assets must follow naming convention: `OS-ARCH[EXT]`
- Example: `linux-amd64`, `darwin-arm64`, `windows-amd64.exe`

The extension name is inferred from the repository name, not part of the binary filename.

Since the main repository is `wherka-ama/prompt-registry`, we cannot use it directly for GitHub CLI extension distribution. Instead, we will create a **sidecar repository** at:

**Repository**: `AmadeusITGroup/gh-prompt-registry` (or appropriate owner)
**Location**: `/home/wherka/workspace/opensource/gh-prompt-registry`

This sidecar repository will:
1. Clone the official prompt-registry repository
2. Build CLI binaries for all target platforms
3. Create GitHub releases with properly named assets
4. Handle all GitHub CLI extension-specific concerns

This approach keeps the main repository focused on the library/SDK while providing a clean separation for distribution concerns.

## npm Package Distribution

### Standard npm Package (No SEA)

For npm distribution, SEA (Single Executable Application) is **not needed** since `npx` implies the presence of a Node.js runtime. Users installing via npm will already have Node.js available.

Instead, we use standard npm package distribution with:
- Minimized JavaScript bundles
- Proper `files` field in package.json to control what gets published
- Source maps for debugging (optional, can be excluded from published package)

### Package Contents

The npm package will include:
- `dist/` - Compiled JavaScript
- `bin/` - CLI entry points
- `package.json` - Package metadata
- `README.md` - Documentation
- `LICENSE` - License file

### Tarball Inspection Command

Add a script to build and inspect the tarball that would be published to npm:

```json
{
  "scripts": {
    "pack": "npm pack",
    "pack:inspect": "npm run pack && tar -tzf *.tgz | head -50"
  }
}
```

Usage:
```bash
# Build tarball
npm run pack

# Inspect tarball contents
npm run pack:inspect

# Extract and inspect fully
tar -xzf @prompt-registry-collection-scripts-1.0.4.tgz
ls -la package/
```

This allows verification that:
- Only necessary files are included
- No test files or development artifacts are published
- The package structure is as expected

## GitHub CLI Extension Distribution (Sidecar Repository)

### Sidecar Repository Structure

**Repository**: `AmadeusITGroup/gh-prompt-registry`
**Location**: `/home/wherka/workspace/opensource/gh-prompt-registry`

This repository will be minimal and focused solely on:
1. Cloning the official prompt-registry repository
2. Building CLI binaries for all platforms
3. Creating GitHub releases with properly named assets
4. Managing GitHub CLI extension lifecycle

### Repository Contents

```
gh-prompt-registry/
├── .github/
│   └── workflows/
│       └── release.yml          # CI/CD for building and releasing
├── scripts/
│   ├── build.sh                  # Build script for all platforms
│   └── release.sh                # Release creation script
├── README.md                     # Extension installation docs
└── Makefile                      # Build targets
```

### Binary Naming Convention

GitHub CLI extensions require specific naming for binary assets:
```
OS-ARCH[.exe]

Examples:
linux-amd64
linux-arm64
darwin-amd64
darwin-arm64
windows-amd64.exe
windows-arm64.exe
```

The extension name is inferred from the repository name (`gh-prompt-registry`), not part of the binary filename.

### Build Process

The sidecar repository will:
1. Clone the official prompt-registry repository at a specific tag/commit
2. Install dependencies
3. Build the CLI using Node.js SEA (Single Executable Application) for each platform
4. Rename binaries to follow GitHub CLI extension naming convention
5. Create checksums for verification
6. Upload as release assets

### Installation

Users will install the extension via:
```bash
gh extension install AmadeusITGroup/gh-prompt-registry
```

GitHub CLI will automatically:
- Detect the user's platform
- Download the appropriate binary from the latest release
- Install it as a local extension
- Make it available as `gh prompt-registry`

### CI/CD Pipeline (Sidecar Repository)

#### Workflow: `.github/workflows/release.yml`

Located in the sidecar repository (`gh-prompt-registry`), this workflow will:

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
      
      - name: Clone official repository
        run: |
          git clone https://github.com/AmadeusITGroup/prompt-registry.git ../prompt-registry
          cd ../prompt-registry
          git checkout ${{ github.event.release.tag_name }}
      
      - name: Install dependencies
        working-directory: ../prompt-registry/lib
        run: npm ci
      
      - name: Build CLI
        working-directory: ../prompt-registry/lib
        run: npm run build
      
      - name: Build SEA binary for ${{ matrix.platform }}
        working-directory: ../prompt-registry/lib
        run: npm run build:sea:${{ matrix.platform }}
      
      - name: Rename binary to gh extension naming
        run: |
          # Rename to OS-ARCH[.exe]
          if [[ "${{ matrix.platform }}" == windows-* ]]; then
            mv ../prompt-registry/lib/dist/prompt-registry.exe \
               ${{ matrix.platform }}.exe
          else
            mv ../prompt-registry/lib/dist/prompt-registry \
               ${{ matrix.platform }}
          fi
      
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.platform }}
          path: ${{ matrix.platform }}*

  release:
    needs: build-binaries
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          path: dist/
      - name: Generate checksums
        run: |
          cd dist
          sha256sum * > SHA256SUMS.txt
      - name: Upload release assets
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          VERSION="${{ github.event.release.tag_name }}"
          gh release upload "$VERSION" dist/* --clobber
          gh release edit "$VERSION" --prerelease=false --latest
```

### Local Testing Flow (Sidecar Repository)

#### Testing GitHub CLI Extension Locally

To test the GitHub CLI extension locally before publishing:

```bash
# Clone sidecar repository
cd /home/wherka/workspace/opensource/gh-prompt-registry

# Clone official repository and checkout desired tag
./scripts/build.sh --tag v1.0.4

# Build for current platform only (for quick testing)
./scripts/build.sh --local

# Install as local GitHub CLI extension
gh extension install ./$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)

# Test the extension
gh prompt-registry --help
gh prompt-registry collection validate --help

# Uninstall when done
gh extension remove gh-prompt-registry
```

#### Testing npm Package

To test the npm package before publishing:

```bash
cd /home/wherka/workspace/opensource/prompt-registry/lib

# Build tarball and inspect contents
npm run pack:inspect

# Install locally from tarball
npm install -g ./@prompt-registry-collection-scripts-1.0.4.tgz

# Test CLI
prompt-registry --help

# Uninstall
npm uninstall -g @prompt-registry/collection-scripts
```

## Implementation Plan

### Critical Review: npm Workspaces Approach

**Question**: Should we use npm workspaces to introduce new packages without moving sources?

**Analysis**:
- npm workspaces allow defining multiple packages in a monorepo structure
- The legacy package `@prompt-registry/collection-scripts` can remain as-is
- New workspaces can define their scope according to recommendations
- Publications can be triggered based on the workspace concept
- No source code movement required - only package.json configuration

**Recommendation**: **Use npm workspaces** to introduce new packages. This approach:
1. Keeps the legacy package intact at the root
2. Introduces new workspace packages in a `packages/` directory
3. Each workspace defines its scope and dependencies
4. Allows independent publishing of each workspace
5. Maintains backward compatibility

### Workspace Structure

```
prompt-registry/
├── lib/                             # Legacy package (remains as-is)
│   ├── package.json                 # @prompt-registry/collection-scripts
│   ├── src/
│   ├── dist/
│   └── bin/
├── packages/
│   ├── sdk/                         # New workspace: @prompt-registry/sdk
│   │   ├── package.json
│   │   └── src/ (symlinks to lib/src/domain, lib/src/ports, lib/src/public)
│   └── cli/                         # New workspace: @prompt-registry/cli
│       ├── package.json
│       └── src/ (symlinks to lib/src/cli, lib/src/app, lib/src/infra)
├── package.json                     # Root package.json with workspaces config
└── pnpm-workspace.yaml              # Workspace configuration (if using pnpm)
```

### Revised Implementation Plan

#### Phase 1: Configure npm Workspaces (High Priority)
1. Add `workspaces` field to root package.json
2. Create `packages/sdk/` directory structure
3. Create `packages/cli/` directory structure
4. Configure workspace package.json files
5. Set up symlinks or re-exports for source sharing
6. Test workspace installation and linking

#### Phase 2: Define SDK Workspace Scope (High Priority)
1. Create SDK package.json with domain, ports, public exports
2. Add proper exports field for SDK workspace
3. Configure SDK dependencies (minimal, pure library)
4. Add SDK-specific build scripts
5. Test SDK workspace independently

#### Phase 3: Define CLI Workspace Scope (High Priority)
1. Create CLI package.json with CLI, app, infra exports
2. Add proper exports field for CLI workspace
3. Configure CLI dependencies (can include infra dependencies)
4. Add CLI-specific build scripts
5. Test CLI workspace independently

#### Phase 4: Update Legacy Package (Medium Priority)
1. Update legacy package.json to re-export from workspaces
2. Add deprecation notice to legacy package README
3. Document migration path from legacy to workspaces
4. Test backward compatibility
5. Plan legacy package deprecation timeline

#### Phase 5: Create Sidecar Repository (High Priority)
1. Create repository at `/home/wherka/workspace/opensource/gh-prompt-registry`
2. Initialize with minimal structure (scripts, workflows, README)
3. Create build script that clones official repo and builds binaries
4. Add Makefile with build targets for local testing
5. Set up GitHub repository and configure topics

#### Phase 6: SEA Binary Build for Sidecar (High Priority)
1. Enhance existing SEA build script in main repository
2. Add cross-platform build support (linux, darwin, windows, amd64, arm64)
3. Add platform-specific build targets
4. Test local builds for current platform
5. Add checksum generation

#### Phase 7: CI/CD Pipeline for Sidecar (Medium Priority)
1. Create release workflow in sidecar repository
2. Configure workflow to clone official repo at tag
3. Add build matrix for all platforms
4. Implement binary renaming to OS-ARCH[.exe] convention
5. Add checksum generation and upload
6. Test with prerelease

#### Phase 8: Documentation (Low Priority)
1. Document GitHub CLI extension installation
2. Update main repository README with extension info
3. Document sidecar repository purpose and usage
4. Add npm tarball inspection guide
5. Update AGENTS.md with distribution insights
6. Document workspace structure and usage

## Migration Path for Consumers

### For Extension Developers (npm package)
**No changes required**. The npm package name and exports remain the same:
```bash
# Continues to work as before
import { PrimitiveIndex } from '@prompt-registry/collection-scripts';
```

### For Extension Developers (SDK workspace - New Option)
After workspaces are introduced, developers can use the SDK workspace for a more focused API:
```bash
# New option: use SDK workspace
import { PrimitiveIndex } from '@prompt-registry/sdk';
```

### For CLI Users (npm/npx)
**No changes required**. The npm package continues to work with npx:
```bash
# Continues to work as before
npx @prompt-registry/collection-scripts prompt-registry --help
npx @prompt-registry/collection-scripts collection validate --help
```

### For CLI Users (GitHub CLI Extension - New Option)
Users can now install as a GitHub CLI extension for standalone usage without Node.js:
```bash
# New option: install as GitHub CLI extension
gh extension install AmadeusITGroup/gh-prompt-registry

# Use the extension
gh prompt-registry --help
gh prompt-registry collection validate --help
```

### For Collection Authors
**No changes required**. Continue using the same npm package:
```bash
# Continues to work as before
npx @prompt-registry/collection-scripts validate-collections
npx @prompt-registry/collection-scripts build-collection-bundle
```

## Backward Compatibility

**No breaking changes**. The npm package `@prompt-registry/collection-scripts` will:
1. Continue to work exactly as before
2. Maintain the same exports and API
3. Support the same CLI commands
4. No deprecation needed

The GitHub CLI extension is an **additional distribution channel**, not a replacement. Users can choose:
- npm/npx for Node.js environments
- GitHub CLI extension for standalone usage without Node.js

## Considerations

### Dependencies
- Keep npm package dependencies minimal and well-maintained
- SEA binaries for GitHub CLI extension will bundle all dependencies
- No circular dependencies needed since we're not splitting packages

### Versioning
- npm package and GitHub CLI extension can use independent versioning
- Sidecar repository should track the main repository's version tags
- Document version compatibility if needed

### Build System
- npm package: Use existing TypeScript build system
- SEA binaries: Use existing SEA build script with cross-platform support
- No monorepo tooling needed since we're not splitting packages

### Performance
- npm package: Standard JavaScript distribution (no SEA needed)
- SEA binaries: Optimize for size and startup time
- Use compression for release assets
- Provide checksums for verification

### Sidecar Repository Maintenance
- Sidecar repo should be minimal and focused on distribution
- Update sidecar repo when main repository releases new versions
- Keep sidecar repo in sync with main repository's build process

## References

- [GitHub CLI Extensions Documentation](https://docs.github.com/en/github-cli/github-cli/creating-github-cli-extensions) - Official GitHub CLI extension requirements
- [GitHub CLI Extension Naming](https://github.com/cli/cli/blob/14f704fd0da58cc01413ee4ba16f13f27e33d15e/pkg/cmd/extension/manager.go) - Source code for OS/ARCH naming convention
- [gh-app-auth Makefile](https://github.com/AmadeusITGroup/gh-app-auth/blob/main/Makefile) - Reference for binary build pattern
- [gh-app-auth Release Workflow](https://github.com/AmadeusITGroup/gh-app-auth/blob/main/.github/workflows/release.yml) - Reference for CI/CD pipeline
- [Node.js SEA Documentation](https://nodejs.org/api/single-executable-applications.html) - Single Executable Application documentation
- [npm Pack Documentation](https://docs.npmjs.com/cli/v9/commands/npm-pack) - npm pack command reference

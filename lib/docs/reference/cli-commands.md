# CLI Commands Reference

Complete reference for the `prompt-registry` CLI commands.

## Global Options

```
prompt-registry [options] <command>

Options:
  --help, -h          Show help
  --version, -v       Show version
  --cwd <path>        Set working directory
  --output, -o        Output format: text, json, yaml, ndjson (default: text)
  --verbose, -V       Verbose output
```

## Collection Commands

### collection validate

Validate collection YAML files.

```bash
prompt-registry collection validate [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--collection-file <path>` | Specific collection file to validate |
| `--all` | Validate all collections in directory |

**Examples:**
```bash
# Validate single collection
prompt-registry collection validate --collection-file my.collection.yml

# Validate all collections
prompt-registry collection validate --all

# Output as JSON
prompt-registry collection validate --all -o json
```

**Output:**
```json
{
  "command": "collection.validate",
  "status": "ok",
  "data": {
    "valid": 3,
    "invalid": 1,
    "errors": [
      { "file": "bad.collection.yml", "message": "Invalid ID format" }
    ]
  }
}
```

### collection list

List all collections.

```bash
prompt-registry collection list [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |
| `--yaml` | Output as YAML |

**Examples:**
```bash
prompt-registry collection list
prompt-registry collection list --json
```

## Bundle Commands

### bundle build

Build a deterministic bundle from collection.

```bash
prompt-registry bundle build [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--collection-file <path>` | Collection file to build |
| `--version <version>` | Bundle version (auto-detected from git if not provided) |
| `--out <path>` | Output file path |
| `--out-dir <dir>` | Output directory |

**Examples:**
```bash
# Build with auto-detected version
prompt-registry bundle build --collection-file my.collection.yml

# Build with specific version
prompt-registry bundle build --collection-file my.collection.yml --version 1.2.3

# Build to specific output
prompt-registry bundle build -c my.collection.yml --out ./dist/my-bundle.zip
```

### bundle manifest

Generate or validate deployment manifest.

```bash
prompt-registry bundle manifest [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--collection-file <path>` | Generate manifest from collection |
| `--bundle <path>` | Validate existing bundle manifest |
| `--out <path>` | Output path for generated manifest |

**Examples:**
```bash
# Generate manifest
prompt-registry bundle manifest --collection-file my.collection.yml

# Validate bundle manifest
prompt-registry bundle manifest --bundle ./my-bundle.zip
```

## Primitive Index Commands

### primitive-index search

Search the primitive index.

```bash
prompt-registry primitive-index search [options]
```

**Options:**
| Short | Long | Description |
|-------|------|-------------|
| `-q` | `--query <text>` | Search query |
| `-k` | `--kind <kind>` | Filter by kind (can repeat) |
| `-s` | `--source <source>` | Filter by source (can repeat) |
| `-b` | `--bundle <bundle>` | Filter by bundle (can repeat) |
| `-t` | `--tag <tag>` | Filter by tag (can repeat) |
| `-l` | `--limit <n>` | Max results (default: 20) |
| `-o` | `--offset <n>` | Result offset for pagination |
| | `--explain` | Include scoring explanation |
| | `--index <path>` | Custom index path |

**Examples:**
```bash
# Simple search
prompt-registry primitive-index search -q "code review"

# Filtered search
prompt-registry primitive-index search -q "terraform" -k prompt -k skill

# With explanation
prompt-registry primitive-index search -q "security" --explain

# JSON output
prompt-registry primitive-index search -q "api" -o json
```

**Output:**
```json
{
  "command": "primitive-index.search",
  "status": "ok",
  "data": {
    "hits": [
      {
        "primitive": {
          "kind": "prompt",
          "id": "abc123",
          "title": "Code Review",
          "description": "..."
        },
        "score": 2.45
      }
    ],
    "total": 15,
    "took": 3
  }
}
```

### primitive-index harvest

Harvest primitives from GitHub hub.

```bash
prompt-registry primitive-index harvest [options]
```

**Options:**
| Long | Description |
|------|-------------|
| `--hub-repo <owner/repo>` | Hub repository to harvest from |
| `--cache-dir <path>` | Cache directory (default: ~/.cache/prompt-registry) |
| `--concurrency <n>` | Concurrent fetches (default: 5) |
| `--force` | Force re-harvest (ignore cache) |
| `--dry-run` | Show what would be harvested without downloading |
| `--extra-source <source>` | Add extra source (can repeat) |
| `--progress <file>` | Write progress to JSONL file |

**Examples:**
```bash
# Harvest from default hub
prompt-registry primitive-index harvest --hub-repo owner/awesome-copilot

# Force re-harvest
prompt-registry primitive-index harvest --hub-repo owner/awesome-copilot --force

# With progress tracking
prompt-registry primitive-index harvest --progress ./harvest.jsonl
```

### primitive-index stats

Show index statistics.

```bash
prompt-registry primitive-index stats [options]
```

**Options:**
| Long | Description |
|------|-------------|
| `--index <path>` | Custom index path |

**Output:**
```json
{
  "command": "primitive-index.stats",
  "status": "ok",
  "data": {
    "primitiveCount": 343,
    "bundleCount": 74,
    "termCount": 1247,
    "avgDocLength": 45.2,
    "kindBreakdown": {
      "prompt": 150,
      "skill": 80,
      "agent": 40,
      "instruction": 45,
      "chat-mode": 18,
      "mcp-server": 10
    }
  }
}
```

### primitive-index shortlist

Manage shortlists (saved search results).

```bash
# Create new shortlist
prompt-registry primitive-index shortlist new <id>

# Add primitives to shortlist
prompt-registry primitive-index shortlist add <shortlist-id> <primitive-id>

# Remove primitives from shortlist
prompt-registry primitive-index shortlist remove <shortlist-id> <primitive-id>

# List shortlists
prompt-registry primitive-index shortlist list

# Show shortlist contents
prompt-registry primitive-index shortlist show <shortlist-id>
```

**Examples:**
```bash
# Create and populate shortlist
prompt-registry primitive-index shortlist new my-onboarding
prompt-registry primitive-index shortlist add my-onboarding abc123
prompt-registry primitive-index shortlist add my-onboarding def456

# Export as profile
prompt-registry primitive-index export --shortlist my-onboarding --profile-id onboarding
```

### primitive-index export

Export shortlist as installable profile.

```bash
prompt-registry primitive-index export [options]
```

**Options:**
| Long | Description |
|------|-------------|
| `--shortlist <id>` | Shortlist to export |
| `--profile-id <id>` | Profile ID for output |
| `--out-dir <path>` | Output directory (default: ./profiles) |
| `--suggest-collection` | Suggest collection structure |

## Install Commands

### install

Install a bundle to a target.

```bash
prompt-registry install <bundle-path> [options]
```

**Options:**
| Short | Long | Description |
|-------|------|-------------|
| `-t` | `--target <id>` | Target to install to |
| `-s` | `--scope <scope>` | Installation scope: user, workspace, repository |
| | `--dry-run` | Show what would be installed |

**Examples:**
```bash
# Install to default target (user scope)
prompt-registry install ./my-bundle.zip

# Install to specific target (repository scope)
prompt-registry install ./my-bundle.zip -t vscode -s repository

# Dry run
prompt-registry install ./my-bundle.zip --dry-run
```

### target

Manage installation targets.

```bash
# Add target
prompt-registry target add <id> <type> [path]

# Remove target
prompt-registry target remove <id>

# List targets
prompt-registry target list

# Set default target
prompt-registry target default <id>
```

**Target Types:**
| Type | Description |
|------|-------------|
| `vscode` | VS Code stable |
| `vscode-insiders` | VS Code Insiders |
| `copilot-cli` | GitHub Copilot CLI |
| `kiro` | Kiro IDE |
| `windsurf` | Windsurf IDE |
| `custom` | Custom path |

**Examples:**
```bash
# Add VS Code target
prompt-registry target add my-vscode vscode

# Add custom path
prompt-registry target add work-vscode vscode ~/.config/Code-Work/User

# List targets
prompt-registry target list
```

## Utility Commands

### doctor

Diagnose environment issues.

```bash
prompt-registry doctor [options]
```

**Output:**
```
✓ Node.js version: 20.5.1
✓ Git installed: 2.42.0
✓ GitHub token: configured
✓ Default target: vscode
⚠ Cache directory: 2.3 GB (consider cleaning)
✗ No collections found in /home/user/collections
```

### version

Show version information.

```bash
prompt-registry version
```

### publish-collections

Publish affected collections to GitHub releases.

```bash
prompt-registry publish-collections [options]
```

**Options:**
| Long | Description |
|------|-------------|
| `--repo-slug <owner/repo>` | Target repository |
| `--base-sha <sha>` | Base commit for change detection |
| `--changed-path <path>` | Changed file path (can repeat) |
| `--dry-run` | Show what would be published |
| `--skip-version-computation` | Use provided versions |

**Examples:**
```bash
# Auto-detect changes and publish
prompt-registry publish-collections --repo-slug owner/registry

# From CI with explicit changes
prompt-registry publish-collections \
  --repo-slug owner/registry \
  --base-sha $BASE_SHA \
  --changed-path "collections/test.collection.yml"
```

## Hub Commands

### hub-harvest

Harvest from hub with advanced options.

```bash
prompt-registry hub-harvest [options]
```

**Options:**
| Long | Description |
|------|-------------|
| `--hub-config-file <path>` | Custom hub config file |
| `--no-hub-config` | Skip hub config, use only extra sources |
| `--output <format>` | Output: text, json, yaml |

### hub-report

Generate harvest report.

```bash
prompt-registry hub-report [options]
```

**Options:**
| Long | Description |
|------|-------------|
| `--progress <file>` | Progress file from harvest |
| `--format <format>` | Report format: markdown, html, json |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub API token |
| `GH_TOKEN` | Alternative GitHub token |
| `PROMPT_REGISTRY_CACHE` | Cache directory override |
| `XDG_CACHE_HOME` | XDG cache directory |
| `DEBUG` | Enable debug logging (e.g., `DEBUG=prompt-registry:*`) |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Validation error |
| 3 | Network error |
| 4 | Authentication error |
| 5 | Not found |

## Shell Completion

### Bash
```bash
source <(prompt-registry completion bash)
```

### Zsh
```bash
source <(prompt-registry completion zsh)
```

### Fish
```bash
prompt-registry completion fish | source
```

## Examples

### Full Workflow

```bash
# 1. Validate collection
prompt-registry collection validate -c my.collection.yml

# 2. Build bundle
prompt-registry bundle build -c my.collection.yml --version 1.0.0

# 3. Test locally
prompt-registry install ./dist/my-collection-1.0.0.zip --dry-run

# 4. Publish (in CI)
prompt-registry publish-collections --repo-slug myorg/registry
```

### Search Workflow

```bash
# 1. Harvest index
prompt-registry primitive-index harvest --hub-repo myorg/awesome-copilot

# 2. Search
prompt-registry primitive-index search -q "terraform" -k skill

# 3. Add to shortlist
prompt-registry primitive-index shortlist new tf-skills
prompt-registry primitive-index shortlist add tf-skills <hit-id>

# 4. Export for team
prompt-registry primitive-index export --shortlist tf-skills --profile-id terraform
```

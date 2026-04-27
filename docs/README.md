# Prompt Registry Documentation

Marketplace and registry for Copilot prompt bundles in VS Code.

---

## 📖 For Users

- **[Getting Started](user-guide/getting-started.md)** — Installation and first steps
- **[Marketplace](user-guide/marketplace.md)** — Browsing and installing bundles
- **[Repository Installation](user-guide/repository-installation.md)** — Team-shared configurations via Git
- **[Sources](user-guide/sources.md)** — Managing bundle sources
- **[Profiles and Hubs](user-guide/profiles-and-hubs.md)** — Profile and Hub management (VS Code extension UI)
- **[Hubs and Profiles (CLI)](user-guide/hubs-and-profiles-cli.md)** — Same model from the `prompt-registry` CLI (Phase 6)
- **[Configuration](user-guide/configuration.md)** — Extension settings and telemetry
- **[Primitive Index](user-guide/primitive-index.md)** — Local BM25 search over agentic primitives (agents, chat-modes, instructions, MCP servers, prompts, skills)
- **[Troubleshooting](user-guide/troubleshooting.md)** — Common issues

---

## ✍️ For Collection Authors

- **[Creating Collections](author-guide/creating-source-bundle.md)** — How to create collections
- **[Collection Scripts](author-guide/collection-scripts.md)** — Shared npm package for validation and building
- **[Collection Schema](author-guide/collection-schema.md)** — YAML schema reference
- **[Validation](author-guide/validation.md)** — Validating collections
- **[Publishing](author-guide/publishing.md)** — Publishing to registries

---

## 🔧 For Contributors

- **[Development Setup](contributor-guide/development-setup.md)** — Local dev environment
- **[Architecture](contributor-guide/architecture.md)** — System overview
  - [Adapters](contributor-guide/architecture/adapters.md)
  - [Authentication](contributor-guide/architecture/authentication.md)
  - [Installation Flow](contributor-guide/architecture/installation-flow.md)
  - [Update System](contributor-guide/architecture/update-system.md)
  - [UI Components](contributor-guide/architecture/ui-components.md)
  - [MCP Integration](contributor-guide/architecture/mcp-integration.md)
  - [Scaffolding](contributor-guide/architecture/scaffolding.md)
  - [Validation](contributor-guide/architecture/validation.md)
- **[Core Flows](contributor-guide/core-flows.md)** — Key system flows
- **[Testing](contributor-guide/testing.md)** — Testing strategy
- **[Testing SSH Remote](contributor-guide/testing-ssh-remote.md)** — SSH testing
- **[Validation](contributor-guide/validation.md)** — Local validation commands
- **[Coding Standards](contributor-guide/coding-standards.md)** — Style guide
- **[Primitive Index Architecture](contributor-guide/primitive-index-architecture.md)** — Engine-room view with Mermaid diagrams
- **[Primitive Index Spec](contributor-guide/spec-primitive-index.md)** — Deterministic search + shortlist + profile export
- **[Shortlist CLI UX Spec](contributor-guide/spec-shortlist-cli-ux.md)** — Mitigation design for shortlist subcommand help and error handling
- **[Primitive Index Hub Iterations](contributor-guide/primitive-index-hub-iterations.md)** — Condensed changelog of the 50-iteration hub-harvester sprint
- **[Primitive Index Reusable Layers](contributor-guide/primitive-index-reusable-layers.md)** — `core` / `hub` / `registry` barrels for a future generic CLI
- **[Primitive Index Extension Integration](contributor-guide/primitive-index-extension-integration.md)** — Playbook for wiring the index into the VS Code UI
- **[Releasing](contributor-guide/releasing.md)** — Release process

---

## 📋 Reference

- **[Commands](reference/commands.md)** — VS Code commands
- **[Settings](reference/settings.md)** — Extension settings
- **[Adapter API](reference/adapter-api.md)** — Custom adapters
- **[Hub Schema](reference/hub-schema.md)** — Hub configuration

---

## Additional Resources

- [CONTRIBUTING.md](../CONTRIBUTING.md) — Contribution guidelines
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) — Community standards
- [SECURITY.md](../SECURITY.md) — Security policy

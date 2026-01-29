## Description

MCP servers defined in collection files were not being installed when bundles were installed from GitHub Releases. The `lib/bin/generate-manifest.js` script, which generates the `deployment-manifest.yml` during CI/CD bundle builds, was not copying the `mcp` or `mcpServers` field from the collection YAML to the generated manifest. This resulted in GitHub Release bundles having no MCP server definitions, causing the extension to skip MCP installation entirely.

## Type of Change

- [x] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📝 Documentation update
- [ ] ♻️ Code refactoring (no functional changes)
- [ ] ⚡ Performance improvement
- [ ] 🧪 Test coverage improvement
- [ ] 🔧 Configuration/build changes

## Related Issues

Fixes #[issue_number]

## Changes Made

- Modified `lib/bin/generate-manifest.js` to extract MCP servers from collection files
- Added support for both `collection.mcpServers` and `collection.mcp.items` formats (matching AwesomeCopilotAdapter behavior)
- Included `mcpServers` field in the generated deployment manifest when present
- Added logging output for MCP servers count during manifest generation

## Testing

### Test Coverage

- [x] Unit tests added/updated
- [ ] Integration tests added/updated
- [x] Manual testing completed
- [x] All existing tests pass

### Manual Testing Steps

1. Run lib tests: `cd lib && npm test` → 102 passing
2. Run extension unit tests: `LOG_LEVEL=ERROR npm run test:unit` → 2180 passing
3. Run full validation: `.github/workflows/scripts/validate-locally.sh` → All 11 steps passed
4. Verify manifest generation includes MCP servers (will be visible in CI logs after merge)

### Tested On

- [x] Linux
- [ ] macOS
- [ ] Windows

- [x] VS Code Insiders
- [ ] VS Code Stable

## Screenshots

N/A - This is a build-time fix affecting manifest generation

## Checklist

- [x] My code follows the project's style guidelines
- [x] I have performed a self-review of my code
- [x] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [x] My changes generate no new warnings or errors
- [x] I have added tests that prove my fix is effective or that my feature works
- [x] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published

## Documentation

- [ ] README.md updated
- [ ] JSDoc comments added/updated
- [x] No documentation changes needed

## Additional Notes

**Important:** Existing GitHub Release bundles will need to be **rebuilt and republished** for this fix to take effect. The fix only applies to newly generated bundles created after this change is merged.

**Root Cause:** The collection schema (`schemas/collection.schema.json`) defines MCP servers under `mcp.items`, but the manifest generation script was only copying `prompts`, `tags`, and basic metadata fields. The `mcpServers` field was completely omitted from the generated `deployment-manifest.yml`.

**Verification:** The fix has been validated with:
- 102 lib tests passing
- 2180 extension unit tests passing
- Full local validation suite (11 steps)

## Reviewer Guidelines

Please pay special attention to:

- The logic for extracting MCP servers from both `collection.mcpServers` and `collection.mcp.items` (lines 120-121)
- The conditional inclusion in the manifest using spread operator (line 136)
- The logging output for MCP servers count (lines 158-161)
- Consistency with how `AwesomeCopilotAdapter` handles the same fields

---

**By submitting this pull request, I confirm that my contribution is made under the terms of the Apache License 2.0.**

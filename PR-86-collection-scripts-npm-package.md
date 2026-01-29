## Description

This PR extracts the collection build and validation scripts from the GitHub scaffold template into a standalone npm package `@prompt-registry/collection-scripts`. This addresses the maintenance burden of duplicating scripts across all scaffolded repositories and provides a single source of truth for collection validation and publishing logic.

**Key Benefits:**
- **Single Source of Truth**: All repositories use identical validation logic
- **Automatic Updates**: Bug fixes and improvements propagate via npm updates
- **Reduced Duplication**: Eliminates ~5000 lines of duplicated code across repositories
- **Consistent Behavior**: CLI, CI/CD, and VS Code extension use the same validation
- **Easier Maintenance**: Centralized code reduces maintenance burden

## Type of Change

- [x] ✨ New feature (non-breaking change which adds functionality)
- [x] ♻️ Code refactoring (no functional changes)
- [x] 📝 Documentation update
- [x] 🔧 Configuration/build changes

## Related Issues

Closes #86

## Changes Made

### New `lib/` Package Structure

Created `@prompt-registry/collection-scripts` npm package in `lib/` directory:

**CLI Commands:**
- `validate-collections` - Validate collection YAML files
- `validate-skills` - Validate skill folders against Agent Skills spec
- `build-collection-bundle` - Build collection bundle ZIP
- `compute-collection-version` - Compute next version from git tags
- `detect-affected-collections` - Detect collections affected by file changes
- `generate-manifest` - Generate deployment manifest
- `publish-collections` - Build and publish affected collections
- `list-collections` - List all collections in repo
- `create-skill` - Interactive wizard to create new skills

**Programmatic API:**
- TypeScript source in `lib/src/` with full type definitions
- Exported functions for validation, collection utilities, bundle ID generation
- Skills API for creating and validating Agent Skills

**Test Coverage:**
- Comprehensive test suite in `lib/test/`
- Tests for validation, collections, skills, bundle ID, CLI utilities
- Publish workflow tests (dry-run mode, git diff parsing, zip operations)

### GitHub Actions Integration

- New workflow: `.github/workflows/lib-collection-scripts-ci.yml`
  - Runs tests for the `lib/` package
  - Validates TypeScript compilation
  - Ensures package is publishable
- Updated main CI workflow to exclude `lib/` from extension security scans

### Template Updates

**GitHub Scaffold Template:**
- Removed local `scripts/lib/` directory (now uses npm package)
- Updated `package.json` to depend on `@prompt-registry/collection-scripts`
- Simplified npm scripts to use CLI commands directly
- Added `.npmrc.template` with GitHub Packages authentication setup
- Updated README with authentication instructions

**GitHub Actions Workflows:**
- Updated to use `npx` commands from the npm package
- Automatic authentication via `GITHUB_TOKEN` in CI

### VS Code Extension Updates

**ScaffoldCommand:**
- Updated post-scaffold flow to provide GitHub Packages authentication instructions
- Removed automatic `npm install` prompt (requires auth setup first)
- Added detailed instructions for both GitHub CLI and manual token setup

**ValidateApmCommand:**
- Updated to import validation functions from the npm package

### Documentation

- **`lib/README.md`**: Package overview, installation, usage
- **`docs/author-guide/collection-scripts.md`**: Comprehensive guide for collection authors
- **`docs/contributor-guide/spec-collection-scripts-lib.md`**: Technical specification and design decisions
- Updated main `docs/README.md` to link to new documentation

### Migration Path

**For Existing Repositories:**
1. Remove local `scripts/lib/` directory
2. Add `@prompt-registry/collection-scripts` dependency
3. Update npm scripts to use CLI commands
4. Configure `.npmrc` for GitHub Packages authentication

**Backward Compatibility:**
- Existing scaffolded repositories continue to work with local scripts
- New scaffolds automatically use the npm package
- Migration is opt-in for existing repositories

### Test Migration

**Moved to `lib/test/`:**
- `test/scripts/collections-lib.test.ts` → `lib/test/collections.test.ts`
- `test/scripts/validate-collections.test.ts` → `lib/test/validate.test.ts`
- `test/scripts/publish-collections.*.test.ts` → `lib/test/publish-collections.test.ts`
- Skills tests → `lib/test/skills.test.ts`
- Bundle ID tests → `lib/test/bundle-id.test.ts`
- CLI tests → `lib/test/cli.test.ts`

**Removed from Extension Tests:**
- Deleted duplicate tests that now live in `lib/test/`
- Removed `test/scripts/github-scaffold-validation.property.test.ts` (1113 lines)
- Cleaned up `test/helpers/scriptTestHelpers.ts` (no longer needed)

## Testing

### Test Coverage

- [x] Unit tests added/updated
- [x] Integration tests added/updated
- [x] Manual testing completed
- [x] All existing tests pass

### Test Results

**`lib/` Package Tests:**
```bash
cd lib && npm test
# All tests passing:
# - Collections validation
# - Skills validation and creation
# - Bundle ID generation
# - CLI argument parsing
# - Publish workflow (dry-run, git diff, zip operations)
```

**Extension Tests:**
```bash
npm run test:unit
# 2212 passing (reduced from ~3300 due to test migration)
# All remaining extension-specific tests passing
```

**CI Validation:**
```bash
.github/workflows/scripts/validate-locally.sh
# All 11 validation steps passing
```

### Manual Testing Steps

1. **Created new GitHub scaffold:**
   - Verified `.npmrc.template` is generated
   - Verified `package.json` includes `@prompt-registry/collection-scripts` dependency
   - Verified npm scripts use CLI commands

2. **Tested authentication flow:**
   - Followed GitHub CLI setup instructions
   - Verified `npm install` works with GitHub Packages
   - Tested manual token setup

3. **Tested CLI commands:**
   - `npm run validate` - validates collections
   - `npm run skill:create` - creates new skills
   - `npm run build` - builds collection bundles
   - All commands work as expected

4. **Tested VS Code extension:**
   - Scaffold command provides authentication instructions
   - Validate APM command uses npm package validation

### Tested On

- [x] Linux (primary development environment)
- [ ] macOS (CI will test)
- [ ] Windows (CI will test)

- [x] VS Code Stable

## Screenshots

N/A - This is primarily a refactoring and infrastructure change.

## Checklist

- [x] My code follows the project's style guidelines
- [x] I have performed a self-review of my code
- [x] I have commented my code, particularly in hard-to-understand areas
- [x] I have made corresponding changes to the documentation
- [x] My changes generate no new warnings or errors
- [x] I have added tests that prove my fix is effective or that my feature works
- [x] New and existing unit tests pass locally with my changes
- [x] Any dependent changes have been merged and published

## Documentation

- [x] README.md updated (`lib/README.md` created)
- [x] JSDoc comments added/updated (TypeScript types and comments)
- [x] Documentation added:
  - `docs/author-guide/collection-scripts.md`
  - `docs/contributor-guide/spec-collection-scripts-lib.md`

## Additional Notes

### Publishing the Package

The `@prompt-registry/collection-scripts` package is now published to npmjs.com (no registry configuration needed).

**To publish:**
```bash
cd lib
npm version patch  # or minor/major
npm publish
```

### Authentication Requirements

Users of scaffolded repositories can now install the package directly from npmjs.com:

```bash
npm install @prompt-registry/collection-scripts
```

No authentication or registry configuration required.

### Impact on Existing Repositories

- Existing scaffolded repositories continue to work with local scripts
- No immediate action required
- Migration to npm package is opt-in
- Benefits: automatic updates, bug fixes, consistency

### Future Improvements

- Publish package to npm registry for public access (currently GitHub Packages only)
- Add more CLI commands as needed
- Expand programmatic API based on usage patterns
- Consider extracting schema validation into separate package

## Reviewer Guidelines

Please pay special attention to:

- **Package structure**: Verify `lib/package.json` configuration is correct
- **CLI commands**: Test that all bin scripts work correctly
- **TypeScript compilation**: Ensure `lib/tsconfig.json` produces correct output
- **Test coverage**: Verify tests adequately cover the extracted functionality
- **Template updates**: Check that scaffolded repositories will work correctly
- **Authentication flow**: Verify GitHub Packages setup instructions are clear
- **Documentation**: Ensure guides are comprehensive and accurate
- **Migration path**: Confirm existing repositories can migrate smoothly

---

**By submitting this pull request, I confirm that my contribution is made under the terms of the Apache License 2.0.**

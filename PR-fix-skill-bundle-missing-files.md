## Description

Fix skill bundle creation to include all files in skill directories, not just the `SKILL.md` entry point.

When publishing collections containing skills, the bundle was only including the `SKILL.md` file while silently omitting all other files in the skill directory (assets, references, scripts).

## Type of Change

- [x] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📝 Documentation update
- [ ] ♻️ Code refactoring (no functional changes)
- [ ] ⚡ Performance improvement
- [x] 🧪 Test coverage improvement
- [ ] 🔧 Configuration/build changes

## Related Issues

Closes #XXX

## Changes Made

- Modified `resolveCollectionItemPaths()` in `templates/scaffolds/github/scripts/lib/collections.js` to detect `kind: skill` items and recursively include all files from the skill directory
- Added `listFilesRecursively()` helper function to traverse skill directories
- Added unit tests for skill directory expansion in `test/scripts/collections-lib.test.ts`
- Added integration test verifying complete skill bundles in `test/scripts/publish-collections.integration.test.ts`

## Testing

### Test Coverage

- [x] Unit tests added/updated
- [x] Integration tests added/updated
- [x] Manual testing completed
- [x] All existing tests pass

### Manual Testing Steps

1. Create a collection with a skill that has subdirectories (assets, references, scripts)
2. Run `node scripts/publish-collections.js --dry-run`
3. Verify the generated zip contains all skill directory files

### Tested On

- [ ] macOS
- [ ] Windows
- [x] Linux

- [x] VS Code Stable
- [ ] VS Code Insiders

## Screenshots

N/A - this is a build/publish workflow fix

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
- [x] JSDoc comments added/updated
- [x] No documentation changes needed

## Additional Notes

### Root Cause

The `resolveCollectionItemPaths()` function only returned the literal `path` value from each collection item. For skills with `kind: skill`, the path points to `SKILL.md`, but skills are directories containing multiple files that all need to be included in the bundle.

### Solution

When an item has `kind: 'skill'`, the function now:
1. Extracts the skill directory from the `SKILL.md` path
2. Recursively lists all files in that directory
3. Includes all files in the returned paths array

### Test Results

```
1345 passing (31s)
32 pending
```

## Reviewer Guidelines

Please pay special attention to:

- The recursive directory traversal logic in `listFilesRecursively()`
- Edge case handling when skill directory doesn't exist (falls back to just the path)
- The integration test that validates the full publish workflow with skills

---

**By submitting this pull request, I confirm that my contribution is made under the terms of the Apache License 2.0.**

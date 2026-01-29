## Description

This PR fixes a critical test infrastructure issue that was preventing the validation pipeline from passing. The unit test runner (Mocha) was incorrectly attempting to execute end-to-end tests written for Playwright, causing test failures.

**Problem:** During the rebase of the `feat/validate-collections-actions` branch onto the latest `main`, the test configuration was reverted to include the `e2e` directory in the unit test glob patterns. This caused Mocha to attempt running Playwright tests, resulting in the error:

```
Error: Playwright Test did not expect test.describe() to be called here.
```

**Solution:** Excluded the `e2e` directory from both `test:unit` and `test:coverage:unit` npm scripts in `package.json`.

## Type of Change

- [x] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📝 Documentation update
- [ ] ♻️ Code refactoring (no functional changes)
- [ ] ⚡ Performance improvement
- [ ] 🧪 Test coverage improvement
- [x] 🔧 Configuration/build changes

## Related Issues

Relates to https://github.com/AmadeusITGroup/prompt-registry/pull/96

This fix is required for the `feat/validate-collections-actions` branch to pass CI validation before it can be merged into the main repository.

## Changes Made

- Modified `package.json` line 774: Removed `e2e` from the `test:unit` script glob pattern
- Modified `package.json` line 779: Removed `e2e` from the `test:coverage:unit` script glob pattern

**Before:**
```json
"test:unit": "npx mocha --ui tdd --require ./test/mocha.setup.js --require ./test/unit.setup.js 'test-dist/test/{adapters,commands,config,e2e,helpers,scripts,services,storage,ui,unit,utils}/**/*.test.js' --timeout 5000"
```

**After:**
```json
"test:unit": "npx mocha --ui tdd --require ./test/mocha.setup.js --require ./test/unit.setup.js 'test-dist/test/{adapters,commands,config,helpers,scripts,services,storage,ui,unit,utils}/**/*.test.js' --timeout 5000"
```

## Testing

### Test Coverage

- [ ] Unit tests added/updated (not applicable - this is a test infrastructure fix)
- [ ] Integration tests added/updated (not applicable)
- [x] Manual testing completed
- [x] All existing tests pass

### Manual Testing Steps

1. Ran `.github/workflows/scripts/validate-locally.sh` before the fix → **Failed at Step 7 (Unit tests)**
2. Applied the fix to `package.json`
3. Ran `.github/workflows/scripts/validate-locally.sh` again → **All 11 validation steps passed**
4. Verified test counts:
   - ✅ 2212 unit tests passing
   - ✅ 7 integration test scenarios passing
   - ✅ VSIX package created successfully

### Tested On

- [x] Linux
- [ ] macOS
- [ ] Windows

- [x] VS Code Stable
- [ ] VS Code Insiders

## Screenshots

N/A - This is a test configuration fix with no UI changes.

## Checklist

- [x] My code follows the project's style guidelines
- [x] I have performed a self-review of my code
- [ ] I have commented my code, particularly in hard-to-understand areas (not applicable - configuration change)
- [ ] I have made corresponding changes to the documentation (not needed - internal test configuration)
- [x] My changes generate no new warnings or errors
- [ ] I have added tests that prove my fix is effective or that my feature works (not applicable - this fixes the test runner itself)
- [x] New and existing unit tests pass locally with my changes
- [x] Any dependent changes have been merged and published

## Documentation

- [ ] README.md updated
- [ ] JSDoc comments added/updated
- [x] No documentation changes needed

## Additional Notes

This is a minimal, surgical fix that addresses a test infrastructure regression introduced during the rebase. The same fix was previously applied to the main branch but was lost during the rebase of this feature branch.

**Context:** 
- E2E tests use Playwright's test framework (`test.describe()`, `test()`, etc.)
- Unit tests use Mocha's TDD interface (`suite()`, `test()`, etc.)
- These two test frameworks are incompatible and must be run separately
- E2E tests have their own dedicated test runner configuration

## Reviewer Guidelines

Please pay special attention to:

- Verification that the glob pattern correctly excludes only the `e2e` directory
- Confirmation that all 11 validation steps pass in CI
- No other test directories were accidentally excluded

---

**By submitting this pull request, I confirm that my contribution is made under the terms of the Apache License 2.0.**

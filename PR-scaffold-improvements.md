## Description

This PR significantly improves the scaffolding template for prompt collection projects by adding InnerSource documentation, a rich skill example following the Agent Skills specification, GitHub Issue/PR templates, and fixing the pre-commit hook to use npm scripts.

## Type of Change

<!-- Mark relevant items with an [x] -->

- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [x] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [x] 📝 Documentation update
- [ ] ♻️ Code refactoring (no functional changes)
- [ ] ⚡ Performance improvement
- [x] 🧪 Test coverage improvement
- [x] 🔧 Configuration/build changes

## Related Issues

<!-- Link to related issues using #issue_number -->

Closes #
Fixes #
Relates to #

## Changes Made

### InnerSource Documentation Templates
- Add `CONTRIBUTING.template.md` with contribution guidelines and process
- Add `COMMUNICATION.template.md` with communication channels and guidelines
- Add `CODE_OF_CONDUCT.template.md` with community standards and enforcement
- Add `SECURITY.template.md` with vulnerability reporting process
- Add `LICENSE` for internal use (InnerSource projects)

### Enhanced Wizard Prompts
- Add `author` field for package.json author attribution
- Add `githubOrg` for repository URLs in documentation
- Add organization details prompts (name, contacts, policy link) for LICENSE
- Update `package.template.json` to use proper license field and author variable

### Rich Skill Example (Code Review)
- Replace basic skill example with practical code-review skill following [Agent Skills specification](https://agentskills.io)
- Add `scripts/review-helper.sh` for automated code review checks
- Add `references/CHECKLIST.md` for comprehensive code review checklist
- Add `references/FEEDBACK.md` for feedback guidelines and best practices
- Add `assets/comment-templates.md` for copy-paste review comment templates

### GitHub Issue and PR Templates
- Add `bug_report.yml` issue template for structured bug reports
- Add `feature_request.yml` issue template for feature suggestions
- Add `config.yml` for issue template configuration with discussion links
- Add `pull_request_template.md` for consistent PR descriptions

### Pre-commit Hook Fix
- Fix pre-commit hook to use `npm run validate` and `npm run skill:validate`
- Remove dependency on missing local scripts (`scripts/detect-affected-collections.js`, etc.)
- Use `@prompt-registry/collection-scripts` from npm instead

### Documentation
- Add `docs/author-guide/agentic-primitives-guide.md` explaining agentic primitives

## Testing

### Test Coverage

- [x] Unit tests added/updated
- [ ] Integration tests added/updated
- [x] Manual testing completed
- [x] All existing tests pass

### New Tests Added
- Test for organization details substitution in LICENSE
- Test for author and githubOrg variable substitution
- Test for rich skill structure (scripts, references, assets directories)
- Test for GitHub Issue and PR templates creation

### Manual Testing Steps

1. Run `npm run test:one -- test/commands/ScaffoldCommand.test.ts` - 39 tests passing
2. Run `npm run compile` - successful compilation
3. Run scaffolding wizard and verify all new files are created with proper variable substitution

### Tested On

- [ ] macOS
- [ ] Windows
- [x] Linux

- [x] VS Code Stable
- [ ] VS Code Insiders

## Screenshots

<!-- If applicable, add screenshots to help explain your changes -->

N/A - Template changes

## Checklist

<!-- Mark completed items with an [x] -->

- [x] My code follows the project's style guidelines
- [x] I have performed a self-review of my code
- [x] I have commented my code, particularly in hard-to-understand areas
- [x] I have made corresponding changes to the documentation
- [x] My changes generate no new warnings or errors
- [x] I have added tests that prove my fix is effective or that my feature works
- [x] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published

## Documentation

<!-- Describe any documentation changes needed -->

- [x] README.md updated (README.template.md for scaffolded projects)
- [ ] JSDoc comments added/updated
- [x] No documentation changes needed

## Additional Notes

### Files Changed Summary

| Category | Files |
|----------|-------|
| Source | `ScaffoldCommand.ts`, `TemplateEngine.ts` |
| Templates | 15 new/modified template files |
| Tests | `ScaffoldCommand.test.ts` |
| Docs | `agentic-primitives-guide.md` |

### Template Variables

New variables added to the scaffolding wizard:
- `author` - Author name for package.json
- `githubOrg` - GitHub organization/username for repository URLs
- `organizationName` - Organization name for LICENSE
- `internalContact` - Internal contact email for security/support
- `legalContact` - Legal contact email for licensing questions
- `organizationPolicyLink` - Link to organization policies

## Reviewer Guidelines

<!-- For reviewers: What should they focus on? -->

Please pay special attention to:

- Template variable substitution logic in `ScaffoldCommand.ts` and `TemplateEngine.ts`
- The pre-commit hook fix - ensure it works with the npm scripts approach
- The rich skill example content - verify it follows Agent Skills specification correctly

---

**By submitting this pull request, I confirm that my contribution is made under the terms of the Apache License 2.0.**

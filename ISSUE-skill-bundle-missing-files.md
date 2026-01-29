# [Bug]: Skills bundle only includes SKILL.md entry point, omits all other skill files

## Description

When publishing a collection that includes skills, the generated bundle zip file only contains the `SKILL.md` entry point file for each skill. All other files in the skill directory (assets, references, scripts) are silently omitted from the bundle.

## Steps to Reproduce

1. Create a collection with a skill item that has a directory structure like:
   ```
   skills/my-skill/
   ├── SKILL.md
   ├── assets/
   │   └── diagram.png
   ├── references/
   │   └── doc.md
   └── scripts/
       └── helper.js
   ```

2. Reference the skill in a collection YAML:
   ```yaml
   items:
     - path: skills/my-skill/SKILL.md
       kind: skill
   ```

3. Run the publish workflow (push to main or trigger workflow_dispatch)

4. Download and extract the release bundle zip

## Expected Behavior

The bundle should include the entire skill directory contents:
```
skills/my-skill/SKILL.md
skills/my-skill/assets/diagram.png
skills/my-skill/references/doc.md
skills/my-skill/scripts/helper.js
```

## Actual Behavior

The bundle only includes the entry point file:
```
skills/my-skill/SKILL.md
```

All other files (assets, references, scripts) are silently omitted.

## Error Logs

No error logs - the files are silently omitted without any warning.

Example from a real workflow run showing the incomplete bundle:
```
./deployment-manifest.yml
./prompts/assess-opensource-readiness.prompt.md
./prompts/assess-innersource-readiness.prompt.md
./prompts/triage-pull-requests.prompt.md
./prompts/triage-issues.prompt.md
./skills/github-prs-triage/SKILL.md          # Only SKILL.md included
./skills/innersource-readiness/SKILL.md      # Missing: assets/, references/, scripts/
./skills/github-issues-triage/SKILL.md
./skills/open-source-readiness/SKILL.md
```

## Operating System

Linux (Ubuntu)

## VS Code Version

N/A - this is a GitHub Actions workflow issue

## Extension Version

N/A - affects scaffolded publish workflow

## Registry Source Type

GitHub

## Additional Context

- **Affected repository**: https://github.com/Amadeus-xDLC/ospo.skills-collection
- **Workflow run**: https://github.com/Amadeus-xDLC/ospo.skills-collection/actions/runs/21000592012
- **Root cause**: The `resolveCollectionItemPaths()` function in `templates/scaffolds/github/scripts/lib/collections.js` only returns the literal `path` value from each item, without expanding skill directories.

### Technical Details

The bug is in `resolveCollectionItemPaths()`:
```javascript
// Current (buggy) implementation
function resolveCollectionItemPaths(repoRoot, collection) {
  const items = Array.isArray(collection.items) ? collection.items : [];
  return items
    .map(i => i && i.path)
    .filter(Boolean)
    .map(p => normalizeRepoRelativePath(p));
}
```

For skills, the `path` points to `SKILL.md` but the entire directory should be included in the bundle.

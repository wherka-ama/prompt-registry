/**
 * ESLint rule to enforce the domain-layer invariant (Phase 3 / Iter 2).
 *
 * Spec §14.2 invariant #1: "Domain layer separation. `bundle`,
 * `primitive`, `hub` types live in `lib/src/domain/`. Feature layers
 * (indexing/search, validation, publishing, install, runtime
 * translation) depend on domain — never the reverse."
 *
 * This rule fails any file under `lib/src/domain/**` that imports from
 * a feature-layer location. Feature locations are detected by their
 * directory name; the list is intentionally explicit (allowlist by
 * exclusion) so adding new feature directories doesn't accidentally
 * relax the invariant.
 *
 * Allowed imports inside `lib/src/domain/`:
 *   - Other modules within `lib/src/domain/` (relative paths that
 *     stay inside the directory)
 *   - Node built-ins (`node:*`)
 *   - npm packages (no `./` or `../` prefix)
 *
 * Forbidden imports inside `lib/src/domain/`:
 *   - Anything that escapes `lib/src/domain/` via `../` and lands in a
 *     known feature directory (`primitive-index/`, `cli/`, `hub/`,
 *     `core/`, `registry/`, `octostream/`, etc.)
 *
 * The rule operates on the *resolved relative path* of the import
 * source. We do not need a TypeScript path resolver here because the
 * codebase uses relative imports consistently (no `paths` aliases at
 * the domain boundary).
 */

const FEATURE_LAYER_DIRECTORIES = new Set([
  // Top-level feature directories under lib/src/. Any import that
  // resolves into one of these from inside lib/src/domain/ is a
  // violation of invariant #1.
  'primitive-index',
  'cli',
  'hub',
  'core',
  'registry',
  'octostream'
]);

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid feature-layer imports inside lib/src/domain/ (spec §14.2 invariant #1)',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      noFeatureImport:
        'Domain layer (lib/src/domain/) must not import from feature layer "{{feature}}". ' +
        'Feature layers depend on domain — never the reverse. See spec §14.2 invariant #1.'
    },
    schema: []
  },
  create(context) {
    const filename = context.filename;
    if (!filename.includes('/lib/src/domain/')) {
      return {};
    }
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        // npm package or node built-in — always allowed.
        if (!source.startsWith('.')) {
          return;
        }
        // Relative path. Detect which top-level lib/src/* directory
        // it resolves into by walking the segments.
        const segments = source.split('/').filter((s) => s !== '' && s !== '.');
        // For each `..` we step out one directory; for each non-`..`
        // segment we step in. We track only the segments that fall
        // *outside* the domain directory.
        let dotDots = 0;
        const tail = [];
        for (const seg of segments) {
          if (seg === '..') {
            dotDots += 1;
            if (tail.length > 0) {
              tail.pop();
            }
          } else {
            tail.push(seg);
          }
        }
        // We only care when we've escaped the domain directory.
        // lib/src/domain/<sub>/... → 1 `..` keeps us in domain;
        // 2+ `..`s land in lib/src/<other>/...
        if (dotDots < 2) {
          return;
        }
        const featureDir = tail[0];
        if (featureDir !== undefined && FEATURE_LAYER_DIRECTORIES.has(featureDir)) {
          context.report({
            node,
            messageId: 'noFeatureImport',
            data: { feature: featureDir }
          });
        }
      }
    };
  }
};

export default {
  rules: {
    'no-feature-imports-in-domain': rule
  }
};

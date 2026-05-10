/**
 * Phase 3 / Iter 4 — Layering verification.
 *
 * Iter 2 added an ESLint rule that fails any *static* import from a
 * feature-layer directory inside `lib/src/domain/**`. Iter 4 adds a
 * runtime regression check that scans the domain source files and
 * fails if any one of them contains a forbidden import path. This is
 * defense-in-depth: the ESLint rule catches violations during
 * development, and this test catches them during CI even if the
 * lint step is bypassed (e.g., `--no-verify` push or a misconfigured
 * runner).
 *
 * The check is intentionally a textual scan rather than a parsed
 * import graph: cheap, deterministic, and free of TS-program setup.
 * It is gated on string patterns that match the path forms used in
 * the codebase: `from '../primitive-index/...'`, `from '../cli/...'`,
 * `from '../hub/...'`, etc.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Tests run under `lib/dist-test/test/domain/`; resolve up to `lib/`
// then back down into the *source* tree at `lib/src/domain/` so the
// scan reads .ts files (not the compiled .js artifacts).
const DOMAIN_DIR = path.resolve(__dirname, '..', '..', '..', 'src', 'domain');

const FEATURE_PREFIXES = [
  '../primitive-index/',
  '../cli/',
  '../hub/',
  '../core/',
  '../registry/',
  '../octostream/'
];

describe('Phase 3 / Iter 4 — domain layering verification', () => {
  it('no file under lib/src/domain/ imports from a feature-layer directory', async () => {
    const tsFiles = await collectTsFiles(DOMAIN_DIR);
    assert.ok(tsFiles.length > 0, `expected at least one .ts file under ${DOMAIN_DIR}`);
    const offenders: { file: string; importPath: string }[] = [];
    for (const file of tsFiles) {
      const text = await fs.readFile(file, 'utf8');
      // Match both `... from '...'` and side-effect `import '...'` forms.
      // The `from` keyword precedes most imports/re-exports, but
      // `import 'x';` (side-effect) doesn't have `from`.
      const importRe = /(?:\bfrom\s+|\bimport\s+)['"]([^'"]+)['"]/g;
      let m;
      while ((m = importRe.exec(text)) !== null) {
        const spec = m[1];
        if (FEATURE_PREFIXES.some((p) => spec.startsWith(p) || spec === p.replace(/\/$/, ''))) {
          offenders.push({ file: path.relative(DOMAIN_DIR, file), importPath: spec });
        }
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      `domain layer must not import from feature layers; offenders:\n${
        offenders.map((o) => `  ${o.file} → ${o.importPath}`).join('\n')
      }`
    );
  });

  it('every domain source file is reachable from the barrel (no orphan modules)', async () => {
    // The barrel `lib/src/domain/index.ts` must transitively reach every
    // type-bearing module under `lib/src/domain/**`. An orphan module
    // (e.g., a file that exists but is not re-exported) is dead code or
    // a forgotten wiring — both worth catching.
    const tsFiles = await collectTsFiles(DOMAIN_DIR);
    const reachable = new Set<string>();
    await walkExports(path.join(DOMAIN_DIR, 'index.ts'), reachable);
    const orphans = tsFiles
      .filter((f) => !reachable.has(path.resolve(f)))
      .map((f) => path.relative(DOMAIN_DIR, f));
    assert.deepStrictEqual(
      orphans,
      [],
      `every domain source file must be reachable from the barrel; orphans:\n  ${orphans.join('\n  ')}`
    );
  });
});

const collectTsFiles = async (dir: string): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await collectTsFiles(full)));
    } else if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
};

const walkExports = async (entry: string, visited: Set<string>): Promise<void> => {
  const resolved = path.resolve(entry);
  if (visited.has(resolved)) {
    return;
  }
  visited.add(resolved);
  let text: string;
  try {
    text = await fs.readFile(resolved, 'utf8');
  } catch {
    return;
  }
  const re = /\b(?:export|import)(?:\s+\*\s+as\s+\w+\s+|\s+(?:type\s+)?\{[^}]*\}\s+|\s+(?:type\s+)?\w+\s+)?from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const spec = m[1];
    if (!spec.startsWith('.')) {
      continue;
    }
    const candidate = path.resolve(path.dirname(resolved), spec);
    const next = await resolveTsModule(candidate);
    if (next !== undefined) {
      await walkExports(next, visited);
    }
  }
};

const resolveTsModule = async (candidate: string): Promise<string | undefined> => {
  // Try: candidate.ts, candidate/index.ts, candidate (already a file).
  const tries = [`${candidate}.ts`, path.join(candidate, 'index.ts'), candidate];
  for (const t of tries) {
    try {
      const stat = await fs.stat(t);
      if (stat.isFile()) {
        return t;
      }
    } catch { /* try next */ }
  }
  return undefined;
};

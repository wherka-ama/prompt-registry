import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  describe,
  expect,
  it,
} from 'vitest';

const DOMAIN_DIR = path.resolve(__dirname, '..', 'src', 'domain');

const FEATURE_PREFIXES = [
  '../primitive-index/',
  '../cli/',
  '../hub/',
  '../core/',
  '../registry/',
  '../octostream/'
];

describe('domain layering verification', () => {
  it('no file under lib/src/domain/ imports from a feature-layer directory', async () => {
    const tsFiles = await collectTsFiles(DOMAIN_DIR);
    expect(tsFiles.length).toBeGreaterThan(0);
    const offenders: { file: string; importPath: string }[] = [];
    for (const file of tsFiles) {
      const text = await fs.readFile(file, 'utf8');
      const importRe = /(?:\bfrom\s+|\bimport\s+)['"]([^'"]+)['"]/g;
      let m;
      while ((m = importRe.exec(text)) !== null) {
        const spec = m[1];
        if (FEATURE_PREFIXES.some((p) => spec.startsWith(p) || spec === p.replace(/\/$/, ''))) {
          offenders.push({ file: path.relative(DOMAIN_DIR, file), importPath: spec });
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('every domain source file is reachable from the barrel (no orphan modules)', async () => {
    const tsFiles = await collectTsFiles(DOMAIN_DIR);
    const reachable = new Set<string>();
    await walkExports(path.join(DOMAIN_DIR, 'index.ts'), reachable);
    const orphans = tsFiles
      .filter((f) => !reachable.has(path.resolve(f)))
      .map((f) => path.relative(DOMAIN_DIR, f));
    expect(orphans).toStrictEqual([]);
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

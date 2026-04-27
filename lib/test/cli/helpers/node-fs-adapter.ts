/**
 * Phase 4 helper — `createNodeFsAdapter()`.
 *
 * Many Phase 4 command tests need an `FsAbstraction` that proxies to
 * the real node:fs/promises against a temp directory. This helper
 * factors that bridge out of every `*.test.ts`. It is only used in
 * tests; the production Context wires `node:fs` via
 * `lib/src/cli/framework/production-context.ts`.
 */
import * as fs from 'node:fs/promises';
import type {
  FsAbstraction,
} from '../../../src/cli/framework';

/**
 * Build an FsAbstraction backed by node:fs/promises. Suitable for
 * tests that operate against a tmpdir created with `fs.mkdtemp`.
 * @returns FsAbstraction proxying to node:fs/promises.
 */
export const createNodeFsAdapter = (): FsAbstraction => ({
  readFile: (p) => fs.readFile(p, 'utf8'),
  writeFile: (p, c) => fs.writeFile(p, c, 'utf8'),
  readJson: async <T = unknown>(p: string): Promise<T> =>
    JSON.parse(await fs.readFile(p, 'utf8')) as T,
  writeJson: (p, v) => fs.writeFile(p, JSON.stringify(v, null, 2), 'utf8'),
  exists: async (p) => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  },
  mkdir: async (p) => {
    await fs.mkdir(p, { recursive: true });
  },
  readDir: (p) => fs.readdir(p),
  remove: async (p) => {
    await fs.rm(p, { recursive: true, force: true });
  }
});

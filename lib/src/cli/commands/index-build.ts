/**
 * `prompt-registry index build` — build a primitive index from a
 * local folder of bundles.
 *
 * Wraps `LocalFolderBundleProvider` + `PrimitiveIndex.buildFrom` and
 * persists via `saveIndex`. Output goes through `formatOutput` so
 * callers get a stable JSON envelope on `-o json`.
 * @module cli/commands/index-build
 */
import * as path from 'node:path';
import {
  PrimitiveIndex,
} from '../../primitive-index/index';
import {
  LocalFolderBundleProvider,
} from '../../primitive-index/providers/local-folder';
import {
  saveIndex,
} from '../../primitive-index/store';
import type {
  IndexStats,
} from '../../primitive-index/types';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

export interface IndexBuildOptions {
  output?: OutputFormat;
  /** Root folder containing bundle subdirectories. Required. */
  root: string;
  /** Output path. Defaults to `<root>/primitive-index.json`. */
  outFile?: string;
  /** Source id label. Defaults to the basename of `root`. */
  sourceId?: string;
}

interface BuildResult {
  outFile: string;
  stats: IndexStats;
}

/**
 * Build the `index build` command.
 * @param opts CLI options.
 * @returns CommandDefinition.
 */
export const createIndexBuildCommand = (
  opts: IndexBuildOptions
): CommandDefinition =>
  defineCommand({
    path: ['index', 'build'],
    description: 'Build a primitive index from a local folder of bundles.',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      if (opts.root.length === 0) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'index build: --root <DIR> is required'
        }));
      }
      try {
        const outFile = opts.outFile ?? path.join(opts.root, 'primitive-index.json');
        const provider = new LocalFolderBundleProvider({
          root: opts.root,
          sourceId: opts.sourceId
        });
        const idx = await PrimitiveIndex.buildFrom(provider, {
          hubId: opts.sourceId
        });
        saveIndex(idx, outFile);
        const stats = idx.stats();
        const data: BuildResult = { outFile, stats };
        formatOutput({
          ctx,
          command: 'index.build',
          output: fmt,
          status: 'ok',
          data,
          textRenderer: (d) =>
            `built ${String(d.stats.primitives)} primitives `
            + `from ${String(d.stats.bundles)} bundles → ${d.outFile}\n`
        });
        return 0;
      } catch (cause) {
        const err = new RegistryError({
          code: 'INDEX.BUILD_FAILED',
          message: `index build failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause: cause instanceof Error ? cause : undefined
        });
        return failWith(ctx, fmt, err);
      }
    }
  });

const failWith = (ctx: Context, output: OutputFormat, err: RegistryError): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command: 'index.build',
      output,
      status: 'error',
      data: null,
      errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
  return 1;
};

// Re-export for symmetry with other commands' default-path helpers.

export { defaultIndexFile } from '../../primitive-index/default-paths';

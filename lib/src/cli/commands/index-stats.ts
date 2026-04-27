/**
 * `prompt-registry index stats` — summary stats for a primitive index.
 *
 * Replaces the legacy `primitive-index stats` verb with a framework
 * command. Output goes through `formatOutput` so `-o json|yaml|ndjson`
 * all produce the canonical envelope.
 * @module cli/commands/index-stats
 */
import {
  defaultIndexFile,
} from '../../primitive-index/default-paths';
import {
  loadIndex,
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

export interface IndexStatsOptions {
  output?: OutputFormat;
  /** Path to the index JSON. Defaults to `<XDG cache>/primitive-index.json`. */
  indexFile?: string;
}

/**
 * Build the `index stats` command.
 * @param opts CLI options.
 * @returns CommandDefinition.
 */
export const createIndexStatsCommand = (
  opts: IndexStatsOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['index', 'stats'],
    description: 'Show summary statistics for a primitive index.',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      const indexPath = opts.indexFile ?? defaultIndexFile(ctx.env);
      try {
        const idx = loadIndex(indexPath);
        const stats = idx.stats();
        formatOutput({
          ctx,
          command: 'index.stats',
          output: fmt,
          status: 'ok',
          data: stats,
          textRenderer: (s) => renderStatsText(s)
        });
        return 0;
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        const err = /ENOENT|no such file/i.test(msg)
          ? new RegistryError({
            code: 'INDEX.NOT_FOUND',
            message: `index not found: ${indexPath}`,
            hint: 'Run `prompt-registry index build` or `prompt-registry index harvest` first.',
            cause: cause instanceof Error ? cause : undefined
          })
          : new RegistryError({
            code: 'INDEX.LOAD_FAILED',
            message: `failed to load index ${indexPath}: ${msg}`,
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
      command: 'index.stats',
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

const renderStatsText = (s: IndexStats): string =>
  [
    `primitives: ${String(s.primitives)}`,
    `bundles: ${String(s.bundles)}`,
    `shortlists: ${String(s.shortlists)}`,
    `byKind: ${JSON.stringify(s.byKind)}`,
    `bySource: ${JSON.stringify(s.bySource)}`,
    `builtAt: ${s.builtAt}`
  ].join('\n') + '\n';

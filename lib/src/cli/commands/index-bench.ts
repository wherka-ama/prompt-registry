/**
 * `prompt-registry index bench` — search microbenchmark.
 *
 * Replaces the legacy `primitive-index bench` verb. Loads a gold-set
 * JSON file (same shape as `index eval`) and runs each query N times
 * against the loaded index, reporting per-query median/p95/max plus
 * aggregate QPS.
 * @module cli/commands/index-bench
 */
// eslint-disable-next-line local/no-framework-imports -- bounded sync read of the gold-set file; refactoring loadIndex+gold to async ctx.fs is tracked separately.
import * as fs from 'node:fs';
import {
  type BenchCase,
  renderBenchReportMarkdown,
  runBench,
} from '../../primitive-index/bench';
import {
  defaultIndexFile,
} from '../../primitive-index/default-paths';
import {
  loadIndex,
} from '../../primitive-index/store';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

export interface IndexBenchOptions {
  output?: OutputFormat;
  /** Path to the index JSON. */
  indexFile?: string;
  /** Path to the gold-set JSON. Required. */
  goldFile: string;
  /** Iterations per case. Default 50. */
  iterations?: number;
}

/**
 * Build the `index bench` command.
 * @param opts CLI options.
 * @returns CommandDefinition.
 */
export const createIndexBenchCommand = (
  opts: IndexBenchOptions
): CommandDefinition =>
  defineCommand({
    path: ['index', 'bench'],
    description: 'Run a search microbenchmark over a gold-set against an index.',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      if (opts.goldFile.length === 0) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'index bench: --gold <FILE> is required'
        }));
      }
      const indexPath = opts.indexFile ?? defaultIndexFile(ctx.env);
      const iterations = opts.iterations ?? 50;
      try {
        const idx = loadIndex(indexPath);
        const raw = fs.readFileSync(opts.goldFile, 'utf8');
        const parsed = JSON.parse(raw) as { cases: { id: string; query: BenchCase['query'] }[] };
        const cases: BenchCase[] = parsed.cases.map((c) => ({ id: c.id, query: c.query }));
        const report = runBench(idx, cases, iterations);
        formatOutput({
          ctx, command: 'index.bench', output: fmt, status: 'ok',
          data: report,
          textRenderer: (r) => renderBenchReportMarkdown(r)
        });
        return 0;
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        const err = /ENOENT|no such file/i.test(msg)
          ? new RegistryError({
            code: 'INDEX.NOT_FOUND',
            message: `index bench: missing file (${msg})`,
            cause: cause instanceof Error ? cause : undefined
          })
          : new RegistryError({
            code: 'INDEX.BENCH_FAILED',
            message: `index bench failed: ${msg}`,
            cause: cause instanceof Error ? cause : undefined
          });
        return failWith(ctx, fmt, err);
      }
    }
  });

const failWith = (ctx: Context, output: OutputFormat, err: RegistryError): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx, command: 'index.bench', output, status: 'error',
      data: null, errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
  return 1;
};

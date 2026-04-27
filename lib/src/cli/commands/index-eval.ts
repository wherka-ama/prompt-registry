/**
 * `prompt-registry index eval` — pattern-based relevance eval.
 *
 * Replaces the legacy `primitive-index eval-pattern` verb. Loads a
 * gold-set JSON file with `cases[]: PatternCase` and runs every
 * query against the index, reporting must-match satisfaction per
 * case + aggregated pass-rate. Exits non-zero when any case fails
 * so CI can gate ranking quality.
 * @module cli/commands/index-eval
 */
// eslint-disable-next-line local/no-framework-imports -- bounded sync read of the gold-set file; refactoring loadIndex+gold to async ctx.fs is tracked separately.
import * as fs from 'node:fs';
import {
  defaultIndexFile,
} from '../../primitive-index/default-paths';
import {
  type PatternCase,
  type PatternReport,
  renderPatternReportMarkdown,
  runPatternEval,
} from '../../primitive-index/eval-pattern';
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

export interface IndexEvalOptions {
  output?: OutputFormat;
  /** Path to the index JSON. */
  indexFile?: string;
  /** Path to the gold-set JSON file. Required. */
  goldFile: string;
}

/**
 * Build the `index eval` command.
 * @param opts CLI options.
 * @returns CommandDefinition.
 */
export const createIndexEvalCommand = (
  opts: IndexEvalOptions
): CommandDefinition =>
  defineCommand({
    path: ['index', 'eval'],
    description: 'Run pattern-based relevance eval against an index.',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      if (opts.goldFile.length === 0) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'index eval: --gold <FILE> is required'
        }));
      }
      const indexPath = opts.indexFile ?? defaultIndexFile(ctx.env);
      let report: PatternReport;
      try {
        const idx = loadIndex(indexPath);
        const raw = fs.readFileSync(opts.goldFile, 'utf8');
        const parsed = JSON.parse(raw) as { cases: PatternCase[] };
        report = runPatternEval(idx, parsed.cases);
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        const err = /ENOENT|no such file/i.test(msg)
          ? new RegistryError({
            code: 'INDEX.NOT_FOUND',
            message: `index eval: missing file (${msg})`,
            cause: cause instanceof Error ? cause : undefined
          })
          : new RegistryError({
            code: 'INDEX.EVAL_FAILED',
            message: `index eval failed: ${msg}`,
            cause: cause instanceof Error ? cause : undefined
          });
        return failWith(ctx, fmt, err);
      }
      formatOutput({
        ctx, command: 'index.eval', output: fmt, status: 'ok',
        data: report,
        textRenderer: (r) => renderPatternReportMarkdown(r)
      });
      // Non-zero exit when any case failed so CI treats it as a fail.
      return report.aggregate.failed > 0 ? 1 : 0;
    }
  });

const failWith = (ctx: Context, output: OutputFormat, err: RegistryError): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx, command: 'index.eval', output, status: 'error',
      data: null, errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
  return 1;
};

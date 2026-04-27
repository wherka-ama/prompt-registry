/**
 * `prompt-registry index harvest` — fetch hub-config + walk every
 * source + write a primitive index.
 *
 * Replaces the legacy `primitive-index hub-harvest` verb. Heavy
 * lifting lives in `harvestHub` (`lib/src/primitive-index/hub-harvest-pipeline.ts`);
 * this command only adapts options + emits the canonical envelope.
 * @module cli/commands/index-harvest
 */
import {
  harvestHub as defaultHarvestHub,
  type HubHarvestPipelineOptions,
  type HubHarvestPipelineResult,
} from '../../primitive-index/hub-harvest-pipeline';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

/** Pipeline runner type — matches `harvestHub` from the pipeline module. */
export type HarvestRunner = (
  opts: HubHarvestPipelineOptions,
  env: NodeJS.ProcessEnv
) => Promise<HubHarvestPipelineResult>;

export interface IndexHarvestOptions {
  output?: OutputFormat;
  hubRepo?: string;
  hubBranch?: string;
  hubConfigFile?: string;
  noHubConfig?: boolean;
  cacheDir?: string;
  progressFile?: string;
  outFile?: string;
  concurrency?: number;
  /** Env-var name to read the GitHub token from (e.g. `GH_TOKEN`). */
  tokenEnv?: string;
  sourcesInclude?: string[];
  sourcesExclude?: string[];
  extraSources?: string[];
  force?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  /** Test seam: override the pipeline runner. */
  runPipeline?: HarvestRunner;
}

/**
 * Build the `index harvest` command.
 * @param opts CLI options.
 * @returns CommandDefinition.
 */
export const createIndexHarvestCommand = (
  opts: IndexHarvestOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['index', 'harvest'],
    description: 'Fetch hub-config, walk every source, and write a primitive index.',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      const noHubConfig = opts.noHubConfig === true;
      const hubConfigFile = opts.hubConfigFile;
      if (!noHubConfig && hubConfigFile === undefined
        && (opts.hubRepo === undefined || opts.hubRepo.length === 0)) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'index harvest: --hub-repo <OWNER/REPO> is required (or use --no-hub-config / --hub-config-file)'
        }));
      }
      const explicitToken = opts.tokenEnv === undefined
        ? undefined
        : ctx.env[opts.tokenEnv];
      const pipelineOpts: HubHarvestPipelineOptions = {
        hubRepo: opts.hubRepo,
        hubBranch: opts.hubBranch,
        hubConfigFile: opts.hubConfigFile,
        noHubConfig: opts.noHubConfig,
        cacheDir: opts.cacheDir,
        progressFile: opts.progressFile,
        outFile: opts.outFile,
        concurrency: opts.concurrency,
        explicitToken,
        sourcesInclude: opts.sourcesInclude,
        sourcesExclude: opts.sourcesExclude,
        extraSources: opts.extraSources,
        force: opts.force,
        dryRun: opts.dryRun,
        onEvent: opts.verbose === true
          ? (ev): void => {
            ctx.stderr.write(`[${ev.kind}] ${JSON.stringify(ev)}\n`);
          }
          : undefined,
        onLog: (msg): void => {
          ctx.stderr.write(`[index harvest] ${msg}\n`);
        }
      };
      const runner = opts.runPipeline ?? defaultHarvestHub;
      let result: HubHarvestPipelineResult;
      try {
        result = await runner(pipelineOpts, ctx.env as NodeJS.ProcessEnv);
      } catch (cause) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'INDEX.HARVEST_FAILED',
          message: `index harvest failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause: cause instanceof Error ? cause : undefined
        }));
      }
      formatOutput({
        ctx, command: 'index.harvest', output: fmt, status: 'ok',
        data: result,
        textRenderer: (r) =>
          `done=${String(r.totals.done)} `
          + `error=${String(r.totals.error)} `
          + `skip=${String(r.totals.skip)} `
          + `primitives=${String(r.totals.primitives)} `
          + `wallMs=${String(r.totals.wallMs)} `
          + `totalMs=${String(r.totals.totalMs)}\n`
      });
      return result.totals.error > 0 ? 1 : 0;
    }
  });

const failWith = (ctx: Context, output: OutputFormat, err: RegistryError): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx, command: 'index.harvest', output, status: 'error',
      data: null, errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
  return 1;
};

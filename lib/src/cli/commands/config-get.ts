/**
 * Phase 4 / Iter 22 — `config get` subcommand.
 *
 * Reads a value from the layered YAML config (8-layer precedence
 * chain — see Phase 2 / Iter 4's `loadConfig`). The dotted key path
 * (e.g., `output.json.indent`) drills into the resolved object.
 *
 * Iter-22 scope is intentionally minimal: load config + read key.
 * `config set` / `config list` (iters 23-24) follow the same shape.
 */
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  loadConfig,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

export interface ConfigGetOptions {
  /** Output format. Default 'text'. */
  output?: OutputFormat;
  /** Dotted key path (e.g., 'output.json.indent'). Required. */
  key: string;
}

/**
 * Build the `config get` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createConfigGetCommand = (
  opts: ConfigGetOptions
): CommandDefinition =>
  defineCommand({
    path: ['config', 'get'],
    description: 'Read a config value by dotted key path (e.g., `output.json.indent`).',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      if (opts.key.length === 0) {
        const err = new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'config get: missing key',
          hint: 'Usage: `prompt-registry config get <dotted.key>`'
        });
        emitError(ctx, opts.output ?? 'text', err);
        return 1;
      }
      try {
        const config = await loadConfig({
          cwd: ctx.cwd(),
          env: ctx.env,
          fs: ctx.fs
        });
        const value = readDottedKey(config, opts.key);
        formatOutput({
          ctx,
          command: 'config.get',
          output: opts.output ?? 'text',
          status: 'ok',
          data: { key: opts.key, value },
          textRenderer: (d) =>
            d.value === undefined
              ? `${d.key}: (unset)\n`
              : `${d.key}: ${typeof d.value === 'string' ? d.value : JSON.stringify(d.value)}\n`
        });
        return 0;
      } catch (err) {
        const re = err instanceof RegistryError
          ? err
          : new RegistryError({
            code: 'CONFIG.LOAD_FAILED',
            message: err instanceof Error ? err.message : String(err),
            cause: err
          });
        emitError(ctx, opts.output ?? 'text', re);
        return 1;
      }
    }
  });

const readDottedKey = (obj: unknown, key: string): unknown => {
  const parts = key.split('.');
  let cursor: unknown = obj;
  for (const p of parts) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[p];
  }
  return cursor;
};

const emitError = (ctx: Context, output: OutputFormat, err: RegistryError): void => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command: 'config.get',
      output,
      status: 'error',
      data: null,
      errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
};

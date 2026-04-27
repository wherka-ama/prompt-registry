/**
 * Phase 4 / Iter 23 — `config list` subcommand.
 *
 * Dumps the resolved config (after the 8-layer merge) as text or
 * the JSON envelope. Useful for debugging precedence: a user can
 * `prompt-registry config list -o yaml` and see exactly what the
 * commands see.
 */
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  loadConfig,
  type OutputFormat,
} from '../framework';

export interface ConfigListOptions {
  output?: OutputFormat;
}

/**
 * Build the `config list` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createConfigListCommand = (
  opts: ConfigListOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['config', 'list'],
    description: 'Print the resolved config (post-merge across all 8 precedence layers).',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const config = await loadConfig({
        cwd: ctx.cwd(),
        env: ctx.env,
        fs: ctx.fs
      });
      formatOutput({
        ctx,
        command: 'config.list',
        output: opts.output ?? 'yaml',
        status: 'ok',
        data: config,
        textRenderer: (d) => `${JSON.stringify(d, null, 2)}\n`
      });
      return 0;
    }
  });

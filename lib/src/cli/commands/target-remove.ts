/**
 * Phase 4 / Iter 30 → Phase 5 / Iter 4 — `target remove`.
 *
 * Iter-4 wires the persist side: validates the positional name,
 * delegates to `removeTargetByName()`, and surfaces a not-found
 * error code distinct from the USAGE.MISSING_FLAG code used for
 * an empty name.
 */
import {
  removeTargetByName,
} from '../../install/target-store';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

export interface TargetRemoveOptions {
  output?: OutputFormat;
  /** Target name (required). */
  name: string;
}

/**
 * Build the `target remove` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createTargetRemoveCommand = (
  opts: TargetRemoveOptions
): CommandDefinition =>
  defineCommand({
    path: ['target', 'remove'],
    description: 'Remove a configured install target from the project config (`prompt-registry.yml`).',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      if (opts.name.length === 0) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'target remove: missing target name',
          hint: 'Usage: `prompt-registry target remove <name>`'
        }));
      }
      try {
        const result = await removeTargetByName(
          { cwd: ctx.cwd(), fs: ctx.fs },
          opts.name
        );
        formatOutput({
          ctx,
          command: 'target.remove',
          output: fmt,
          status: 'ok',
          data: { name: opts.name, file: result.file },
          textRenderer: (d) => `Removed target "${d.name}" from ${d.file}.\n`
        });
        return 0;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const isMissing = message.includes('not found');
        return failWith(ctx, fmt, new RegistryError({
          code: isMissing ? 'USAGE.MISSING_FLAG' : 'INTERNAL.UNEXPECTED',
          message: `target remove: ${message}`,
          hint: isMissing
            ? 'Run `prompt-registry target list` to see configured targets.'
            : 'See `prompt-registry doctor` for environment diagnostics.',
          context: { name: opts.name },
          cause: cause instanceof Error ? cause : undefined
        }));
      }
    }
  });

const failWith = (ctx: Context, output: OutputFormat, err: RegistryError): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command: 'target.remove',
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

/**
 * RegistryError + renderError + failWith.
 *
 * `RegistryError`, `isRegistryError`, and related types are defined in
 * `../../domain/errors` and re-exported here for backward compatibility.
 * Only `renderError` and `failWith` live here, because they depend on
 * `Context` and `formatOutput` (CLI concepts) for stderr and structured output.
 */
import {
  isRegistryError,
  RegistryError,
} from '../../domain/errors';
import type {
  Context,
} from './context';
import {
  formatOutput,
} from './output';
import type {
  OutputFormat,
} from './output';

export type {
  RegistryErrorNamespace,
  RegistryErrorOptions,
} from '../../domain/errors';

export {
  isRegistryError,
  RegistryError,
} from '../../domain/errors';

/**
 * Render an error to `ctx.stderr` for human consumption. The output
 * shape is:
 *
 *   error[CODE]: <message>
 *     hint: <hint>
 *     docs: <docsUrl>
 *
 * where the hint and docs lines are omitted when absent.
 *
 * Non-RegistryError values are wrapped as `INTERNAL.UNEXPECTED` so the
 * renderer is total — callers do not need to type-narrow before
 * delegating to it.
 * @param err Anything thrown — RegistryError or otherwise.
 * @param ctx Context whose stderr will receive the rendering.
 */
export const renderError = (err: unknown, ctx: Context): void => {
  const re = isRegistryError(err) ? err : asInternalError(err);
  const lines: string[] = [`error[${re.code}]: ${re.message}`];
  if (re.hint !== undefined) {
    lines.push(`  hint: ${re.hint}`);
  }
  if (re.docsUrl !== undefined) {
    lines.push(`  docs: ${re.docsUrl}`);
  }
  ctx.stderr.write(`${lines.join('\n')}\n`);
};

const asInternalError = (err: unknown): RegistryError => {
  const message = err instanceof Error ? err.message : String(err);
  return new RegistryError({
    code: 'INTERNAL.UNEXPECTED',
    message,
    cause: err
  });
};

/**
 * Shared error formatter for CLI commands.
 *
 * Outputs structured error data for json/yaml/ndjson formats, or renders
 * human-readable error to stderr for text format. Returns exit code 1.
 * @param ctx CLI context.
 * @param output Output format (json, yaml, ndjson, text).
 * @param command Command name for structured output (e.g., 'index.build').
 * @param err RegistryError to format.
 * @returns Exit code 1.
 */
export const failWith = (
  ctx: Context,
  output: OutputFormat,
  command: string,
  err: RegistryError
): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command,
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

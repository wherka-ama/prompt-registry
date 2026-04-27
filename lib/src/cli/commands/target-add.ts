/**
 * Phase 4 / Iter 29 → Phase 5 / Iter 3 — `target add`.
 *
 * Iter-3 wires the persist side: parse + validate input, then
 * delegate to `addTarget()` from the install/target-store module.
 * The command writes to the nearest project config (cargo upward
 * walk), creating one in `cwd` when none exists.
 *
 * Per-type fields are kept minimal at this iter: `--scope`, `--path`,
 * `--allowed-kinds <a,b,c>`. The Target tagged-union admits more
 * fields in future iters as target writers grow.
 */
import * as path from 'node:path';
import type {
  Target,
  TargetType,
} from '../../domain/install';
import {
  TARGET_TYPES,
} from '../../domain/install';
import {
  addTarget,
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

export interface TargetAddOptions {
  output?: OutputFormat;
  /** Target name (required). */
  name: string;
  /** Target type (required). */
  type: string;
  /** Optional scope override ('user' or 'workspace'). */
  scope?: string;
  /** Optional path override. */
  path?: string;
  /** Optional comma-separated allowed kinds. */
  allowedKinds?: string;
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(TARGET_TYPES);

/**
 * Build the `target add` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createTargetAddCommand = (
  opts: TargetAddOptions
): CommandDefinition =>
  defineCommand({
    path: ['target', 'add'],
    description: 'Register a new install target in the project config (`prompt-registry.yml`).',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      if (opts.name.length === 0) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'target add: missing target name',
          hint: 'Usage: `prompt-registry target add <name> --type <kind>`'
        }));
      }
      if (!KNOWN_TYPES.has(opts.type)) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: `target add: unknown --type "${opts.type}"`,
          hint: `Known types: ${[...KNOWN_TYPES].toSorted().join(', ')}`,
          context: { type: opts.type }
        }));
      }
      // Build the typed target. Per-type fields land flatly on the
      // record; the Target tagged union accepts the structurally
      // narrowed shape for each type variant.
      // I-010: normalize relative --path to an absolute path so the
      // resulting prompt-registry.yml is portable across cwds.
      const cwd = ctx.cwd();
      if (opts.path !== undefined && opts.path.length > 0 && !path.isAbsolute(opts.path)) {
        opts.path = path.resolve(cwd, opts.path);
      }
      const target = buildTarget(opts);
      try {
        const result = await addTarget(
          { cwd, fs: ctx.fs },
          target
        );
        // I-009: eagerly create the target directory so users can ls
        // it after `target add` and so subsequent activations don't
        // fail on a missing parent. mkdir is idempotent (recursive).
        if (target.path !== undefined && target.path.length > 0) {
          try {
            await ctx.fs.mkdir(target.path, { recursive: true });
          } catch {
            // Permission/ENOSPC etc. — non-fatal at this point;
            // activation will surface a clearer error later.
          }
        }
        formatOutput({
          ctx,
          command: 'target.add',
          output: fmt,
          status: 'ok',
          data: { target, file: result.file, created: result.created },
          textRenderer: (d) => d.created
            ? `Created ${d.file} with target "${d.target.name}" (${d.target.type}).\n`
            : `Added target "${d.target.name}" (${d.target.type}) to ${d.file}.\n`
        });
        return 0;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        // Duplicate-name is the most common path; surface it as a
        // dedicated CONFIG.* code so callers (and tests) can branch on
        // it without parsing message text.
        const isDup = message.includes('already exists');
        return failWith(ctx, fmt, new RegistryError({
          code: isDup ? 'USAGE.MISSING_FLAG' : 'INTERNAL.UNEXPECTED',
          message: `target add: ${message}`,
          hint: isDup
            ? `Pick a different name, or run \`prompt-registry target remove ${opts.name}\` first.`
            : 'See `prompt-registry doctor` for environment diagnostics.',
          context: { name: opts.name, type: opts.type },
          cause: cause instanceof Error ? cause : undefined
        }));
      }
    }
  });

const buildTarget = (opts: TargetAddOptions): Target => {
  const type = opts.type as TargetType;
  const allowedKinds = opts.allowedKinds === undefined || opts.allowedKinds.length === 0
    ? undefined
    : opts.allowedKinds.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const scope = (opts.scope === 'workspace' ? 'workspace' : 'user');
  // copilot-cli is user-only per spec sec 5.6.
  if (type === 'copilot-cli') {
    const t: Target = {
      name: opts.name,
      type,
      scope: 'user',
      ...(opts.path === undefined ? {} : { path: opts.path }),
      ...(allowedKinds === undefined ? {} : { allowedKinds })
    };
    return t;
  }
  return {
    name: opts.name,
    type,
    scope,
    ...(opts.path === undefined ? {} : { path: opts.path }),
    ...(allowedKinds === undefined ? {} : { allowedKinds })
  } as Target;
};

const failWith = (ctx: Context, output: OutputFormat, err: RegistryError): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command: 'target.add',
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

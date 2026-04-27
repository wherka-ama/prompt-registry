/**
 * `prompt-registry index shortlist` — manage shortlists in a primitive
 * index. Subcommands: `new | add | remove | list`.
 *
 * Replaces the legacy `primitive-index shortlist <sub>` verbs with a
 * single framework command. Each call loads the index, mutates it,
 * and writes it back atomically (saveIndex creates parent dirs).
 * @module cli/commands/index-shortlist
 */
import {
  defaultIndexFile,
} from '../../primitive-index/default-paths';
import type {
  PrimitiveIndex,
} from '../../primitive-index/index';
import {
  loadIndex,
  saveIndex,
} from '../../primitive-index/store';
import type {
  Shortlist,
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

export type IndexShortlistSubcommand = 'new' | 'add' | 'remove' | 'list';

export interface IndexShortlistOptions {
  subcommand: IndexShortlistSubcommand;
  output?: OutputFormat;
  /** Path to the index JSON. */
  indexFile?: string;
  /** new: human label. */
  name?: string;
  /** new: optional description. */
  description?: string;
  /** add/remove: shortlist id. */
  shortlistId?: string;
  /** add/remove: primitive id. */
  primitiveId?: string;
}

/**
 * Build the `index shortlist` command. Dispatches to the chosen
 * subcommand.
 * @param opts CLI options.
 * @returns CommandDefinition.
 */
export const createIndexShortlistCommand = (
  opts: IndexShortlistOptions
): CommandDefinition =>
  defineCommand({
    path: ['index', 'shortlist', opts.subcommand],
    description: `Manage primitive-index shortlists: ${opts.subcommand}.`,
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      const indexPath = opts.indexFile ?? defaultIndexFile(ctx.env);
      try {
        const idx = loadIndex(indexPath);
        switch (opts.subcommand) {
          case 'new': { return runNew(ctx, fmt, idx, indexPath, opts);
          }
          case 'add': { return runAdd(ctx, fmt, idx, indexPath, opts);
          }
          case 'remove': { return runRemove(ctx, fmt, idx, indexPath, opts);
          }
          case 'list': { return runList(ctx, fmt, idx);
          }
        }
      } catch (cause) {
        return failWith(ctx, fmt, classifyError(cause, indexPath));
      }
    }
  });

const runNew = (
  ctx: Context,
  fmt: OutputFormat,
  idx: PrimitiveIndex,
  indexPath: string,
  opts: IndexShortlistOptions
): number => {
  if (opts.name === undefined || opts.name.length === 0) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: 'index shortlist new: --name <NAME> is required'
    }));
  }
  const sl = idx.createShortlist(opts.name, opts.description);
  saveIndex(idx, indexPath);
  formatOutput({
    ctx, command: 'index.shortlist', output: fmt, status: 'ok',
    data: { shortlist: sl },
    textRenderer: (d) => `Created shortlist "${d.shortlist.id}" (${d.shortlist.name}).\n`
  });
  return 0;
};

const runAdd = (
  ctx: Context,
  fmt: OutputFormat,
  idx: PrimitiveIndex,
  indexPath: string,
  opts: IndexShortlistOptions
): number => {
  const id = opts.shortlistId ?? '';
  const pid = opts.primitiveId ?? '';
  if (id.length === 0 || pid.length === 0) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: 'index shortlist add: --id <SHORTLIST_ID> and --primitive <PRIMITIVE_ID> are required'
    }));
  }
  let sl: Shortlist;
  try {
    sl = idx.addToShortlist(id, pid);
  } catch (cause) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'INDEX.SHORTLIST_NOT_FOUND',
      message: `index shortlist add: ${(cause as Error).message}`,
      cause: cause instanceof Error ? cause : undefined
    }));
  }
  saveIndex(idx, indexPath);
  formatOutput({
    ctx, command: 'index.shortlist', output: fmt, status: 'ok',
    data: { shortlist: sl },
    textRenderer: (d) => `Added ${pid} to shortlist ${d.shortlist.id}.\n`
  });
  return 0;
};

const runRemove = (
  ctx: Context,
  fmt: OutputFormat,
  idx: PrimitiveIndex,
  indexPath: string,
  opts: IndexShortlistOptions
): number => {
  const id = opts.shortlistId ?? '';
  const pid = opts.primitiveId ?? '';
  if (id.length === 0 || pid.length === 0) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: 'index shortlist remove: --id and --primitive are required'
    }));
  }
  let sl: Shortlist;
  try {
    sl = idx.removeFromShortlist(id, pid);
  } catch (cause) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'INDEX.SHORTLIST_NOT_FOUND',
      message: `index shortlist remove: ${(cause as Error).message}`,
      cause: cause instanceof Error ? cause : undefined
    }));
  }
  saveIndex(idx, indexPath);
  formatOutput({
    ctx, command: 'index.shortlist', output: fmt, status: 'ok',
    data: { shortlist: sl },
    textRenderer: (d) => `Removed ${pid} from shortlist ${d.shortlist.id}.\n`
  });
  return 0;
};

const runList = (
  ctx: Context,
  fmt: OutputFormat,
  idx: PrimitiveIndex
): number => {
  const shortlists = idx.listShortlists();
  formatOutput({
    ctx, command: 'index.shortlist', output: fmt, status: 'ok',
    data: { shortlists },
    textRenderer: (d) => d.shortlists.length === 0
      ? 'No shortlists.\n'
      : d.shortlists.map((sl: Shortlist) =>
        `${sl.id}\t${sl.name}\t${String(sl.primitiveIds.length)} items\n`
      ).join('')
  });
  return 0;
};

const classifyError = (cause: unknown, indexPath: string): RegistryError => {
  if (cause instanceof RegistryError) {
    return cause;
  }
  const msg = cause instanceof Error ? cause.message : String(cause);
  if (/ENOENT|no such file/i.test(msg)) {
    return new RegistryError({
      code: 'INDEX.NOT_FOUND',
      message: `index not found: ${indexPath}`,
      cause: cause instanceof Error ? cause : undefined
    });
  }
  return new RegistryError({
    code: 'INDEX.LOAD_FAILED',
    message: `index shortlist: ${msg}`,
    cause: cause instanceof Error ? cause : undefined
  });
};

const failWith = (ctx: Context, output: OutputFormat, err: RegistryError): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx, command: 'index.shortlist', output, status: 'error',
      data: null, errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
  return 1;
};

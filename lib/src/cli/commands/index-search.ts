/**
 * `prompt-registry index search` — search a primitive index.
 *
 * Framework command replacing the legacy `primitive-index search`
 * verb. The semantics are identical (BM25 + facets, deterministic
 * ranking) but output goes through `formatOutput` so JSON callers
 * get the canonical envelope and text callers get a readable table.
 *
 * Default index path is `<XDG cache>/primitive-index.json`; override
 * with `--index <FILE>`.
 * @module cli/commands/index-search
 */
import {
  defaultIndexFile,
} from '../../primitive-index/default-paths';
import {
  loadIndex,
} from '../../primitive-index/store';
import type {
  PrimitiveKind,
  SearchQuery,
  SearchResult,
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

export interface IndexSearchOptions {
  output?: OutputFormat;
  /** Free-text query. */
  query?: string;
  /** Path to the index JSON. Defaults to `<XDG cache>/primitive-index.json`. */
  indexFile?: string;
  /** Filter by primitive kind. */
  kinds?: PrimitiveKind[];
  /** Filter by source id. */
  sources?: string[];
  /** Filter by bundle id. */
  bundles?: string[];
  /** Filter by tag. */
  tags?: string[];
  /** Show only installed primitives. */
  installedOnly?: boolean;
  /** Cap number of hits returned. */
  limit?: number;
  /** Skip the first `offset` hits. */
  offset?: number;
  /** Include per-term explanation in each hit. */
  explain?: boolean;
}

/**
 * Build the `index search` command.
 * @param opts CLI options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createIndexSearchCommand = (
  opts: IndexSearchOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['index', 'search'],
    description: 'Search a primitive index by free text + facets.',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      const indexPath = opts.indexFile ?? defaultIndexFile(ctx.env);
      try {
        const idx = loadIndex(indexPath);
        const query: SearchQuery = {
          q: opts.query,
          kinds: opts.kinds,
          sources: opts.sources,
          bundles: opts.bundles,
          tags: opts.tags,
          installedOnly: opts.installedOnly,
          limit: opts.limit,
          offset: opts.offset,
          explain: opts.explain
        };
        const result = idx.search(query);
        formatOutput({
          ctx,
          command: 'index.search',
          output: fmt,
          status: 'ok',
          data: result,
          textRenderer: (r) => renderSearchText(r)
        });
        return 0;
      } catch (cause) {
        return failWith(ctx, fmt, classifyError(cause, indexPath));
      }
    }
  });

const classifyError = (cause: unknown, indexPath: string): RegistryError => {
  if (cause instanceof RegistryError) {
    return cause;
  }
  const msg = cause instanceof Error ? cause.message : String(cause);
  // Missing-file is the most common operator error and deserves a
  // dedicated code so scripts can branch on it.
  if (/ENOENT|no such file/i.test(msg)) {
    return new RegistryError({
      code: 'INDEX.NOT_FOUND',
      message: `index not found: ${indexPath}`,
      hint: 'Run `prompt-registry index build` or `prompt-registry index harvest` first.',
      cause: cause instanceof Error ? cause : undefined
    });
  }
  return new RegistryError({
    code: 'INDEX.LOAD_FAILED',
    message: `failed to load index ${indexPath}: ${msg}`,
    cause: cause instanceof Error ? cause : undefined
  });
};

const failWith = (ctx: Context, output: OutputFormat, err: RegistryError): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command: 'index.search',
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

const renderSearchText = (r: SearchResult): string => {
  const lines: string[] = [`total: ${String(r.total)}  took: ${String(r.tookMs)}ms`];
  for (const hit of r.hits) {
    const p = hit.primitive;
    lines.push(
      `${hit.score.toFixed(3)}  [${p.kind}] ${p.title}`
      + `  (${p.bundle.sourceId}/${p.bundle.bundleId})  ${p.id}`
    );
    if (p.description.length > 0) {
      lines.push(`      ${p.description}`);
    }
  }
  return lines.join('\n') + '\n';
};

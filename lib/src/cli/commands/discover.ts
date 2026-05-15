/**
 * `discover` command — context-aware resource discovery.
 *
 * Analyzes project context (tech stack, domain, activity) and searches
 * the primitive index for relevant Copilot resources (prompts, instructions,
 * agents, skills, chatmodes, MCP servers).
 *
 * Usage:
 *   prompt-registry discover [--index <path>] [--limit <n>] [--kinds <kinds>]
 * @module cli/commands/discover
 */
import {
  defaultIndexFile,
} from '../../infra/harvest/default-paths';
import type {
  PrimitiveKind,
  SearchHit,
  SearchResult,
} from '../../infra/search/types';
import {
  loadIndex,
} from '../../infra/stores/json-index-store';
import {
  ContextDetector,
  type DetectedContext,
} from '../../app/context-detection';
import type {
  ContextDetectionOptions,
} from '../../app/context-detection';
import {
  Command,
  Option,
} from '../framework';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

/**
 * Discover command options.
 */
export interface DiscoverOptions {
  output?: OutputFormat;
  /** Path to the index JSON. */
  indexFile?: string;
  /** Limit number of recommendations. */
  limit?: number;
  /** Filter by primitive kind. */
  kinds?: PrimitiveKind[];
  /** Working directory to analyze. */
  cwd?: string;
}

/**
 * Build the `discover` command.
 * @param opts CLI options.
 * @returns CommandDefinition.
 */
export const createDiscoverCommand = (
  opts: DiscoverOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['discover'],
    description: 'Discover relevant Copilot resources based on project context.',
    category: 'Discovery',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      const indexPath = opts.indexFile ?? defaultIndexFile(ctx.env);
      const cwd = opts.cwd ?? ctx.cwd();

      try {
        // Detect context
        const detector = new ContextDetector({ cwd });
        const context = await detector.detect();

        // Load index
        const idx = loadIndex(indexPath);

        // Build search queries from context
        const queries = buildSearchQueries(context);

        // Search for each query and aggregate results
        const allHits: SearchHit[] = [];
        for (const query of queries) {
          const result = idx.search({
            q: query,
            kinds: opts.kinds,
            limit: opts.limit ?? 5
          });
          allHits.push(...result.hits);
        }

        // Deduplicate and rank by score
        const uniqueHits = deduplicateHits(allHits);
        const rankedHits = uniqueHits
          .sort((a: SearchHit, b: SearchHit) => b.score - a.score)
          .slice(0, opts.limit ?? 10);

        formatOutput({
          ctx,
          command: 'discover',
          output: fmt,
          status: 'ok',
          data: {
            context,
            queries,
            results: rankedHits
          },
          textRenderer: (d) => renderDiscoveryText(d.context, d.queries, d.results)
        });
        return 0;
      } catch (cause) {
        return failWith(ctx, fmt, classifyError(cause, indexPath));
      }
    }
  });

/**
 * Discover command class.
 */
export class DiscoverCommand extends Command {
  public static readonly paths = [['discover']];
  // eslint-disable-next-line new-cap -- Command.Usage is a static method, not a constructor
  public static readonly usage = Command.Usage({
    description: 'Discover relevant Copilot resources based on project context.',
    category: 'Discovery',
    details: `
      Usage: prompt-registry discover [options]

      Examples:
        prompt-registry discover
        prompt-registry discover --limit 20
        prompt-registry discover --kinds prompt,skill

      Options:
        --index <path>         Path to index JSON (default: XDG cache/primitive-index.json)
        --limit <n>            Limit number of recommendations (default: 10)
        --kinds <kinds>        Filter by primitive kind (comma-separated)
        -o, --output <format>  Output format (text, json, yaml, ndjson)
    `
  });

  public output = Option.String('-o', '--output') as OutputFormat | undefined;
  public index = Option.String('--index');
  public limit = Option.String('--limit');
  public kinds = Option.Array('--kinds');

  public async execute(): Promise<number> {
    const ctx = (this as any).commandContext?.ctx as Context;
    if (!ctx) {
      throw new Error('CommandContext not available');
    }

    const fmt = (this.output ?? 'text') as OutputFormat;
    const indexPath = this.index ?? defaultIndexFile(ctx.env);
    const limit = this.limit ? Number.parseInt(this.limit, 10) : undefined;

    const opts: DiscoverOptions = {
      output: fmt,
      indexFile: indexPath,
      limit,
      kinds: this.kinds as PrimitiveKind[],
      cwd: ctx.cwd()
    };

    const cmd = createDiscoverCommand(opts);
    return cmd.run({ ctx });
  }
}

/**
 * Build search queries from detected context.
 * @param context Detected context.
 * @returns Search queries.
 */
function buildSearchQueries(context: DetectedContext): string[] {
  const queries: string[] = [];

  // Tech stack queries
  const { techStack } = context;
  if (techStack.languages.length > 0) {
    queries.push(techStack.languages.join(' '));
  }
  if (techStack.frameworks.length > 0) {
    queries.push(techStack.frameworks.join(' '));
  }

  // Domain queries
  const { domain } = context;
  if (domain.category) {
    queries.push(domain.category);
  }
  if (domain.businessDomain) {
    queries.push(domain.businessDomain);
  }
  if (domain.technicalDomain) {
    queries.push(domain.technicalDomain);
  }

  // Combined queries
  if (techStack.languages.length > 0 && domain.category) {
    queries.push(`${techStack.languages[0]} ${domain.category}`);
  }
  if (techStack.frameworks.length > 0 && domain.businessDomain) {
    queries.push(`${techStack.frameworks[0]} ${domain.businessDomain}`);
  }

  // Default query if no specific context detected
  if (queries.length === 0) {
    queries.push('copilot prompt instruction');
  }

  return queries;
}

/**
 * Deduplicate hits by primitive ID.
 * @param hits Search hits.
 * @returns Deduplicated hits.
 */
function deduplicateHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const unique: SearchHit[] = [];

  for (const hit of hits) {
    const key = `${hit.primitive.id}:${hit.primitive.bundle.sourceId}:${hit.primitive.bundle.bundleId}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(hit);
    }
  }

  return unique;
}

/**
 * Render discovery results as text.
 * @param context Detected context.
 * @param queries Search queries used.
 * @param results Search hits.
 * @returns Formatted text.
 */
function renderDiscoveryText(
  context: DetectedContext,
  queries: string[],
  results: SearchHit[]
): string {
  const lines: string[] = [];

  // Context summary
  lines.push('Detected Context:');
  lines.push(`  Languages: ${context.techStack.languages.join(', ') || 'none'}`);
  lines.push(`  Frameworks: ${context.techStack.frameworks.join(', ') || 'none'}`);
  lines.push(`  Domain: ${context.domain.category || context.domain.businessDomain || 'unknown'}`);
  lines.push('');

  // Search queries
  lines.push('Search Queries:');
  for (const q of queries) {
    lines.push(`  - ${q}`);
  }
  lines.push('');

  // Results
  lines.push(`Recommendations (${results.length}):`);
  for (const hit of results) {
    const p = hit.primitive;
    lines.push(
      `  [${hit.score.toFixed(3)}] [${p.kind}] ${p.title}`
      + `  (${p.bundle.sourceId}/${p.bundle.bundleId})`
    );
    if (p.description.length > 0) {
      lines.push(`      ${p.description}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Classify errors for discover command.
 * @param cause Error cause.
 * @param indexPath Index path.
 * @returns RegistryError.
 */
const classifyError = (cause: unknown, indexPath: string): RegistryError => {
  if (cause instanceof RegistryError) {
    return cause;
  }
  const msg = cause instanceof Error ? cause.message : String(cause);
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

/**
 * Fail with error.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @param err RegistryError.
 * @returns Exit code.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- synchronous body, Promise return type required by callers
const failWith = async (ctx: Context, output: OutputFormat, err: RegistryError): Promise<number> => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command: 'discover',
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

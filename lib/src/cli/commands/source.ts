/**
 * Phase 6 / Iter 81-84 — `source` commands (D23 default-local-hub UX).
 *
 * Subcommands:
 *   source add --type {github|local} --url <ref> [--id <id>] [--name <n>]
 *                                                     [--enabled true|false]
 *   source list [--hub <id>]
 *   source remove <sourceId>
 *
 * `source add` lands the new source in the synthetic default-local
 * hub (D23). `source list` defaults to "all hubs" so users see both
 * hub-curated and detached entries side-by-side.
 */
import {
  envTokenProvider,
  type HttpClient,
  type TokenProvider,
} from '../../install/http';
import {
  NodeHttpClient,
} from '../../install/node-http-client';
import {
  generateSourceId,
} from '../../install/source-id';
import {
  ActiveHubStore,
  CompositeHubResolver,
  GitHubHubResolver,
  HubManager,
  HubStore,
  LocalHubResolver,
  resolveUserConfigPaths,
  UrlHubResolver,
} from '../../registry-config';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

export type SourceSubcommand = 'add' | 'list' | 'remove';

export interface SourceOptions {
  subcommand: SourceSubcommand;
  output?: OutputFormat;
  /** add: source type. */
  sourceType?: 'github' | 'local';
  /** add: location (owner/repo or path). */
  url?: string;
  /** add: explicit source id. Defaults to deterministic. */
  sourceId?: string;
  /** add: human label. */
  name?: string;
  /** add: enabled flag (default true). */
  enabled?: boolean;
  /** list: optional hub filter. */
  hubId?: string;
  http?: HttpClient;
  tokens?: TokenProvider;
}

const buildMgr = (ctx: Context, opts: SourceOptions): HubManager => {
  const paths = resolveUserConfigPaths(ctx.env);
  const http = opts.http ?? new NodeHttpClient();
  const tokens = opts.tokens ?? envTokenProvider(ctx.env);
  const resolver = new CompositeHubResolver(
    new GitHubHubResolver(http, tokens),
    new LocalHubResolver(ctx.fs),
    new UrlHubResolver(http, tokens)
  );
  return new HubManager(
    new HubStore(paths.hubs, ctx.fs),
    new ActiveHubStore(paths.activeHub, ctx.fs),
    resolver
  );
};

/**
 * Build the `source` command. Dispatches to the chosen subcommand.
 * @param opts Subcommand options.
 * @returns CommandDefinition.
 */
export const createSourceCommand = (opts: SourceOptions): CommandDefinition =>
  defineCommand({
    path: ['source', opts.subcommand],
    description: `Manage registry sources: ${opts.subcommand}.`,
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      try {
        const mgr = buildMgr(ctx, opts);
        switch (opts.subcommand) {
          case 'add': { return await runAdd(ctx, fmt, mgr, opts);
          }
          case 'list': { return await runList(ctx, fmt, mgr, opts);
          }
          case 'remove': { return await runRemove(ctx, fmt, mgr, opts);
          }
        }
      } catch (cause) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'INTERNAL.UNEXPECTED',
          message: `source ${opts.subcommand}: ${(cause as Error).message}`,
          cause: cause instanceof Error ? cause : undefined
        }));
      }
    }
  });

const runAdd = async (ctx: Context, fmt: OutputFormat, mgr: HubManager, opts: SourceOptions): Promise<number> => {
  if (opts.url === undefined || opts.url.length === 0) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: 'source add: --url <owner/repo|path> is required'
    }));
  }
  const type = opts.sourceType ?? 'github';
  const id = opts.sourceId ?? generateSourceId(type, opts.url);
  const added = await mgr.addDetachedSource({
    id, name: opts.name ?? id, type, url: opts.url,
    enabled: opts.enabled ?? true, priority: 0
  });
  formatOutput({
    ctx, command: 'source.add', output: fmt, status: 'ok',
    data: { source: added },
    textRenderer: (d) => `Added source "${d.source.id}" (${d.source.type}: ${d.source.url}) to default-local hub.\n`
  });
  return 0;
};

const runList = async (ctx: Context, fmt: OutputFormat, mgr: HubManager, opts: SourceOptions): Promise<number> => {
  const sources = opts.hubId !== undefined && opts.hubId.length > 0
    ? await mgr.listSources(opts.hubId)
    : await mgr.listSourcesAcrossAllHubs();
  formatOutput({
    ctx, command: 'source.list', output: fmt, status: 'ok',
    data: { sources },
    textRenderer: (d) => d.sources.length === 0
      ? 'No sources.\n'
      : d.sources.map((s) => `${s.id}  [${s.hubId}]  ${s.type}: ${s.url}\n`).join('')
  });
  return 0;
};

const runRemove = async (ctx: Context, fmt: OutputFormat, mgr: HubManager, opts: SourceOptions): Promise<number> => {
  if (opts.sourceId === undefined || opts.sourceId.length === 0) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: 'source remove: <sourceId> required'
    }));
  }
  const removed = await mgr.removeDetachedSource(opts.sourceId);
  if (!removed) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'BUNDLE.NOT_FOUND',
      message: `source remove: "${opts.sourceId}" not in default-local hub`
    }));
  }
  formatOutput({
    ctx, command: 'source.remove', output: fmt, status: 'ok',
    data: { id: opts.sourceId },
    textRenderer: (d) => `Removed source "${d.id}".\n`
  });
  return 0;
};

const failWith = (ctx: Context, output: OutputFormat, err: RegistryError): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx, command: 'source', output, status: 'error',
      data: null, errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
  return 1;
};

/**
 * Phase 6 / Iter 51-58 — `hub` commands.
 *
 * Subcommands:
 *   hub add <ref>         import a hub from a reference
 *   hub list              list saved hubs
 *   hub use [<id>|--clear]  set/clear the active hub
 *   hub remove <id>       remove a hub
 *   hub sync [<id>]       re-fetch a hub config (default: active)
 *
 * The factory exposes a single `createHubCommand` that branches on
 * `opts.subcommand`, mirroring how `target` is wired.
 */
import * as path from 'node:path';
import {
  envTokenProvider,
  type HttpClient,
  type TokenProvider,
} from '../../install/http';
import {
  NodeHttpClient,
} from '../../install/node-http-client';
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

export type HubSubcommand = 'add' | 'list' | 'use' | 'remove' | 'sync';

export interface HubOptions {
  subcommand: HubSubcommand;
  output?: OutputFormat;
  /** add: github|local|url; default github when --ref looks like owner/repo */
  refType?: 'github' | 'local' | 'url';
  refLocation?: string;
  refRef?: string;
  hubId?: string;
  /** list: when true, ping each hub's upstream and surface reachability (I-007). */
  check?: boolean;
  /** use: pass `--clear` to clear the active pointer */
  clear?: boolean;
  /** Test seam */
  http?: HttpClient;
  tokens?: TokenProvider;
}

const buildManager = (ctx: Context, opts: HubOptions): HubManager => {
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
 * Build the `hub` command. Dispatches to the chosen subcommand.
 * @param opts Subcommand options.
 * @returns CommandDefinition.
 */
export const createHubCommand = (opts: HubOptions): CommandDefinition =>
  defineCommand({
    path: ['hub', opts.subcommand],
    description: `Manage registry hubs: ${opts.subcommand}.`,
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      try {
        const mgr = buildManager(ctx, opts);
        switch (opts.subcommand) {
          case 'add': { return await runAdd(ctx, fmt, mgr, opts);
          }
          case 'list': { return await runList(ctx, fmt, mgr, opts);
          }
          case 'use': { return await runUse(ctx, fmt, mgr, opts);
          }
          case 'remove': { return await runRemove(ctx, fmt, mgr, opts);
          }
          case 'sync': { return await runSync(ctx, fmt, mgr, opts);
          }
        }
      } catch (cause) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'INTERNAL.UNEXPECTED',
          message: `hub ${opts.subcommand}: ${(cause as Error).message}`,
          cause: cause instanceof Error ? cause : undefined
        }));
      }
    }
  });

const runAdd = async (ctx: Context, fmt: OutputFormat, mgr: HubManager, opts: HubOptions): Promise<number> => {
  if (opts.refLocation === undefined || opts.refLocation.length === 0) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: 'hub add: --location <ref> is required',
      hint: 'Examples: hub add --type github --location owner/repo --ref main'
    }));
  }
  const refType = opts.refType ?? 'github';
  // I-010: normalize a relative `local` location against ctx.cwd()
  // so subsequent `hub sync` from a different cwd still resolves
  // the same on-disk hub.
  let location = opts.refLocation;
  if (refType === 'local' && !path.isAbsolute(location)) {
    location = path.resolve(ctx.cwd(), location);
  }
  const id = await mgr.importHub({
    type: refType,
    location,
    ref: opts.refRef
  }, opts.hubId);
  formatOutput({
    ctx, command: 'hub.add', output: fmt, status: 'ok',
    data: { id, location, type: refType },
    textRenderer: (d) => `Imported hub "${d.id}" from ${d.type}:${d.location}.\n`
  });
  return 0;
};

const runList = async (ctx: Context, fmt: OutputFormat, mgr: HubManager, opts: HubOptions): Promise<number> => {
  const hubs = await mgr.listHubs();
  const active = await mgr.getActiveHub();
  // I-007: optional reachability probe. Pings each hub in parallel.
  let reachability: Record<string, { status: 'ok' | 'error'; reason?: string }> | undefined;
  if (opts.check === true) {
    reachability = {};
    const results = await Promise.all(hubs.map(async (h) => [h.id, await mgr.checkHub(h.id)] as const));
    for (const [id, r] of results) {
      reachability[id] = r;
    }
  }
  const enriched = reachability === undefined
    ? hubs
    : hubs.map((h) => ({ ...h, check: reachability[h.id] }));
  formatOutput({
    ctx, command: 'hub.list', output: fmt, status: 'ok',
    data: { hubs: enriched, activeId: active?.id ?? null },
    textRenderer: (d) => d.hubs.length === 0
      ? 'No hubs imported.\n'
      : d.hubs.map((h: { id: string; name: string; check?: { status: string; reason?: string } }) => {
        const marker = h.id === d.activeId ? '*' : ' ';
        const probe = h.check === undefined
          ? ''
          : (h.check.status === 'ok' ? '  [reachable]' : `  [unreachable: ${h.check.reason ?? '?'}]`);
        return `${marker} ${h.id}  ${h.name}${probe}\n`;
      }).join('')
  });
  return 0;
};

const runUse = async (ctx: Context, fmt: OutputFormat, mgr: HubManager, opts: HubOptions): Promise<number> => {
  if (opts.clear === true) {
    await mgr.useHub(null);
    formatOutput({
      ctx, command: 'hub.use', output: fmt, status: 'ok',
      data: { activeId: null },
      textRenderer: () => 'Active hub cleared.\n'
    });
    return 0;
  }
  if (opts.hubId === undefined || opts.hubId.length === 0) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: 'hub use: provide a hub id or --clear'
    }));
  }
  await mgr.useHub(opts.hubId);
  formatOutput({
    ctx, command: 'hub.use', output: fmt, status: 'ok',
    data: { activeId: opts.hubId },
    textRenderer: (d) => `Active hub: ${d.activeId}.\n`
  });
  return 0;
};

const runRemove = async (ctx: Context, fmt: OutputFormat, mgr: HubManager, opts: HubOptions): Promise<number> => {
  if (opts.hubId === undefined || opts.hubId.length === 0) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: 'hub remove: <hubId> is required'
    }));
  }
  await mgr.removeHub(opts.hubId);
  formatOutput({
    ctx, command: 'hub.remove', output: fmt, status: 'ok',
    data: { id: opts.hubId },
    textRenderer: (d) => `Removed hub "${d.id}".\n`
  });
  return 0;
};

const runSync = async (ctx: Context, fmt: OutputFormat, mgr: HubManager, opts: HubOptions): Promise<number> => {
  let id = opts.hubId;
  if (id === undefined || id.length === 0) {
    const active = await mgr.getActiveHub();
    if (active === null) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'hub sync: no <hubId> given and no active hub'
      }));
    }
    id = active.id;
  }
  await mgr.syncHub(id);
  formatOutput({
    ctx, command: 'hub.sync', output: fmt, status: 'ok',
    data: { id },
    textRenderer: (d) => `Synced hub "${d.id}".\n`
  });
  return 0;
};

const failWith = (ctx: Context, output: OutputFormat, err: RegistryError): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx, command: 'hub', output, status: 'error',
      data: null, errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
  return 1;
};

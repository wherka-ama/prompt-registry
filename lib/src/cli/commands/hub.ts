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
 * Converted to clipanion class-based commands with property initializers.
 */
import * as path from 'node:path';
import {
  HubManager,
  resolveUserConfigPaths,
} from '../../app/registry';
import {
  envTokenProvider,
  type TokenProvider,
} from '../../infra/github/token';
import {
  NodeHttpClient,
} from '../../infra/http/node-http-client';
import {
  CompositeHubResolver,
  GitHubHubResolver,
  LocalHubResolver,
  UrlHubResolver,
} from '../../infra/resolvers/hub-resolver';
import {
  ActiveHubStore,
} from '../../infra/stores/active-hub-store';
import {
  HubStore,
} from '../../infra/stores/yaml-hub-store';
import type {
  HttpClient,
} from '../../ports/http';
import {
  Command,
  Option,
} from '../framework';
import {
  type Context,
  formatOutput,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

/**
 * Build HubManager instance.
 * @param ctx CLI context.
 * @param http HTTP client (optional test seam).
 * @param tokens Token provider (optional test seam).
 * @returns HubManager instance.
 */
const buildManager = (ctx: Context, http?: HttpClient, tokens?: TokenProvider): HubManager => {
  const paths = resolveUserConfigPaths(ctx.env);
  const httpClient = http ?? new NodeHttpClient();
  const tokenProvider = tokens ?? envTokenProvider(ctx.env);
  const resolver = new CompositeHubResolver(
    new GitHubHubResolver(httpClient, tokenProvider),
    new LocalHubResolver(ctx.fs),
    new UrlHubResolver(httpClient, tokenProvider)
  );
  return new HubManager(
    new HubStore(paths.hubs, ctx.fs),
    new ActiveHubStore(paths.activeHub, ctx.fs),
    resolver
  );
};

/**
 * Context passed to hub command execute methods.
 */
interface HubCommandContext {
  ctx: Context;
  http?: HttpClient;
  tokens?: TokenProvider;
}

/**
 * Base class for hub commands with shared context.
 */
abstract class BaseHubCommand extends Command {
  /**
   * Get the CLI context. This needs to be set by the CLI entry point.
   */
  public commandContext!: HubCommandContext;

  public output = Option.String('-o,--output');
}

/**
 * hub list - list saved hubs
 */
export class HubListCommand extends BaseHubCommand {
  public static readonly paths = [['hub', 'list']];
  public check = Option.Boolean('--check');

  public async execute() {
    const { ctx, http, tokens } = this.commandContext;
    const fmt = (this.output ?? 'text') as OutputFormat;
    const mgr = buildManager(ctx, http, tokens);
    const hubs = await mgr.listHubs();
    const active = await mgr.getActiveHub();

    let reachability: Record<string, { status: 'ok' | 'error'; reason?: string }> | undefined;
    if (this.check) {
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
          let probe: string;
          if (h.check === undefined) {
            probe = '';
          } else if (h.check.status === 'ok') {
            probe = '  [reachable]';
          } else {
            probe = `  [unreachable: ${h.check.reason ?? '?'}]`;
          }
          return `${marker} ${h.id}  ${h.name}${probe}\n`;
        }).join('')
    });
    return 0;
  }
}

/**
 * hub add - import a hub from a reference
 */
export class HubAddCommand extends BaseHubCommand {
  public static readonly paths = [['hub', 'add']];
  public refType = Option.String('--type');
  public refLocation = Option.String('--location');
  public refRef = Option.String('--ref');
  public hubId = Option.String('--id');

  public async execute() {
    const { ctx, http, tokens } = this.commandContext;
    const fmt = (this.output ?? 'text') as OutputFormat;
    const mgr = buildManager(ctx, http, tokens);

    if (!this.refLocation) {
      return renderError(new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'hub add: --location <ref> is required',
        hint: 'Examples: hub add --type github --location owner/repo --ref main'
      }), ctx);
    }

    const refType = (this.refType ?? 'github') as 'github' | 'local' | 'url';
    let location = this.refLocation;
    if (refType === 'local' && !path.isAbsolute(location)) {
      location = path.resolve(ctx.cwd(), location);
    }

    const id = await mgr.importHub({
      type: refType,
      location,
      ref: this.refRef
    }, this.hubId);

    // F-05: sync immediately after import so profiles are usable right away
    await mgr.syncHub(id);

    formatOutput({
      ctx, command: 'hub.add', output: fmt, status: 'ok',
      data: { id, location, type: refType, synced: true },
      textRenderer: (d) => `Imported and synced hub "${d.id}" from ${d.type}:${d.location}.\n`
    });
    return 0;
  }
}

/**
 * hub use - set/clear the active hub
 */
export class HubUseCommand extends BaseHubCommand {
  public static readonly paths = [['hub', 'use']];
  public clear = Option.Boolean('--clear');
  public hubId = Option.String();

  public async execute() {
    const { ctx, http, tokens } = this.commandContext;
    const fmt = (this.output ?? 'text') as OutputFormat;
    const mgr = buildManager(ctx, http, tokens);

    if (this.clear) {
      await mgr.useHub(null);
      formatOutput({
        ctx, command: 'hub.use', output: fmt, status: 'ok',
        data: { activeId: null },
        textRenderer: () => 'Active hub cleared.\n'
      });
      return 0;
    }

    if (!this.hubId) {
      return renderError(new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'hub use: provide a hub id or --clear',
        hint: 'Run `prompt-registry hub list` to see available hubs.'
      }), ctx);
    }

    await mgr.useHub(this.hubId);
    formatOutput({
      ctx, command: 'hub.use', output: fmt, status: 'ok',
      data: { activeId: this.hubId },
      textRenderer: (d) => `Active hub: ${d.activeId}.\n`
    });
    return 0;
  }
}

/**
 * hub remove - remove a hub
 */
export class HubRemoveCommand extends BaseHubCommand {
  public static readonly paths = [['hub', 'remove']];
  public hubId = Option.String();

  public async execute() {
    const { ctx, http, tokens } = this.commandContext;
    const fmt = (this.output ?? 'text') as OutputFormat;
    const mgr = buildManager(ctx, http, tokens);

    if (!this.hubId) {
      return renderError(new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'hub remove: <hubId> is required',
        hint: 'Run `prompt-registry hub list` to see available hub IDs.'
      }), ctx);
    }

    await mgr.removeHub(this.hubId);
    formatOutput({
      ctx, command: 'hub.remove', output: fmt, status: 'ok',
      data: { id: this.hubId },
      textRenderer: (d) => `Removed hub "${d.id}".\n`
    });
    return 0;
  }
}

/**
 * hub create - scaffold a hub-config.yml skeleton
 */
export class HubCreateCommand extends BaseHubCommand {
  public static readonly paths = [['hub', 'create']];
  public name = Option.String('--name');
  public out = Option.String('--out');
  public addSource = Option.String('--add-source');

  public async execute() {
    const { ctx } = this.commandContext;
    const fmt = (this.output ?? 'text') as OutputFormat;

    if (!this.name) {
      renderError(new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'hub create: --name <name> is required',
        hint: 'Example: hub create --name "My Hub" --out ./my-hub'
      }), ctx);
      return 1;
    }

    const outDir = this.out ? path.resolve(ctx.cwd(), this.out) : ctx.cwd();
    const configPath = path.join(outDir, 'hub-config.yml');
    const now = new Date().toISOString();
    const sourcesBlock = this.addSource
      ? `  - id: local-source\n    type: local\n    url: ${path.resolve(ctx.cwd(), this.addSource)}\n`
      : '  # - id: my-source\n  #   type: github\n  #   url: owner/repo\n';

    const content = [
      '# hub-config.yml — created by prompt-registry hub create',
      'version: "1.0.0"',
      'metadata:',
      `  name: "${this.name}"`,
      '  description: ""',
      '  maintainer: ""',
      `  updatedAt: "${now}"`,
      'sources:',
      sourcesBlock,
      'profiles: []'
    ].join('\n') + '\n';

    await ctx.fs.mkdir(outDir, { recursive: true });
    await ctx.fs.writeFile(configPath, content);

    formatOutput({
      ctx, command: 'hub.create', output: fmt, status: 'ok',
      data: { path: configPath, name: this.name, outDir },
      textRenderer: (d) => `Created hub config: ${d.path}\n`
        + `Edit it to add sources and profiles, then run:\n`
        + `  prompt-registry hub add --type local --location ${d.outDir}\n`
    });
    return 0;
  }
}

/**
 * hub sync - re-fetch a hub config
 */
export class HubSyncCommand extends BaseHubCommand {
  public static readonly paths = [['hub', 'sync']];
  public hubId = Option.String();

  public async execute() {
    const { ctx, http, tokens } = this.commandContext;
    const fmt = (this.output ?? 'text') as OutputFormat;
    const mgr = buildManager(ctx, http, tokens);

    let id = this.hubId;
    if (!id) {
      const active = await mgr.getActiveHub();
      if (!active) {
        return renderError(new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'hub sync: no <hubId> given and no active hub',
          hint: 'Run `prompt-registry hub use <id>` or pass the hub id directly.'
        }), ctx);
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
  }
}

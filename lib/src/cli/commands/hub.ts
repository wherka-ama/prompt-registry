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
  type CommandClass,
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

    formatOutput({
      ctx, command: 'hub.add', output: fmt, status: 'ok',
      data: { id, location, type: refType },
      textRenderer: (d) => `Imported hub "${d.id}" from ${d.type}:${d.location}.\n`
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
        message: 'hub use: provide a hub id or --clear'
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
        message: 'hub remove: <hubId> is required'
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
          message: 'hub sync: no <hubId> given and no active hub'
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

/**
 * Create a configured clipanion CommandClass for a hub command.
 * Returns a subclass that injects commandContext before execute(), allowing
 * clipanion to properly process the command's Option declarations.
 * @param hubCommandClass The hub command class.
 * @param ctx CLI context.
 * @param http HTTP client (optional test seam).
 * @param tokens Token provider (optional test seam).
 * @param defaultOutput Default output format (optional).
 * @returns Configured CommandClass.
 */
const createHubCommandDefinition = (
  hubCommandClass: new () => BaseHubCommand & Command,
  ctx: Context,
  http?: HttpClient,
  tokens?: TokenProvider,
  defaultOutput?: string
): CommandClass => {
  class ConfiguredCommand extends (hubCommandClass as any) {
    public async execute(): Promise<number | void> {
      this.commandContext = { ctx, http, tokens };
      if (defaultOutput !== undefined && !this.output) {
        this.output = defaultOutput;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- dynamic subclass super call
      return super.execute();
    }
  }
  // Copy all static properties from the original class
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- dynamic class config
  (ConfiguredCommand as any).paths = (hubCommandClass as any).paths;

  // Copy all property descriptors from the base class to ensure clipanion discovers options
  const baseDescriptors = Object.getOwnPropertyDescriptors(hubCommandClass.prototype);
  for (const [key, descriptor] of Object.entries(baseDescriptors)) {
    if (key !== 'constructor') {
      Object.defineProperty(ConfiguredCommand.prototype, key, descriptor);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, new-cap -- dynamic usage assignment; Command.Usage is a static factory, not a constructor
  (ConfiguredCommand as any).usage = Command.Usage({
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- dynamic paths access
    description: `hub ${(hubCommandClass as any).paths[0][1]}`,
    category: 'Hub Management'
  });
  return ConfiguredCommand as unknown as CommandClass;
};

/**
 * Create hub list command definition.
 * @param ctx
 * @param http
 * @param tokens
 * @param defaultOutput
 */
export const createHubListCommand = (ctx: Context, http?: HttpClient, tokens?: TokenProvider, defaultOutput?: string): CommandClass =>
  createHubCommandDefinition(HubListCommand, ctx, http, tokens, defaultOutput);

/**
 * Create hub add command definition.
 * @param ctx
 * @param http
 * @param tokens
 * @param defaultOutput
 */
export const createHubAddCommand = (ctx: Context, http?: HttpClient, tokens?: TokenProvider, defaultOutput?: string): CommandClass =>
  createHubCommandDefinition(HubAddCommand, ctx, http, tokens, defaultOutput);

/**
 * Create hub use command definition.
 * @param ctx
 * @param http
 * @param tokens
 * @param defaultOutput
 */
export const createHubUseCommand = (ctx: Context, http?: HttpClient, tokens?: TokenProvider, defaultOutput?: string): CommandClass =>
  createHubCommandDefinition(HubUseCommand, ctx, http, tokens, defaultOutput);

/**
 * Create hub remove command definition.
 * @param ctx
 * @param http
 * @param tokens
 * @param defaultOutput
 */
export const createHubRemoveCommand = (ctx: Context, http?: HttpClient, tokens?: TokenProvider, defaultOutput?: string): CommandClass =>
  createHubCommandDefinition(HubRemoveCommand, ctx, http, tokens, defaultOutput);

/**
 * Create hub sync command definition.
 * @param ctx
 * @param http
 * @param tokens
 * @param defaultOutput
 */
export const createHubSyncCommand = (ctx: Context, http?: HttpClient, tokens?: TokenProvider, defaultOutput?: string): CommandClass =>
  createHubCommandDefinition(HubSyncCommand, ctx, http, tokens, defaultOutput);

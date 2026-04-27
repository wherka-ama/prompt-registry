/**
 * Phase 6 / Iter 71-78 — `profile` commands.
 *
 * Subcommands:
 *   profile list [--hub <id>]
 *   profile show <profileId>
 *   profile activate <profileId> [--hub <id>] [--target <name>...]
 *   profile deactivate
 *   profile current
 *
 * Activation is target-agnostic by default: when --target is
 * omitted, every project-level target receives the bundles
 * (mirrors D21 + the user's reframe: "no matter the target
 * environment").
 */
import * as path from 'node:path';
import {
  envTokenProvider,
  type HttpClient,
  type TokenProvider,
} from '../../install/http';
import {
  readLockfile,
  upsertUseProfile,
  writeLockfile,
} from '../../install/lockfile';
import {
  NodeHttpClient,
} from '../../install/node-http-client';
import {
  readTargets,
} from '../../install/target-store';
import {
  ActiveHubStore,
  CompositeHubResolver,
  GitHubHubResolver,
  HubManager,
  HubStore,
  LocalHubResolver,
  ProfileActivationStore,
  ProfileActivator,
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

export type ProfileSubcommand = 'list' | 'show' | 'activate' | 'deactivate' | 'current';

export interface ProfileOptions {
  subcommand: ProfileSubcommand;
  output?: OutputFormat;
  /** show/activate: profile id (positional). */
  profileId?: string;
  /** Restrict to a hub (default: active). */
  hubId?: string;
  /** activate: optional comma-separated subset of target names. */
  targets?: string;
  http?: HttpClient;
  tokens?: TokenProvider;
}

const buildHubMgr = (ctx: Context, opts: ProfileOptions): {
  mgr: HubManager;
  activations: ProfileActivationStore;
  http: HttpClient;
  tokens: TokenProvider;
} => {
  const paths = resolveUserConfigPaths(ctx.env);
  const http = opts.http ?? new NodeHttpClient();
  const tokens = opts.tokens ?? envTokenProvider(ctx.env);
  const resolver = new CompositeHubResolver(
    new GitHubHubResolver(http, tokens),
    new LocalHubResolver(ctx.fs),
    new UrlHubResolver(http, tokens)
  );
  return {
    mgr: new HubManager(
      new HubStore(paths.hubs, ctx.fs),
      new ActiveHubStore(paths.activeHub, ctx.fs),
      resolver
    ),
    activations: new ProfileActivationStore(paths.profileActivations, ctx.fs),
    http,
    tokens
  };
};

/**
 * Build the `profile` command. Dispatches to the chosen subcommand.
 * @param opts Subcommand options.
 * @returns CommandDefinition.
 */
export const createProfileCommand = (opts: ProfileOptions): CommandDefinition =>
  defineCommand({
    path: ['profile', opts.subcommand],
    description: `Manage profiles: ${opts.subcommand}.`,
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      try {
        const built = buildHubMgr(ctx, opts);
        switch (opts.subcommand) {
          case 'list': { return await runList(ctx, fmt, built.mgr, opts);
          }
          case 'show': { return await runShow(ctx, fmt, built.mgr, opts);
          }
          case 'activate': { return await runActivate(ctx, fmt, built, opts);
          }
          case 'deactivate': { return await runDeactivate(ctx, fmt, built);
          }
          case 'current': { return await runCurrent(ctx, fmt, built);
          }
        }
      } catch (cause) {
        // Only trust caller-provided codes that already match the
        // NAMESPACE.UPPER_SNAKE format (ours). Bare Node errors
        // (`ERR_OUT_OF_RANGE`, `ENOENT`, etc.) get a generic code.
        const rawCode = (cause as { code?: string }).code;
        const code = (typeof rawCode === 'string' && /^[A-Z]+\.[A-Z0-9_]+$/.test(rawCode))
          ? rawCode
          : 'INTERNAL.UNEXPECTED';
        return failWith(ctx, fmt, new RegistryError({
          code,
          message: `profile ${opts.subcommand}: ${(cause as Error).message}`,
          cause: cause instanceof Error ? cause : undefined
        }));
      }
    }
  });

const resolveHubId = async (mgr: HubManager, opts: ProfileOptions): Promise<string> => {
  if (opts.hubId !== undefined && opts.hubId.length > 0) {
    return opts.hubId;
  }
  const active = await mgr.getActiveHub();
  if (active === null) {
    throw new Error('no active hub; pass --hub <id> or run `hub use <id>` first');
  }
  return active.id;
};

const runList = async (ctx: Context, fmt: OutputFormat, mgr: HubManager, opts: ProfileOptions): Promise<number> => {
  const hubId = await resolveHubId(mgr, opts);
  const sources = await mgr.listSources(hubId);
  // Re-load the hub config to pull profiles[].
  const hubs = await mgr.listHubs();
  if (!hubs.some((h) => h.id === hubId)) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: `profile list: hub "${hubId}" not found`
    }));
  }
  const all = await mgr.listSourcesAcrossAllHubs();
  const sourceCount = all.filter((s) => s.hubId === hubId).length;
  // Profiles live in the hub config; load it via mgr.getActiveHub-style
  // path. The simplest path: ask HubStore directly through mgr.
  const active = await mgr.getActiveHub();
  let profiles: { id: string; name: string; bundles: number }[] = [];
  if (active?.id === hubId) {
    profiles = active.config.profiles.map((p) => ({
      id: p.id, name: p.name, bundles: p.bundles.length
    }));
  } else {
    // Use sources count as a proxy; a richer impl would expose getHub().
    // For now we intentionally avoid leaking the HubStore.
    profiles = [];
  }
  formatOutput({
    ctx, command: 'profile.list', output: fmt, status: 'ok',
    data: { hubId, profiles, sourceCount },
    textRenderer: (d) => d.profiles.length === 0
      ? `No profiles in hub "${d.hubId}".\n`
      : d.profiles.map((p) => `${p.id}  ${p.name} (${String(p.bundles)} bundle${p.bundles === 1 ? '' : 's'})\n`).join('')
  });
  return 0;
};

const runShow = async (ctx: Context, fmt: OutputFormat, mgr: HubManager, opts: ProfileOptions): Promise<number> => {
  if (opts.profileId === undefined || opts.profileId.length === 0) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: 'profile show: <profileId> required'
    }));
  }
  const hubId = await resolveHubId(mgr, opts);
  const active = await mgr.getActiveHub();
  if (active === null || active.id !== hubId) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: `profile show: hub "${hubId}" must be active to load profiles (run \`hub use ${hubId}\` first)`
    }));
  }
  const profile = active.config.profiles.find((p) => p.id === opts.profileId);
  if (profile === undefined) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'BUNDLE.NOT_FOUND',
      message: `profile show: "${opts.profileId}" not in hub "${hubId}"`
    }));
  }
  formatOutput({
    ctx, command: 'profile.show', output: fmt, status: 'ok',
    data: { hubId, profile },
    textRenderer: (d) => `${d.profile.name} (${d.profile.id})\n`
      + `  Bundles: ${String(d.profile.bundles.length)}\n`
      + d.profile.bundles.map((b) => `    - ${b.id}@${b.version} (source: ${b.source})\n`).join('')
  });
  return 0;
};

const runActivate = async (
  ctx: Context, fmt: OutputFormat,
  built: { mgr: HubManager; activations: ProfileActivationStore; http: HttpClient; tokens: TokenProvider },
  opts: ProfileOptions
): Promise<number> => {
  if (opts.profileId === undefined || opts.profileId.length === 0) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: 'profile activate: <profileId> required'
    }));
  }
  const hubId = await resolveHubId(built.mgr, opts);
  const active = await built.mgr.getActiveHub();
  if (active === null || active.id !== hubId) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: `profile activate: hub "${hubId}" must be active`
    }));
  }
  const profile = active.config.profiles.find((p) => p.id === opts.profileId);
  if (profile === undefined) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'BUNDLE.NOT_FOUND',
      message: `profile activate: "${opts.profileId}" not in hub "${hubId}"`
    }));
  }
  // Source map.
  const sources = Object.fromEntries(
    (await built.mgr.listSources(hubId)).map((s) => [s.id, s])
  );
  // Load project-level targets; optionally filter via --target.
  let targets = await readTargets({ cwd: ctx.cwd(), fs: ctx.fs });
  if (opts.targets !== undefined && opts.targets.length > 0) {
    const wanted = new Set(opts.targets.split(',').map((s) => s.trim()).filter((s) => s.length > 0));
    targets = targets.filter((t) => wanted.has(t.name));
  }
  if (targets.length === 0) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: 'profile activate: no targets configured (run `target add` first)'
    }));
  }
  // D21: deactivate any previously-active profile first.
  const prev = await built.activations.getActive();
  if (prev !== null) {
    await built.activations.remove(prev.hubId, prev.profileId);
  }
  // Run the activator.
  const activator = new ProfileActivator({
    fs: ctx.fs, env: ctx.env, http: built.http, tokens: built.tokens
  });
  const out = await activator.activate({ hubId, profile, sources, targets });
  await built.activations.save(out.state);

  // D24: persist the project<->profile linkage so a fresh checkout
  // can re-activate via `install --lockfile`.
  const lockPath = path.join(ctx.cwd(), 'prompt-registry.lock.json');
  const existing = await readLockfile(lockPath, ctx.fs);
  const nextLock = upsertUseProfile(existing, { hubId, profileId: profile.id });
  await writeLockfile(lockPath, nextLock, ctx.fs);

  formatOutput({
    ctx, command: 'profile.activate', output: fmt, status: 'ok',
    data: { hubId, profileId: profile.id, state: out.state, written: out.written, lockfile: lockPath },
    textRenderer: (d) => `Activated profile "${d.profileId}" from hub "${d.hubId}":\n`
      + `  Bundles: ${d.state.syncedBundles.join(', ')}\n`
      + `  Targets: ${d.state.syncedTargets.join(', ')}\n`
  });
  return 0;
};

const runDeactivate = async (
  ctx: Context, fmt: OutputFormat,
  built: { activations: ProfileActivationStore }
): Promise<number> => {
  const cur = await built.activations.getActive();
  if (cur === null) {
    formatOutput({
      ctx, command: 'profile.deactivate', output: fmt, status: 'ok',
      data: { deactivated: null },
      textRenderer: () => 'No active profile.\n'
    });
    return 0;
  }
  await built.activations.remove(cur.hubId, cur.profileId);

  // D24: clear the lockfile linkage so checkouts of this project
  // do not auto-reactivate.
  const lockPath = path.join(ctx.cwd(), 'prompt-registry.lock.json');
  if (await ctx.fs.exists(lockPath)) {
    const existing = await readLockfile(lockPath, ctx.fs);
    if (existing.useProfile !== undefined) {
      await writeLockfile(lockPath, upsertUseProfile(existing, null), ctx.fs);
    }
  }
  formatOutput({
    ctx, command: 'profile.deactivate', output: fmt, status: 'ok',
    data: { deactivated: { hubId: cur.hubId, profileId: cur.profileId } },
    textRenderer: (d) => `Deactivated profile "${d.deactivated?.profileId}".\n`
  });
  return 0;
};

const runCurrent = async (
  ctx: Context, fmt: OutputFormat,
  built: { activations: ProfileActivationStore }
): Promise<number> => {
  const cur = await built.activations.getActive();
  formatOutput({
    ctx, command: 'profile.current', output: fmt, status: 'ok',
    data: { current: cur },
    textRenderer: (d) => d.current === null
      ? 'No active profile.\n'
      : `Active profile: "${d.current.profileId}" (hub: ${d.current.hubId})\n`
  });
  return 0;
};

const failWith = (ctx: Context, output: OutputFormat, err: RegistryError): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx, command: 'profile', output, status: 'error',
      data: null, errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
  return 1;
};

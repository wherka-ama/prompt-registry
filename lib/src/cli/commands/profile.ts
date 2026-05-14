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
 * Converted to clipanion class-based commands with property initializers.
 */
import * as path from 'node:path';
import {
  type ActivationOutcome,
  HubManager,
  ProfileActivator,
  resolveUserConfigPaths,
} from '../../app/registry';
import {
  type ProfileBundle,
} from '../../domain/registry';
import {
  generateSourceId,
} from '../../domain/source-id';
import {
  envTokenProvider,
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
  readLockfile,
  upsertEntry,
  upsertSource,
  upsertUseProfile,
  writeLockfile,
} from '../../infra/stores/json-lockfile-store';
import {
  ProfileActivationStore,
} from '../../infra/stores/profile-activation-store';
import {
  readTargets,
} from '../../infra/stores/target-store';
import {
  HubStore,
} from '../../infra/stores/yaml-hub-store';
import {
  type HttpClient,
  type TokenProvider,
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
 * Build HubManager and related instances.
 * @param ctx CLI context.
 * @param http HTTP client (optional test seam).
 * @param tokens Token provider (optional test seam).
 * @returns HubManager, activations store, HTTP client, and token provider.
 */
const buildHubMgr = (ctx: Context, http?: HttpClient, tokens?: TokenProvider): {
  mgr: HubManager;
  activations: ProfileActivationStore;
  http: HttpClient;
  tokens: TokenProvider;
} => {
  const paths = resolveUserConfigPaths(ctx.env);
  const httpClient = http ?? new NodeHttpClient();
  const tokenProvider = tokens ?? envTokenProvider(ctx.env);
  const resolver = new CompositeHubResolver(
    new GitHubHubResolver(httpClient, tokenProvider),
    new LocalHubResolver(ctx.fs),
    new UrlHubResolver(httpClient, tokenProvider)
  );
  return {
    mgr: new HubManager(
      new HubStore(paths.hubs, ctx.fs),
      new ActiveHubStore(paths.activeHub, ctx.fs),
      resolver
    ),
    activations: new ProfileActivationStore(paths.profileActivations, ctx.fs),
    http: httpClient,
    tokens: tokenProvider
  };
};

/**
 * Resolve hub ID from options or active hub.
 * @param mgr Hub manager.
 * @param hubId Optional hub ID from options.
 * @returns Hub ID.
 */
const resolveHubId = async (mgr: HubManager, hubId?: string): Promise<string> => {
  if (hubId && typeof hubId === 'string') {
    return hubId;
  }
  const active = await mgr.getActiveHub();
  if (!active) {
    throw new RegistryError({
      code: 'HUB.NOT_FOUND',
      message: 'no active hub',
      hint: 'Run `prompt-registry hub add` to import a hub, then `hub use <id>` to activate it.'
    });
  }
  return active.id;
};

/**
 * Context passed to profile command execute methods.
 */
interface ProfileCommandContext {
  ctx: Context;
  http?: HttpClient;
  tokens?: TokenProvider;
}

/**
 * Base class for profile commands with shared context.
 */
abstract class BaseProfileCommand extends Command {
  /**
   * Get the CLI context. This needs to be set by the CLI entry point.
   */
  public commandContext!: ProfileCommandContext;

  public output = Option.String('-o,--output');
  public hubId = Option.String('--hub');
}

/**
 * profile list - list profiles in a hub
 */
export class ProfileListCommand extends BaseProfileCommand {
  public static readonly paths = [['profile', 'list']];

  public async execute() {
    const { ctx, http, tokens } = this.commandContext;
    const fmt = (this.output ?? 'text') as OutputFormat;
    const built = buildHubMgr(ctx, http, tokens);
    const mgr = built.mgr;

    const hubId = await resolveHubId(mgr, this.hubId);

    // Re-load the hub config to pull profiles[].
    const hubs = await mgr.listHubs();
    if (!hubs.some((h) => h.id === hubId)) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'HUB.NOT_FOUND',
        message: `profile list: hub "${hubId}" not found`,
        hint: 'Run `prompt-registry hub list` to see available hubs.'
      }));
    }
    const all = await mgr.listSourcesAcrossAllHubs();
    const sourceCount = all.filter((s) => s.hubId === hubId).length;
    const active = await mgr.getActiveHub();
    const profiles = active?.id === hubId
      ? active.config.profiles.map((p) => ({
        id: p.id, name: p.name, bundles: p.bundles.length
      }))
      : [];
    formatOutput({
      ctx, command: 'profile.list', output: fmt, status: 'ok',
      data: { hubId, profiles, sourceCount },
      textRenderer: (d) => d.profiles.length === 0
        ? `No profiles in hub "${d.hubId}".\n`
        : d.profiles.map((p) => `${p.id}  ${p.name} (${String(p.bundles)} bundle${p.bundles === 1 ? '' : 's'})\n`).join('')
    });
    return 0;
  }
}

/**
 * profile show - show profile details
 */
export class ProfileShowCommand extends BaseProfileCommand {
  public static readonly paths = [['profile', 'show']];
  public profileId = Option.String();

  public async execute() {
    const { ctx, http, tokens } = this.commandContext;
    const fmt = (this.output ?? 'text') as OutputFormat;
    const built = buildHubMgr(ctx, http, tokens);
    const mgr = built.mgr;

    if (!this.profileId) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'profile show: <profileId> required'
      }));
    }

    const hubId = await resolveHubId(mgr, this.hubId);

    const active = await mgr.getActiveHub();
    if (active?.id !== hubId) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: `profile show: hub "${hubId}" must be active to load profiles (run \`hub use ${hubId}\` first)`
      }));
    }
    const profile = active.config.profiles.find((p) => p.id === this.profileId);
    if (profile === undefined) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'BUNDLE.NOT_FOUND',
        message: `profile show: "${this.profileId}" not in hub "${hubId}"`,
        hint: 'Run `prompt-registry profile list` to see available profiles.'
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
  }
}

/**
 * profile activate - activate a profile
 */
export class ProfileActivateCommand extends BaseProfileCommand {
  public static readonly paths = [['profile', 'activate']];
  public profileId = Option.String({ required: false });
  public targets = Option.String('--target');
  public dryRun = Option.Boolean('--dry-run', false);

  public async execute() {
    const { ctx, http, tokens } = this.commandContext;
    const fmt = (this.output ?? 'text') as OutputFormat;
    const built = buildHubMgr(ctx, http, tokens);

    if (!this.profileId) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'profile activate: <profileId> required',
        hint: 'Run `prompt-registry profile list` to see available profile IDs.'
      }));
    }

    const hubId = await resolveHubId(built.mgr, this.hubId);

    const active = await built.mgr.getActiveHub();
    if (active?.id !== hubId) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: `profile activate: hub "${hubId}" must be active`
      }));
    }
    const profile = active.config.profiles.find((p) => p.id === this.profileId);
    if (profile === undefined) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'BUNDLE.NOT_FOUND',
        message: `profile activate: "${this.profileId}" not in hub "${hubId}"`,
        hint: 'Run `prompt-registry profile list` to see available profiles.'
      }));
    }

    let targets = await readTargets({ cwd: ctx.cwd(), fs: ctx.fs });
    if (this.targets) {
      const wanted = new Set(this.targets.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0));
      targets = targets.filter((t) => wanted.has(t.name));
    }
    if (targets.length === 0) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'profile activate: no targets configured',
        hint: 'Run `prompt-registry target add <name> --type <type>` to configure a target.'
      }));
    }

    if (this.dryRun) {
      formatOutput({
        ctx, command: 'profile.activate', output: fmt, status: 'ok',
        data: {
          dryRun: true,
          hubId,
          profileId: profile.id,
          profileName: profile.name,
          bundles: profile.bundles.map((b) => b.id),
          targets: targets.map((t) => t.name)
        },
        textRenderer: (d) => `[dry-run] Would activate profile "${d.profileId}" from hub "${d.hubId}":\n`
          + `  Bundles: ${d.bundles.join(', ')}\n`
          + `  Targets: ${d.targets.join(', ')}\n`
          + 'Run without --dry-run to apply.\n'
      });
      return 0;
    }

    const lockPath = path.join(ctx.cwd(), 'prompt-registry.lock.json');
    const prev = await built.activations.getActive();
    if (prev !== null) {
      await cleanupDeactivatedLockfile(ctx, lockPath);
      await built.activations.remove(prev.hubId, prev.profileId);
    }

    const activator = new ProfileActivator({
      fs: ctx.fs, env: ctx.env, http: built.http, tokens: built.tokens
    });
    const out = await activator.activate({
      hubId,
      profile,
      sources: Object.fromEntries((await built.mgr.listSources(hubId)).map((s) => [s.id, s])),
      targets
    });
    await built.activations.save(out.state);
    const sourcesMap = Object.fromEntries((await built.mgr.listSources(hubId)).map((s) => [s.id, s]));
    await updateActivationLockfile(ctx, lockPath, hubId, profile, sourcesMap, out);

    formatOutput({
      ctx, command: 'profile.activate', output: fmt, status: 'ok',
      data: { hubId, profileId: profile.id, state: out.state, written: out.written, lockfile: lockPath },
      textRenderer: (d) => `Activated profile "${d.profileId}" from hub "${d.hubId}":\n`
        + `  Bundles: ${d.state.syncedBundles.join(', ')}\n`
        + `  Targets: ${d.state.syncedTargets.join(', ')}\n`
    });
    return 0;
  }
}

/**
 * profile deactivate - deactivate the active profile
 */
export class ProfileDeactivateCommand extends BaseProfileCommand {
  public static readonly paths = [['profile', 'deactivate']];

  public async execute() {
    const { ctx, http, tokens } = this.commandContext;
    const fmt = (this.output ?? 'text') as OutputFormat;
    const built = buildHubMgr(ctx, http, tokens);
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

    const lockPath = path.join(ctx.cwd(), 'prompt-registry.lock.json');
    await cleanupDeactivatedLockfile(ctx, lockPath);
    formatOutput({
      ctx, command: 'profile.deactivate', output: fmt, status: 'ok',
      data: { deactivated: { hubId: cur.hubId, profileId: cur.profileId } },
      textRenderer: (d) => `Deactivated profile "${d.deactivated?.profileId}".\n`
    });
    return 0;
  }
}

/**
 * profile current - show currently active profile
 */
export class ProfileCurrentCommand extends BaseProfileCommand {
  public static readonly paths = [['profile', 'current']];

  public async execute() {
    const { ctx, http, tokens } = this.commandContext;
    const fmt = (this.output ?? 'text') as OutputFormat;
    const built = buildHubMgr(ctx, http, tokens);
    const activations = built.activations;

    const active = await activations.getActive();
    if (!active) {
      formatOutput({
        ctx, command: 'profile.current', output: fmt, status: 'ok',
        data: { active: null },
        textRenderer: () => 'No active profile.\n'
      });
      return 0;
    }
    formatOutput({
      ctx, command: 'profile.current', output: fmt, status: 'ok',
      data: { active: { hubId: active.hubId, profileId: active.profileId } },
      textRenderer: (d) => `Active profile: ${d.active.profileId} (hub: ${d.active.hubId})\n`
    });
    return 0;
  }
}

/**
 * profile create - create a new local profile
 */
export class ProfileCreateCommand extends BaseProfileCommand {
  public static readonly paths = [['profile', 'create']];
  // eslint-disable-next-line new-cap -- Command.Usage is a static method, not a constructor
  public static readonly usage = Command.Usage({
    description: 'Create a new local profile in the default-local hub.',
    category: 'Configuration',
    details: `
      Usage: prompt-registry profile create <profile-id> --name <name> [options]

      Examples:
        prompt-registry profile create my-profile --name "My Profile" --description "A custom profile"
        prompt-registry profile create dev-tools --name "Dev Tools" --bundles bundle1,bundle2

      Options:
        --name <name>           Profile display name (required)
        --description <text>   Profile description
        --bundles <list>        Comma-separated list of bundle IDs
        --hub <id>             Hub ID (defaults to default-local)
    `
  });

  public profileId = Option.String();
  public name = Option.String('--name');
  public description = Option.String('--description');
  public bundles = Option.String('--bundles');

  public async execute() {
    const { ctx, http, tokens } = this.commandContext;
    const fmt = (this.output ?? 'text') as OutputFormat;
    const built = buildHubMgr(ctx, http, tokens);
    const mgr = built.mgr;

    if (!this.profileId) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'profile create: <profile-id> is required'
      }));
    }

    if (!this.name) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'profile create: --name is required'
      }));
    }

    const hubId = this.hubId ?? 'default-local';
    const bundleList = this.bundles ? this.bundles.split(',').map((b) => b.trim()) : [];

    // Convert bundle IDs to ProfileBundle format
    const profileBundles: ProfileBundle[] = bundleList.map((bundleId) => ({
      id: bundleId,
      version: 'latest',
      source: hubId,
      required: false
    }));

    const profile = await mgr.addProfile(hubId, {
      id: this.profileId,
      name: this.name,
      description: this.description,
      bundles: profileBundles
    });

    formatOutput({
      ctx, command: 'profile.create', output: fmt, status: 'ok',
      data: { hubId, profile: { id: profile.id, name: profile.name, bundles: profile.bundles.length } },
      textRenderer: (d) => `Created profile "${d.profile.id}" in hub "${d.hubId}" with ${String(d.profile.bundles)} bundle${d.profile.bundles === 1 ? '' : 's'}.\n`
    });
    return 0;
  }
}

/**
 * profile edit - edit an existing local profile
 */
export class ProfileEditCommand extends BaseProfileCommand {
  public static readonly paths = [['profile', 'edit']];
  // eslint-disable-next-line new-cap -- Command.Usage is a static method, not a constructor
  public static readonly usage = Command.Usage({
    description: 'Edit an existing local profile (add/remove bundles, change description).',
    category: 'Configuration',
    details: `
      Usage: prompt-registry profile edit <profile-id> [options]

      Examples:
        prompt-registry profile edit my-profile --description "Updated description"
        prompt-registry profile edit my-profile --add-bundles bundle1,bundle2
        prompt-registry profile edit my-profile --remove-bundles bundle1,bundle2
        prompt-registry profile edit my-profile --name "New Name"

      Options:
        --name <name>           New profile display name
        --description <text>   New profile description
        --add-bundles <list>    Comma-separated list of bundle IDs to add
        --remove-bundles <list> Comma-separated list of bundle IDs to remove
        --hub <id>             Hub ID (defaults to default-local)
    `
  });

  public profileId = Option.String();
  public name = Option.String('--name');
  public description = Option.String('--description');
  public addBundles = Option.String('--add-bundles');
  public removeBundles = Option.String('--remove-bundles');

  public async execute() {
    const { ctx, http, tokens } = this.commandContext;
    const fmt = (this.output ?? 'text') as OutputFormat;
    const built = buildHubMgr(ctx, http, tokens);
    const mgr = built.mgr;

    if (!this.profileId) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'profile edit: <profile-id> is required'
      }));
    }

    const hubId = this.hubId ?? 'default-local';

    // Load existing profile
    const hubs = await mgr.listHubs();
    const hub = hubs.find((h) => h.id === hubId);
    if (!hub) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: `profile edit: hub "${hubId}" not found`
      }));
    }

    const active = await mgr.getActiveHub();
    const profiles = active?.id === hubId ? active.config.profiles : [];
    const existingProfile = profiles.find((p) => p.id === this.profileId);

    if (!existingProfile) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: `profile edit: profile "${this.profileId}" not found in hub "${hubId}"`
      }));
    }

    // Build updated profile
    const updatedBundles = [...existingProfile.bundles];

    if (this.removeBundles) {
      const toRemove = this.removeBundles.split(',').map((b) => b.trim());
      for (const bundleId of toRemove) {
        const idx = updatedBundles.findIndex((b) => b.id === bundleId);
        if (idx !== -1) {
          updatedBundles.splice(idx, 1);
        }
      }
    }

    if (this.addBundles) {
      const toAdd = this.addBundles.split(',').map((b) => b.trim());
      for (const bundleId of toAdd) {
        if (!updatedBundles.some((b) => b.id === bundleId)) {
          updatedBundles.push({
            id: bundleId,
            version: 'latest',
            source: hubId,
            required: false
          });
        }
      }
    }

    const updatedProfile = await mgr.addProfile(hubId, {
      id: existingProfile.id,
      name: this.name ?? existingProfile.name,
      description: this.description ?? existingProfile.description,
      bundles: updatedBundles
    });

    formatOutput({
      ctx, command: 'profile.edit', output: fmt, status: 'ok',
      data: { hubId, profile: { id: updatedProfile.id, name: updatedProfile.name, bundles: updatedProfile.bundles.length } },
      textRenderer: (d) => `Updated profile "${d.profile.id}" in hub "${d.hubId}" with ${String(d.profile.bundles)} bundle${d.profile.bundles === 1 ? '' : 's'}.\n`
    });
    return 0;
  }
}

/**
 * Update the lockfile after a successful profile activation.
 * @param ctx CLI context.
 * @param lockPath Path to the lockfile.
 * @param hubId Hub identifier.
 * @param profile Profile being activated.
 * @param profile.id Profile identifier.
 * @param profile.bundles Profile bundle references.
 * @param sourcesMap Map of source ID to source config.
 * @param out Activation outcome with written files and state.
 */
async function updateActivationLockfile(
  ctx: Context,
  lockPath: string,
  hubId: string,
  profile: { id: string; bundles: { source: string; id: string; version: string }[] },
  sourcesMap: Record<string, { type: string; url: string }>,
  out: ActivationOutcome
): Promise<void> {
  const existing = await readLockfile(lockPath, ctx.fs);
  let nextLock = upsertUseProfile(existing, { hubId, profileId: profile.id });
  for (const t of out.state.syncedTargets) {
    for (const bundleRef of profile.bundles) {
      const src = sourcesMap[bundleRef.source];
      if (!src) {
        continue;
      }
      const sourceId = generateSourceId(src.type, src.url);
      const writtenFiles = out.written[t] || [];
      const relativeFiles: string[] = [];
      const fileChecksums: Record<string, string> = {};
      for (const f of writtenFiles) {
        const relativePath = path.relative(ctx.cwd(), f);
        relativeFiles.push(relativePath);
        const bytes = await ctx.fs.readFile(f);
        const crypto = await import('node:crypto');
        fileChecksums[relativePath] = crypto.createHash('sha256').update(bytes).digest('hex');
      }
      nextLock = upsertEntry(nextLock, {
        target: t,
        sourceId,
        bundleId: bundleRef.id,
        bundleVersion: bundleRef.version === 'latest' ? out.state.syncedBundleVersions[bundleRef.id] : bundleRef.version,
        installedAt: new Date().toISOString(),
        files: relativeFiles,
        fileChecksums
      });
      nextLock = upsertSource(nextLock, sourceId, { type: src.type, url: src.url });
    }
  }
  await writeLockfile(lockPath, nextLock, ctx.fs);
}

/**
 * Remove all files listed in the lockfile and wipe entries on deactivation.
 * @param ctx CLI context.
 * @param lockPath Path to the lockfile.
 */
async function cleanupDeactivatedLockfile(ctx: Context, lockPath: string): Promise<void> {
  if (!await ctx.fs.exists(lockPath)) {
    return;
  }
  const existing = await readLockfile(lockPath, ctx.fs);
  for (const entry of existing.entries) {
    for (const f of entry.files) {
      const filePath = path.join(ctx.cwd(), f);
      try {
        await ctx.fs.remove(filePath);
      } catch {
        // Best-effort removal
      }
    }
    const dirs = new Set(entry.files.map((f) => path.dirname(f)));
    for (const d of dirs) {
      try {
        const dirPath = path.join(ctx.cwd(), d);
        const entries = await ctx.fs.readDir(dirPath);
        if (entries.length === 0) {
          await ctx.fs.remove(dirPath);
        }
      } catch {
        // Best-effort cleanup
      }
    }
  }
  await writeLockfile(lockPath, { ...existing, entries: [], useProfile: undefined }, ctx.fs);
}

const failWith = (ctx: Context, fmt: OutputFormat, err: RegistryError): number => {
  if (fmt === 'json' || fmt === 'yaml' || fmt === 'ndjson') {
    formatOutput({ ctx, command: 'profile', output: fmt, status: 'error', errors: [err.toJSON()], data: {}, textRenderer: () => '' });
  } else {
    renderError(err, ctx);
  }
  return 1;
};

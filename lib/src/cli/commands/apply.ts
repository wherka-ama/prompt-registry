/**
 * F-11 — `apply` command.
 *
 * Idempotent "make the system match the config" entry point.
 * Reads `prompt-registry.lock.json` for the recorded profile, syncs
 * the active hub (unless `--no-sync`), and re-activates the profile.
 *
 * Intended for CI and post-clone developer setup:
 *   prompt-registry apply
 */
import * as path from 'node:path';
import {
  HubManager,
  ProfileActivator,
  resolveUserConfigPaths,
} from '../../app/registry';
import {
  type Profile,
} from '../../domain/registry/profile';
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
  type Lockfile,
  type LockfileSource,
  readLockfile,
  upsertEntry,
  upsertSource,
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
  type CommandDefinition,
  type Context,
  defineCommand,
  failWith,
  formatOutput,
  type OutputFormat,
  RegistryError,
} from '../framework';

/**
 * Apply command options.
 */
export interface ApplyOptions {
  output?: OutputFormat;
  /** Skip hub sync (useful in offline/CI environments). */
  noSync?: boolean;
  /** Force hub sync even if recently synced. */
  force?: boolean;
}

/**
 * Build hub manager with dependencies.
 * @param ctx CLI context.
 * @param _opts Apply options.
 * @returns HubManager instance.
 */
function buildHubManager(ctx: Context, _opts: ApplyOptions): HubManager {
  const userPaths = resolveUserConfigPaths(ctx.env);
  const httpClient = new NodeHttpClient();
  const tokenProvider = envTokenProvider(ctx.env);
  const resolver = new CompositeHubResolver(
    new GitHubHubResolver(httpClient, tokenProvider),
    new LocalHubResolver(ctx.fs),
    new UrlHubResolver(httpClient, tokenProvider)
  );
  return new HubManager(
    new HubStore(userPaths.hubs, ctx.fs),
    new ActiveHubStore(userPaths.activeHub, ctx.fs),
    resolver
  );
}

/**
 * Sync hub with error handling.
 * @param mgr HubManager instance.
 * @param hubId Hub ID.
 * @param ctx CLI context.
 * @param noSync Skip sync flag.
 */
async function syncHubSafe(mgr: HubManager, hubId: string, ctx: Context, noSync?: boolean): Promise<void> {
  if (!noSync) {
    try {
      await mgr.syncHub(hubId);
    } catch {
      ctx.stderr.write(`warn: hub sync failed for "${hubId}", continuing with cached config\n`);
    }
  }
}

/**
 * Validate hub and profile configuration.
 * @param mgr HubManager instance.
 * @param hubId Hub ID.
 * @param profileId Profile ID.
 * @param _ctx CLI context.
 * @param _fmt Output format.
 * @returns Profile object.
 */
async function validateHubAndProfile(
  mgr: HubManager,
  hubId: string,
  profileId: string,
  _ctx: Context,
  _fmt: OutputFormat
): Promise<Profile> {
  const active = await mgr.getActiveHub();
  if (active?.id !== hubId) {
    throw new RegistryError({
      code: 'HUB.NOT_FOUND',
      message: `apply: hub "${hubId}" is not active`,
      hint: `Run \`prompt-registry hub use ${hubId}\` first.`
    });
  }

  const profile = active.config.profiles.find((p) => p.id === profileId);
  if (profile === undefined) {
    throw new RegistryError({
      code: 'BUNDLE.NOT_FOUND',
      message: `apply: profile "${profileId}" not found in hub "${hubId}"`,
      hint: 'Run `prompt-registry profile list` to see available profiles.'
    });
  }
  return profile;
}

/**
 * Update lockfile with bundle checksums.
 * @param lock Current lockfile.
 * @param out Activation output.
 * @param out.state
 * @param out.state.syncedTargets
 * @param out.state.syncedBundleVersions
 * @param out.written
 * @param profile Profile object.
 * @param sources Sources map.
 * @param ctx CLI context.
 * @returns Updated lockfile.
 */
async function updateLockfileWithChecksums(
  lock: Lockfile,
  out: { state: { syncedTargets: string[]; syncedBundleVersions: Record<string, string> }; written: Record<string, string[]> },
  profile: Profile,
  sources: Record<string, LockfileSource>,
  ctx: Context
): Promise<Lockfile> {
  let nextLock = lock;
  for (const t of out.state.syncedTargets) {
    for (const bundleRef of profile.bundles) {
      const src = sources[bundleRef.source];
      if (!src) {
        continue;
      }
      const sourceId = generateSourceId(src.type, src.url);
      const writtenFiles = out.written[t] ?? [];
      const checksums: Record<string, string> = {};
      const crypto = await import('node:crypto');
      for (const f of writtenFiles) {
        const bytes = await ctx.fs.readFile(f);
        checksums[f] = crypto.createHash('sha256').update(bytes).digest('hex');
      }
      nextLock = upsertEntry(nextLock, {
        target: t,
        sourceId,
        bundleId: bundleRef.id,
        bundleVersion: bundleRef.version === 'latest'
          ? out.state.syncedBundleVersions[bundleRef.id]
          : bundleRef.version,
        installedAt: new Date().toISOString(),
        files: writtenFiles,
        fileChecksums: checksums
      });
      nextLock = upsertSource(nextLock, sourceId, { type: src.type, url: src.url });
    }
  }
  return nextLock;
}

export const createApplyCommand = (opts: ApplyOptions = {}): CommandDefinition =>
  defineCommand({
    path: ['apply'],
    description: 'Idempotent: sync active hub and re-activate profile recorded in the lockfile.',
    category: 'Workflow',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';

      const lockPath = path.join(ctx.cwd(), 'prompt-registry.lock.json');
      const lock = await readLockfile(lockPath, ctx.fs);

      if (!lock.useProfile) {
        return failWith(ctx, fmt, 'apply', new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'apply: no profile recorded in lockfile',
          hint: 'Run `prompt-registry profile activate <profileId>` first to record a profile.'
        }));
      }

      const { hubId, profileId } = lock.useProfile;
      const mgr = buildHubManager(ctx, opts);
      await syncHubSafe(mgr, hubId, ctx, opts.noSync);

      // Type is validated by validateHubAndProfile
      let profile: Profile;
      try {
        profile = await validateHubAndProfile(mgr, hubId, profileId, ctx, fmt);
      } catch (err) {
        if (err instanceof RegistryError) {
          return failWith(ctx, fmt, 'apply', err);
        }
        throw err;
      }

      const targets = await readTargets({ cwd: ctx.cwd(), fs: ctx.fs });
      if (targets.length === 0) {
        return failWith(ctx, fmt, 'apply', new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'apply: no targets configured',
          hint: 'Run `prompt-registry target add <name>` to configure a target.'
        }));
      }

      const userPaths = resolveUserConfigPaths(ctx.env);
      const httpClient = new NodeHttpClient();
      const tokenProvider = envTokenProvider(ctx.env);
      const activations = new ProfileActivationStore(userPaths.profileActivations, ctx.fs);
      const prev = await activations.getActive();
      if (prev !== null) {
        await activations.remove(prev.hubId, prev.profileId);
      }

      const activator = new ProfileActivator({ fs: ctx.fs, env: ctx.env, http: httpClient, tokens: tokenProvider });
      const sources = Object.fromEntries((await mgr.listSources(hubId)).map((s) => [s.id, s]));

      const out = await activator.activate({ hubId, profile, sources, targets });
      await activations.save(out.state);

      const nextLock = await updateLockfileWithChecksums(lock, out, profile, sources, ctx);
      await writeLockfile(lockPath, nextLock, ctx.fs);

      formatOutput({
        ctx,
        command: 'apply',
        output: fmt,
        status: 'ok',
        data: {
          hubId,
          profileId,
          synced: !opts.noSync,
          bundles: out.state.syncedBundles,
          targets: out.state.syncedTargets
        },
        textRenderer: (d) => `Applied: hub "${d.hubId}" → profile "${d.profileId}"\n`
          + `  Bundles: ${d.bundles.join(', ')}\n`
          + `  Targets: ${d.targets.join(', ')}\n`
      });
      return 0;
    }
  });

/**
 * Phase 4 / Iter 31 — `install` stub (Phase 5 preview).
 *
 * The install command is the primary deliverable of Phase 5
 * (environment-agnostic install). Iter 31 ships the surface so the
 * migration guide can mention it; Phase 5 fills the body.
 *
 * Final shape (per spec §14.1):
 *   prompt-registry install <bundle>            (imperative)
 *   prompt-registry install --lockfile <path>   (declarative from a lockfile)
 */
import * as path from 'node:path';
import type {
  Target,
} from '../../domain/install';
import {
  checksumFiles,
} from '../../install/checksum';
import {
  GitHubBundleResolver,
} from '../../install/github-resolver';
import {
  envTokenProvider,
  type HttpClient,
  type TokenProvider,
} from '../../install/http';
import {
  HttpsBundleDownloader,
} from '../../install/https-downloader';
import {
  readLocalBundle,
} from '../../install/local-dir-source';
import {
  type LockfileEntry,
  type LockfileSource,
  readLockfile,
  upsertEntry,
  upsertSource,
  writeLockfile,
} from '../../install/lockfile';
import {
  validateManifest,
} from '../../install/manifest-validator';
import {
  NodeHttpClient,
} from '../../install/node-http-client';
import {
  type RepositoryCommitMode,
  RepositoryScopeWriter,
  RepositoryScopeWriterAdapter,
} from '../../install/repository-scope-writer';
import {
  parseBundleSpec,
} from '../../install/spec-parser';
import {
  TargetStateStore,
} from '../../install/target-state-store';
import {
  readTargets,
} from '../../install/target-store';
import {
  FileTreeTargetWriter,
  type TargetWriter,
} from '../../install/target-writer';
import {
  YauzlBundleExtractor,
} from '../../install/yauzl-extractor';
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
 * Install command options.
 */
export interface InstallOptions {
  output?: OutputFormat;
  /** Bundle id to install (imperative mode). */
  bundle?: string;
  /** Lockfile path (declarative mode). */
  lockfile?: string;
  /** Target name (resolved against `targets[]` in config). */
  target?: string;
  /**
   * Path to an already-built bundle directory. When set, the install
   * command bypasses resolve/download/extract and reads files from
   * the directory directly. Useful for dev workflows where the
   * user just ran `prompt-registry bundle build`.
   */
  from?: string;
  /** Dry-run: validate + plan the install but write nothing. */
  dryRun?: boolean;
  /**
   * Comma-separated allowlist of target names this run is permitted
   * to write to. Defense-in-depth for CI; refuses any --target outside
   * the set even if the target is configured. Spec sec 9.2.1.
   */
  allowTarget?: string;
  /**
   * Phase 5 spillover / iter 31: Optional source slug for the
   * remote install path. When `<bundle>` is given without
   * `--from`, this resolves the bundle via `GitHubBundleResolver`.
   * Format: `owner/repo`. If omitted, the bundleSpec must carry
   * a sourceId of the same form (e.g. `install owner/repo:foo`).
   */
  source?: string;
  /**
   * Phase 5 spillover / iter 31: dependency-injection seam for
   * tests. Production callers leave this undefined; the install
   * command then constructs a `NodeHttpClient`. Tests pass a
   * `RecordingHttpClient` to avoid real sockets.
   */
  http?: HttpClient;
  /**
   * Phase 5 spillover / iter 31: dependency-injection seam for
   * tests. Production callers leave this undefined; the install
   * command then constructs an `envTokenProvider(ctx.env)`.
   */
  tokens?: TokenProvider;
  /**
   * Phase 1 Step 1.3: Installation scope (user or repository).
   * Overrides target's scope if specified.
   */
  scope?: 'user' | 'repository';
  /**
   * Phase 1 Step 1.3: Commit mode for repository scope.
   * Only applies when scope=repository.
   */
  commitMode?: RepositoryCommitMode;
}

/**
 * Phase 1 Step 1.3: Create a writer factory that routes to the appropriate
 * writer based on target scope.
 * - user scope → FileTreeTargetWriter
 * - repository scope → RepositoryScopeWriter
 * @param ctx CLI context.
 * @param opts Install options.
 * @returns Writer factory function.
 */
const createWriterFactory = (
  ctx: Context,
  opts: InstallOptions
): (target: Target) => TargetWriter => {
  return (target: Target): TargetWriter => {
    // Use CLI flags to override target scope if specified
    const scope = opts.scope ?? target.scope;
    const commitMode = opts.commitMode ?? target.commitMode ?? 'commit';
    const workspaceRoot = target.workspaceRoot ?? ctx.cwd();

    if (scope === 'repository') {
      const writer = new RepositoryScopeWriter({
        fs: ctx.fs,
        workspaceRoot,
        commitMode
      });
      return new RepositoryScopeWriterAdapter(writer);
    }
    // Default to FileTreeTargetWriter for user scope
    return new FileTreeTargetWriter({
      fs: ctx.fs,
      env: ctx.env
    });
  };
};

/**
 * Validate install inputs.
 * @param opts Install options.
 * @returns Validation result.
 */
function validateInstallInputs(opts: InstallOptions): { noBundle: boolean; noLockfile: boolean } {
  const noBundle = opts.bundle === undefined || opts.bundle.length === 0;
  const noLockfile = opts.lockfile === undefined || opts.lockfile.length === 0;
  return { noBundle, noLockfile };
}

/**
 * Resolve target name from options or state.
 * @param opts Install options.
 * @param ctx CLI context.
 * @returns Resolved target name.
 */
async function resolveTargetName(opts: InstallOptions, ctx: Context): Promise<string> {
  let targetName = opts.target;
  if (targetName === undefined || targetName.length === 0) {
    const stateStore = new TargetStateStore({
      fs: ctx.fs,
      statePath: path.join(ctx.cwd(), '.prompt-registry', 'target-state.json')
    });
    const lastUsed = await stateStore.getLastUsedTarget();
    if (lastUsed === null) {
      throw new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'install: --target <name> is required (no previous target found)',
        hint: 'Configure a target with `prompt-registry target add <name> --type <kind>` first.'
      });
    } else {
      targetName = lastUsed;
    }
  }
  return targetName;
}

/**
 * Check if target is in allowlist.
 * @param targetName Target name.
 * @param opts Install options.
 */
function checkAllowTarget(targetName: string, opts: InstallOptions): void {
  if (opts.allowTarget === undefined || opts.allowTarget.length === 0) {
    return;
  }
  const allowSet = new Set(
    opts.allowTarget.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  );
  if (!allowSet.has(targetName)) {
    throw new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: `install: target "${targetName}" is not in --allow-target=${opts.allowTarget}`,
      hint: 'Add it to --allow-target or unset the flag to allow any configured target.',
      context: { target: targetName, allowTarget: opts.allowTarget }
    });
  }
}

/**
 * Resolve target by name.
 * @param targetName Target name.
 * @param ctx CLI context.
 * @returns Target configuration.
 */
async function resolveTarget(targetName: string, ctx: Context): Promise<Target> {
  const targets = await readTargets({ cwd: ctx.cwd(), fs: ctx.fs });
  const target = targets.find((t) => t.name === targetName);
  if (target === undefined) {
    throw new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: `install: target "${targetName}" is not configured`,
      hint: targets.length === 0
        ? 'Run `prompt-registry target add <name> --type <kind>` to add one.'
        : `Configured targets: ${targets.map((t) => t.name).join(', ')}.`,
      context: { target: targetName }
    });
  }
  return target;
}

/**
 * Perform local install from directory.
 * @param opts Install options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function performLocalInstall(
  opts: InstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  try {
    const files = await readLocalBundle(opts.from as string, ctx.fs);
    const manifest = validateManifest(files, {
      expectedId: opts.bundle ?? '',
      expectedVersion: undefined
    });
    if (opts.dryRun === true) {
      formatOutput({
        ctx,
        command: 'install',
        output: fmt,
        status: 'ok',
        data: {
          dryRun: true,
          target: target.name,
          bundle: { id: manifest.id, version: manifest.version },
          files: [...files.keys()]
        },
        textRenderer: (d) => `Dry run: would install ${d.bundle.id}@${d.bundle.version} `
          + `(${d.files.length} file${d.files.length === 1 ? '' : 's'}) into target "${d.target}".\n`
      });
      return 0;
    }
    const writerFactory = createWriterFactory(ctx, opts);
    const writer = writerFactory(target);
    const result = await writer.write(target, files);

    const lockPath = path.join(ctx.cwd(), 'prompt-registry.lock.json');
    const existing = await readLockfile(lockPath, ctx.fs);
    const checksums = checksumFiles(files);
    const localSourceId = `local-${path.basename(opts.from as string)}`;
    const entry: LockfileEntry = {
      target: target.name,
      sourceId: localSourceId,
      bundleId: manifest.id,
      bundleVersion: manifest.version,
      installedAt: new Date().toISOString(),
      files: [...files.keys()].filter((f) => f !== 'deployment-manifest.yml'),
      fileChecksums: checksums
    };
    const scope = opts.scope ?? target.scope;
    if (scope === 'repository') {
      entry.commitMode = opts.commitMode ?? target.commitMode ?? 'commit';
    }
    let nextLock = upsertEntry(existing, entry);
    nextLock = upsertSource(nextLock, localSourceId, {
      type: 'local',
      url: path.resolve(ctx.cwd(), opts.from as string)
    });
    await writeLockfile(lockPath, nextLock, ctx.fs);

    await updateTargetState(ctx, target.name, manifest.id, manifest.version);

    formatOutput({
      ctx,
      command: 'install',
      output: fmt,
      status: 'ok',
      data: {
        target: target.name,
        bundle: { id: manifest.id, version: manifest.version },
        written: result.written,
        skipped: result.skipped,
        lockfile: lockPath
      },
      textRenderer: (d) => `Installed ${d.bundle.id}@${d.bundle.version} into target "${d.target}" `
        + `(${d.written.length} written, ${d.skipped.length} skipped). `
        + `Updated ${d.lockfile}.\n`
    });
    return 0;
  } catch (cause) {
    const raw = (cause as { code?: string }).code;
    const code = raw !== undefined && /^(BUNDLE|FS|NETWORK|USAGE|CONFIG)\.[A-Z0-9_]+$/.test(raw)
      ? raw
      : 'INTERNAL.UNEXPECTED';
    throw new RegistryError({
      code,
      message: `install: ${(cause as Error).message}`,
      hint: 'Run `prompt-registry doctor` for environment diagnostics.',
      context: { from: opts.from },
      cause: cause instanceof Error ? cause : undefined
    });
  }
}

/**
 * Perform lockfile-based install.
 * @param opts Install options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function performLockfileInstall(
  opts: InstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  const lockfile = opts.lockfile as string;
  const lockPath = path.isAbsolute(lockfile)
    ? lockfile
    : path.join(ctx.cwd(), lockfile);
  const lock = await readLockfile(lockPath, ctx.fs);
  const matching = lock.entries.filter((e) => e.target === target.name);
  const sources = lock.sources ?? {};
  const http = opts.http ?? new NodeHttpClient();
  const tokens = opts.tokens ?? envTokenProvider(ctx.env);
  const writerFactory = createWriterFactory(ctx, opts);
  const writer = writerFactory(target);

  const { replayed, failures } = await replayLockfileEntries(
    matching,
    sources,
    http,
    tokens,
    writer,
    target,
    ctx
  );

  if (replayed.length > 0) {
    await updateTargetStateFromLockfile(ctx, target.name, matching, replayed);
  }

  const profileLink = lock.useProfile;
  const status = failures.length === 0 ? 'ok' : 'warning';
  formatOutput({
    ctx,
    command: 'install',
    output: fmt,
    status,
    data: {
      lockfile: lockPath,
      target: target.name,
      replayPlanned: matching.length,
      replayed,
      failures,
      useProfile: profileLink ?? null
    },
    warnings: failures.length > 0
      ? failures.map((f) => `${f.bundleId}: ${f.reason}`)
      : undefined,
    textRenderer: (d) => {
      let suffix: string;
      if (d.failures.length === 0) {
        suffix = '.\n';
      } else {
        const plural = d.failures.length === 1 ? '' : 's';
        suffix = `; ${d.failures.length} failure${plural}:\n`
          + d.failures.map((f) => `  - ${f.bundleId}: ${f.reason}\n`).join('');
      }
      return `Replay: ${d.replayed.length}/${d.replayPlanned} bundles installed `
        + `into target "${d.target}"` + suffix;
    }
  });
  return failures.length === 0 ? 0 : 1;
}

/**
 * Perform remote install from GitHub.
 * @param opts Install options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function performRemoteInstall(
  opts: InstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  try {
    const spec = parseBundleSpec(opts.bundle as string);
    const repoSlug = opts.source ?? spec.sourceId;
    if (repoSlug === undefined || repoSlug.length === 0) {
      throw new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'install: a remote install needs --source <owner/repo> (or `install owner/repo:<bundleId>`).',
        hint: 'Examples:\n'
          + '  prompt-registry install foo --source owner/repo --target my-vscode\n'
          + '  prompt-registry install owner/repo:foo --target my-vscode\n'
          + '  prompt-registry install foo --from <localDir> --target my-vscode'
      });
    }
    const http = opts.http ?? new NodeHttpClient();
    const tokens = opts.tokens ?? envTokenProvider(ctx.env);
    const resolver = new GitHubBundleResolver({ repoSlug, http, tokens });
    const downloader = new HttpsBundleDownloader(http, tokens);
    const extractor = new YauzlBundleExtractor();

    const installable = await resolver.resolve(spec);
    if (installable === null) {
      throw new RegistryError({
        code: 'BUNDLE.NOT_FOUND',
        message: `install: ${spec.bundleId} not found at ${repoSlug}`,
        hint: 'Check the source slug and that a release with the requested version + asset (bundle.zip) exists.',
        context: { spec, repoSlug }
      });
    }
    const dl = await downloader.download(installable);
    const files = await extractor.extract(dl.bytes);
    const manifest = validateManifest(files, {
      expectedId: spec.bundleId,
      expectedVersion: spec.bundleVersion === 'latest' ? undefined : spec.bundleVersion
    });
    if (opts.dryRun === true) {
      formatOutput({
        ctx,
        command: 'install',
        output: fmt,
        status: 'ok',
        data: {
          dryRun: true,
          target: target.name,
          bundle: { id: manifest.id, version: manifest.version },
          source: { type: 'github', repo: repoSlug, downloadUrl: installable.downloadUrl },
          sha256: dl.sha256,
          files: [...files.keys()]
        },
        textRenderer: (d) => `Dry run: would install ${d.bundle.id}@${d.bundle.version} `
          + `from ${d.source.repo} (${d.files.length} file${d.files.length === 1 ? '' : 's'}) `
          + `into target "${d.target}".\n`
      });
      return 0;
    }
    const writer = new FileTreeTargetWriter({ fs: ctx.fs, env: ctx.env });
    const result = await writer.write(target, files);
    const lockPath = path.join(ctx.cwd(), 'prompt-registry.lock.json');
    const existing = await readLockfile(lockPath, ctx.fs);
    const checksums = checksumFiles(files);
    const entry: LockfileEntry = {
      target: target.name,
      sourceId: installable.ref.sourceId,
      bundleId: manifest.id,
      bundleVersion: manifest.version,
      sha256: dl.sha256,
      installedAt: new Date().toISOString(),
      files: [...files.keys()].filter((f) => f !== 'deployment-manifest.yml'),
      fileChecksums: checksums
    };
    let nextLock = upsertEntry(existing, entry);
    nextLock = upsertSource(nextLock, installable.ref.sourceId, {
      type: 'github',
      url: `https://github.com/${repoSlug}`
    });
    await writeLockfile(lockPath, nextLock, ctx.fs);

    formatOutput({
      ctx,
      command: 'install',
      output: fmt,
      status: 'ok',
      data: {
        target: target.name,
        bundle: { id: manifest.id, version: manifest.version },
        source: { type: 'github', repo: repoSlug, sourceId: installable.ref.sourceId },
        sha256: dl.sha256,
        written: result.written,
        skipped: result.skipped,
        lockfile: lockPath
      },
      textRenderer: (d) => `Installed ${d.bundle.id}@${d.bundle.version} from ${d.source.repo} `
        + `into target "${d.target}" (${d.written.length} written, ${d.skipped.length} skipped). `
        + `Updated ${d.lockfile}.\n`
    });
    return 0;
  } catch (cause) {
    const raw = (cause as { code?: string }).code;
    const code = raw !== undefined && /^(BUNDLE|FS|NETWORK|USAGE|CONFIG)\.[A-Z0-9_]+$/.test(raw)
      ? raw
      : 'NETWORK.DOWNLOAD_FAILED';
    throw new RegistryError({
      code,
      message: `install: ${(cause as Error).message}`,
      hint: 'Run `prompt-registry doctor` for environment diagnostics, or use `--from <localDir>` to install a pre-built bundle.',
      context: {
        mode: 'imperative-remote',
        bundle: opts.bundle,
        source: opts.source,
        target: opts.target
      },
      cause: cause instanceof Error ? cause : undefined
    });
  }
}

/**
 * Update target state with installed bundle.
 * @param ctx CLI context.
 * @param targetName Target name.
 * @param bundleId Bundle ID.
 * @param version Bundle version.
 */
async function updateTargetState(ctx: Context, targetName: string, bundleId: string, version: string): Promise<void> {
  const stateStore = new TargetStateStore({
    fs: ctx.fs,
    statePath: path.join(ctx.cwd(), '.prompt-registry', 'target-state.json')
  });
  const existingState = await stateStore.load(targetName);
  const newBundles = existingState?.lastInstalledBundles ?? [];
  const bundleIndex = newBundles.findIndex((b) => b.bundleId === bundleId);
  if (bundleIndex === -1) {
    newBundles.push({
      bundleId,
      version,
      installedAt: new Date().toISOString()
    });
  } else {
    newBundles[bundleIndex] = {
      bundleId,
      version,
      installedAt: new Date().toISOString()
    };
  }
  await stateStore.save({
    targetName,
    lastInstalledBundles: newBundles,
    lastUsedAt: new Date().toISOString()
  });
}

/**
 * Update target state from lockfile entries.
 * @param ctx CLI context.
 * @param targetName Target name.
 * @param matching Matching lockfile entries.
 * @param replayed Replay bundle IDs.
 */
async function updateTargetStateFromLockfile(ctx: Context, targetName: string, matching: LockfileEntry[], replayed: string[]): Promise<void> {
  const stateStore = new TargetStateStore({
    fs: ctx.fs,
    statePath: path.join(ctx.cwd(), '.prompt-registry', 'target-state.json')
  });
  const existingState = await stateStore.load(targetName);
  const newBundles = existingState?.lastInstalledBundles ?? [];
  for (const bundleId of replayed) {
    const entry = matching.find((e) => e.bundleId === bundleId);
    if (entry) {
      const bundleIndex = newBundles.findIndex((b) => b.bundleId === bundleId);
      if (bundleIndex === -1) {
        newBundles.push({
          bundleId: entry.bundleId,
          version: entry.bundleVersion,
          installedAt: entry.installedAt
        });
      } else {
        newBundles[bundleIndex] = {
          bundleId: entry.bundleId,
          version: entry.bundleVersion,
          installedAt: entry.installedAt
        };
      }
    }
  }
  await stateStore.save({
    targetName,
    lastInstalledBundles: newBundles,
    lastUsedAt: new Date().toISOString()
  });
}

/**
 * Build the `install` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createInstallCommand = (
  opts: InstallOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['install'],
    description: 'Install bundles to a configured target.',
    category: 'Installation',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      const { noBundle, noLockfile } = validateInstallInputs(opts);
      if (noBundle && noLockfile) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'install: provide either <bundle-id> (imperative) or --lockfile <path> (declarative)',
          hint: 'Examples:\n'
            + '  prompt-registry install <bundle-id>\n'
            + '  prompt-registry install --lockfile prompt-registry.lock.json'
        }));
      }

      try {
        const targetName = await resolveTargetName(opts, ctx);
        checkAllowTarget(targetName, opts);
        const target = await resolveTarget(targetName, ctx);

        if (opts.from !== undefined && opts.from.length > 0) {
          return await performLocalInstall(opts, target, ctx, fmt);
        }

        if (opts.lockfile !== undefined && opts.lockfile.length > 0) {
          return await performLockfileInstall(opts, target, ctx, fmt);
        }

        return await performRemoteInstall(opts, target, ctx, fmt);
      } catch (err) {
        if (err instanceof RegistryError) {
          return failWith(ctx, fmt, err);
        }
        throw err;
      }
    }
  });

/**
 * Fail with error in appropriate format.
 * @param ctx CLI context.
 * @param output Output format.
 * @param err Registry error.
 * @returns Exit code.
 */
const failWith = (ctx: Context, output: OutputFormat, err: RegistryError): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command: 'install',
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

/**
 * Replay lockfile entries for installation.
 * @param matching Matching lockfile entries.
 * @param sources Lockfile sources.
 * @param http HTTP client.
 * @param tokens Token provider.
 * @param writer Target writer.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @returns Replay results.
 */
async function replayLockfileEntries(
  matching: LockfileEntry[],
  sources: Record<string, LockfileSource>,
  http: HttpClient,
  tokens: TokenProvider,
  writer: TargetWriter,
  target: Target,
  ctx: Context
): Promise<{ replayed: string[]; failures: { bundleId: string; reason: string }[] }> {
  const replayed: string[] = [];
  const failures: { bundleId: string; reason: string }[] = [];

  for (const e of matching) {
    const src = sources[e.sourceId];
    if (src === undefined) {
      failures.push({
        bundleId: e.bundleId,
        reason: `source ${e.sourceId} missing from lockfile.sources`
      });
      continue;
    }
    try {
      const files = await fetchFilesForSource(src, e, http, tokens, ctx);
      if (files === null) {
        continue;
      }
      validateManifest(files, {
        expectedId: e.bundleId,
        expectedVersion: e.bundleVersion
      });
      await writer.write(target, files);
      replayed.push(e.bundleId);
    } catch (cause) {
      failures.push({
        bundleId: e.bundleId,
        reason: (cause as Error).message
      });
    }
  }

  return { replayed, failures };
}

async function fetchFilesForSource(
  src: LockfileSource,
  entry: LockfileEntry,
  http: HttpClient,
  tokens: TokenProvider,
  ctx: Context
): Promise<Map<string, Buffer> | null> {
  if (src.type === 'local') {
    const files = await readLocalBundle(src.url, ctx.fs);
    return files as unknown as Map<string, Buffer>;
  }
  if (src.type === 'github') {
    const repoSlug = src.url.replace(/^https?:\/\/github\.com\//, '');
    const resolver = new GitHubBundleResolver({ repoSlug, http, tokens });
    const downloader = new HttpsBundleDownloader(http, tokens);
    const installable = await resolver.resolve({
      bundleId: entry.bundleId,
      bundleVersion: entry.bundleVersion
    });
    if (installable === null) {
      return null;
    }
    const dl = await downloader.download(installable);
    if (entry.sha256 !== undefined && dl.sha256 !== entry.sha256) {
      return null;
    }
    const files = await new YauzlBundleExtractor().extract(dl.bytes);
    return files as unknown as Map<string, Buffer>;
  }
  return null;
}

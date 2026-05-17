/**
 * `install` stub (environment-agnostic install preview).
 *
 * The install command is the primary deliverable for
 * environment-agnostic install. This ships the surface so the
 * migration guide can mention it; the body is filled in later.
 *
 * Final shape:
 *   prompt-registry install <bundle>            (imperative)
 *   prompt-registry install --lockfile <path>   (declarative from a lockfile)
 */
import * as path from 'node:path';
import inquirer from 'inquirer';
import {
  HubManager,
  resolveUserConfigPaths,
} from '../../app/registry';
import {
  validateManifest,
} from '../../domain';
import type {
  Target,
} from '../../domain/install';
import {
  parseBundleSpec,
} from '../../domain/spec-parser';
import {
  checksumFiles,
} from '../../infra/checksum';
import {
  HttpsBundleDownloader,
} from '../../infra/downloaders/https-downloader';
import {
  YauzlBundleExtractor,
} from '../../infra/extractors/yauzl-extractor';
import {
  defaultTokenProvider,
} from '../../infra/github/token';
import {
  NodeHttpClient,
} from '../../infra/http/node-http-client';
import {
  GitHubBundleResolver,
} from '../../infra/resolvers/github-resolver';
import {
  CompositeHubResolver,
  GitHubHubResolver,
  LocalHubResolver,
  UrlHubResolver,
} from '../../infra/resolvers/hub-resolver';
import {
  readLocalBundle,
} from '../../infra/resolvers/local-resolver';
import {
  ActiveHubStore,
} from '../../infra/stores/active-hub-store';
import {
  type LockfileEntry,
  type LockfileSource,
  readLockfile,
  upsertEntry,
  upsertSource,
  writeLockfile,
} from '../../infra/stores/json-lockfile-store';
import {
  TargetStateStore,
} from '../../infra/stores/target-state-store';
import {
  readTargets,
} from '../../infra/stores/target-store';
import {
  HubStore,
} from '../../infra/stores/yaml-hub-store';
import {
  FileTreeTargetWriter,
  type TargetWriter,
} from '../../infra/writers/file-tree-writer';
import {
  type RepositoryCommitMode,
  RepositoryScopeWriter,
  RepositoryScopeWriterAdapter,
} from '../../infra/writers/repo-scope-writer';
import {
  type HttpClient,
  type TokenProvider,
} from '../../ports/http';
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
   * Optional source slug for the remote install path. When `<bundle>` is given without
   * `--from`, this resolves the bundle via `GitHubBundleResolver`.
   * Format: `owner/repo`. If omitted, the bundleSpec must carry
   * a sourceId of the same form (e.g. `install owner/repo:foo`).
   */
  source?: string;
  /**
   * Interactive mode: prompts user to select bundles from a list.
   */
  interactive?: boolean;
  /**
   * Dependency-injection seam for tests. Production callers leave this
   * undefined; the install command then constructs a `NodeHttpClient`. Tests pass a
   * `RecordingHttpClient` to avoid real sockets.
   */
  http?: HttpClient;
  /**
   * Dependency-injection seam for tests. Production callers leave this
   * undefined; the install command then constructs an `defaultTokenProvider(ctx.env)`.
   */
  tokens?: TokenProvider;
  /**
   * Installation scope (user or repository).
   * Overrides target's scope if specified.
   */
  scope?: 'user' | 'repository';
  /**
   * Commit mode for repository scope.
   * Only applies when scope=repository.
   */
  commitMode?: RepositoryCommitMode;
}

/**
 * Command context for install/uninstall commands.
 */
interface CommandContext {
  ctx: Context;
  http?: HttpClient;
  tokens?: TokenProvider;
}

/**
 * Base class for install/uninstall commands.
 */
abstract class BaseInstallCommand extends Command {
  public commandContext: CommandContext = { ctx: null as any };
  public output?: OutputFormat;
}

/**
 * Native clipanion class command for install.
 */
export class InstallCommand extends BaseInstallCommand {
  public static readonly paths = [['install']];
  // eslint-disable-next-line new-cap -- Command.Usage is a static method, not a constructor
  public static readonly usage = Command.Usage({
    description: 'Install bundles from remote sources or local directories to a configured target. Use <bundle-id> for imperative mode or --lockfile <path> for declarative mode.',
    category: 'Installation',
    details: `
      Usage: prompt-registry install [options]

      Examples:
        prompt-registry install --from <path> --target my-vscode
        prompt-registry install --lockfile prompt-registry.lock.json --target my-vscode
        prompt-registry install --source amadeus-hub --interactive --target my-vscode

      Options:
        --from <path>           Path to an already-built bundle directory
        --lockfile <path>       Path to a lockfile for declarative installation
        --target <name>         Target name to install to
        --source <hub-id>       Hub ID to list bundles from (use with --interactive for selection)
        --interactive           Interactive mode: select bundles from a list
        --dry-run               Validate and plan without writing
        --scope <scope>         Installation scope (user or repository)
        --commit-mode <mode>    Commit mode for repository scope
    `
  });

  public output = Option.String('-o', '--output') as OutputFormat | undefined;
  public from = Option.String('--from');
  public lockfile = Option.String('--lockfile');
  public target = Option.String('--target');
  public source = Option.String('--source');
  public interactive = Option.Boolean('--interactive', false);
  public dryRun = Option.Boolean('--dry-run');
  public scope = Option.String('--scope');
  public commitMode = Option.String('--commit-mode');
  public bundle = Option.String({ required: false }); // Optional positional argument

  public async execute(): Promise<number> {
    const { ctx } = this.commandContext;
    const http = this.commandContext.http ?? new NodeHttpClient();
    const tokens = this.commandContext.tokens ?? defaultTokenProvider(ctx.env);
    const fmt = (this.output ?? 'text');

    const opts: InstallOptions = {
      output: fmt,
      bundle: this.bundle,
      lockfile: this.lockfile,
      target: this.target,
      from: this.from,
      dryRun: this.dryRun,
      source: this.source,
      interactive: this.interactive,
      http,
      tokens,
      scope: this.scope as 'user' | 'repository' | undefined,
      commitMode: this.commitMode as RepositoryCommitMode | undefined
    };

    const { noBundle, noLockfile } = validateInstallInputs(opts);
    if (noBundle && noLockfile && !opts.from && !opts.source) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'install: provide either <bundle-id> (imperative), --lockfile <path> (declarative), --from <path> (local directory), or --source <hub-id> (list bundles)',
        hint: 'Examples:\n'
          + '  prompt-registry install --from <path> --target my-vscode\n'
          + '  prompt-registry install --lockfile prompt-registry.lock.json\n'
          + '  prompt-registry install --source amadeus-hub --target my-vscode'
      }));
    }

    try {
      const targetName = await resolveTargetName(opts, ctx);
      checkAllowTarget(targetName, opts);
      const target = await resolveTarget(targetName, ctx);

      await autoLocateLockfile(opts, ctx);

      const mode = determineInstallMode(opts);
      if (mode === undefined) {
        return await performRemoteInstall(opts, target, ctx, fmt);
      }

      return await executeInstallMode(mode, opts, target, ctx, fmt);
    } catch (err) {
      if (err instanceof RegistryError) {
        return failWith(ctx, fmt, err);
      }
      throw err;
    }
  }
}

/**
 * Determine the installation mode based on options.
 * @param opts Install options.
 * @returns Installation mode.
 */
function determineInstallMode(opts: InstallOptions): 'local' | 'lockfile' | 'remote' | 'interactive' | 'list' | undefined {
  const { noBundle } = validateInstallInputs(opts);
  
  if (opts.source !== undefined && opts.source.length > 0 && noBundle) {
    return opts.interactive ? 'interactive' : 'list';
  }
  if (opts.from !== undefined && opts.from.length > 0) {
    return 'local';
  }
  if (opts.lockfile !== undefined && opts.lockfile.length > 0) {
    return 'lockfile';
  }
  return 'remote';
}

/**
 * Auto-locate lockfile when no mode flag supplied.
 * @param opts Install options.
 * @param ctx CLI context.
 */
async function autoLocateLockfile(opts: InstallOptions, ctx: Context): Promise<void> {
  const { noBundle, noLockfile } = validateInstallInputs(opts);
  if (noBundle && noLockfile && !opts.from && !opts.source) {
    const foundLock = await findLockfile(ctx.cwd(), ctx.fs);
    if (foundLock !== null) {
      opts.lockfile = foundLock;
    }
  }
}

/**
 * Execute installation based on determined mode.
 * @param mode Installation mode.
 * @param opts Install options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function executeInstallMode(
  mode: string,
  opts: InstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  switch (mode) {
    case 'interactive':
      return await interactiveBundleSelection(opts, target, ctx, fmt);
    case 'list':
      return await listSourceBundles(opts, ctx, fmt);
    case 'local':
      return await performLocalInstall(opts, target, ctx, fmt);
    case 'lockfile':
      return await performLockfileInstall(opts, target, ctx, fmt);
    case 'remote':
    default:
      return await performRemoteInstall(opts, target, ctx, fmt);
  }
}

/**
 * Create a writer factory that routes to the appropriate
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
 * Find lockfile by searching current directory and parent directories.
 * @param startDir Starting directory.
 * @param fs Filesystem adapter.
 * @returns Lockfile path if found, null otherwise.
 */
async function findLockfile(startDir: string, fs: Context['fs']): Promise<string | null> {
  let currentDir = startDir;
  while (true) {
    const lockfile = path.join(currentDir, 'prompt-registry.lock.json');
    if (await fs.exists(lockfile)) {
      return lockfile;
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break; // Reached root
    }
    currentDir = parent;
  }
  return null;
}

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
 * List bundles from a hub source.
 * @param opts Install options.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function listSourceBundles(
  opts: InstallOptions,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  const hubId = opts.source as string;

  try {
    const userPaths = resolveUserConfigPaths(ctx.env);
    const httpClient = new NodeHttpClient();
    const tokenProvider = defaultTokenProvider(ctx.env);
    const resolver = new CompositeHubResolver(
      new GitHubHubResolver(httpClient, tokenProvider),
      new LocalHubResolver(ctx.fs),
      new UrlHubResolver(httpClient, tokenProvider)
    );
    const mgr = new HubManager(
      new HubStore(userPaths.hubs, ctx.fs),
      new ActiveHubStore(userPaths.activeHub, ctx.fs),
      resolver
    );

    await mgr.syncHub(hubId);
    const active = await mgr.getActiveHub();
    if (active?.id !== hubId) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'HUB.NOT_FOUND',
        message: `install: hub "${hubId}" is not active or not found`,
        hint: `Run \`prompt-registry hub use ${hubId}\` first.`
      }));
    }

    const bundles = active.config.profiles.flatMap((p: { bundles: { id: string; version: string; source: string }[] }) => p.bundles);
    formatOutput({
      ctx,
      command: 'install',
      output: fmt,
      status: 'ok',
      data: {
        hubId,
        bundles: bundles.map((b: { id: string; version: string; source: string }) => ({ id: b.id, version: b.version, source: b.source }))
      },
      textRenderer: (d) => `Available bundles in hub "${d.hubId}":\n`
        + d.bundles.map((b: { id: string; version: string; source: string }) => `  ${b.id}@${b.version} (source: ${b.source})`).join('\n')
        + '\n\nInstall with: prompt-registry install <bundle-id> --source <hub-id> --target <target>\n'
    });
    return 0;
  } catch (err) {
    if (err instanceof RegistryError) {
      return failWith(ctx, fmt, err);
    }
    return failWith(ctx, fmt, new RegistryError({
      code: 'HUB.LOAD_FAILED',
      message: `Failed to load hub "${hubId}": ${err instanceof Error ? err.message : String(err)}`,
      cause: err instanceof Error ? err : undefined
    }));
  }
}

/**
 * Interactive bundle selection and installation.
 * @param opts Install options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function interactiveBundleSelection(
  opts: InstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  const hubId = opts.source as string;

  try {
    const userPaths = resolveUserConfigPaths(ctx.env);
    const httpClient = new NodeHttpClient();
    const tokenProvider = defaultTokenProvider(ctx.env);
    const resolver = new CompositeHubResolver(
      new GitHubHubResolver(httpClient, tokenProvider),
      new LocalHubResolver(ctx.fs),
      new UrlHubResolver(httpClient, tokenProvider)
    );
    const mgr = new HubManager(
      new HubStore(userPaths.hubs, ctx.fs),
      new ActiveHubStore(userPaths.activeHub, ctx.fs),
      resolver
    );

    await mgr.syncHub(hubId);
    const active = await mgr.getActiveHub();
    if (active?.id !== hubId) {
      return failWith(ctx, fmt, new RegistryError({
        code: 'HUB.NOT_FOUND',
        message: `install: hub "${hubId}" is not active or not found`,
        hint: `Run \`prompt-registry hub use ${hubId}\` first.`
      }));
    }

    const bundles = active.config.profiles.flatMap((p: { bundles: { id: string; version: string; source: string }[] }) => p.bundles);
    const bundleChoices = bundles.map((b: { id: string; version: string; source: string }) => ({
      name: `${b.id}@${b.version} (source: ${b.source})`,
      value: b.id,
      short: b.id
    }));

    const answers = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedBundles',
        message: 'Select bundles to install:',
        choices: bundleChoices,
        validate: (input: string[]) => input.length > 0 || 'Please select at least one bundle'
      }
    ]);

    const selectedBundleIds = answers.selectedBundles as string[];
    const selectedBundles = bundles.filter((b: { id: string }) => selectedBundleIds.includes(b.id));

    ctx.stdout.write(`\nPreview: Installing ${selectedBundles.length} bundle${selectedBundles.length === 1 ? '' : 's'} to target "${target.name}"\n`);
    for (const b of selectedBundles) {
      ctx.stdout.write(`  - ${b.id}@${b.version} (source: ${b.source})\n`);
    }

    const confirm = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Proceed with installation?',
        default: true
      }
    ]);

    if (!confirm.proceed) {
      ctx.stdout.write('Installation cancelled.\n');
      return 0;
    }

    let installedCount = 0;
    for (const bundle of selectedBundles) {
      const bundleOpts = { ...opts, bundle: bundle.id };
      try {
        const result = await performRemoteInstall(bundleOpts, target, ctx, fmt);
        if (result === 0) {
          installedCount++;
        }
      } catch (err) {
        ctx.stderr.write(`Failed to install ${bundle.id}@${bundle.version}: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }

    formatOutput({
      ctx,
      command: 'install',
      output: fmt,
      status: 'ok',
      data: { installed: installedCount, total: selectedBundles.length },
      textRenderer: (d) => `Installed ${d.installed}/${d.total} bundles\n`
    });
    return 0;
  } catch (err) {
    return failWith(ctx, fmt, err instanceof Error ? new RegistryError({
      code: 'INSTALL.ERROR',
      message: err.message,
      hint: 'Check the hub configuration and try again.'
    }) : new RegistryError({
      code: 'INSTALL.ERROR',
      message: String(err),
      hint: 'Check the hub configuration and try again.'
    }));
  }
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
  const tokens = opts.tokens ?? defaultTokenProvider(ctx.env);
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
    const tokens = opts.tokens ?? defaultTokenProvider(ctx.env);
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
 * Build the `install` command (factory function for backward compatibility).
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createInstallCommand = (
  opts: InstallOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['install'],
    description: 'Install bundles from remote sources or local directories to a configured target. Use <bundle-id> for imperative mode or --lockfile <path> for declarative mode.',
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

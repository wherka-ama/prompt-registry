/**
 * Uninstall command for removing bundles from targets.
 *
 * Symmetric to install: supports three modes:
 *   prompt-registry uninstall <bundle-id>          (by bundle ID)
 *   prompt-registry uninstall --lockfile <path>  (from lockfile)
 *   prompt-registry uninstall --all               (all bundles for target)
 *
 * Uses UninstallPipeline for orchestration and updates lockfile entries.
 */
import * as path from 'node:path';
import {
  UninstallPipeline,
} from '../../app/install/uninstall-pipeline';
import {
  resolveUserConfigPaths,
} from '../../app/registry';
import type {
  Target,
} from '../../domain/install';
import {
  findLockfile,
  readLockfile,
  removeEntry,
  writeLockfile,
} from '../../infra/stores/json-lockfile-store';
import {
  TargetStateStore,
} from '../../infra/stores/target-state-store';
import {
  readTargets,
  readTargetsHierarchical,
} from '../../infra/stores/target-store';
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
  Command,
  failWith,
  Option,
} from '../framework';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
  RegistryError,
} from '../framework';

/**
 * Uninstall command options.
 */
export interface UninstallOptions {
  output?: OutputFormat;
  /** Bundle id to uninstall (imperative mode). */
  bundle?: string;
  /** Lockfile path (declarative mode). */
  lockfile?: string;
  /** Target name (resolved against `targets[]` in config). */
  target?: string;
  /** Uninstall all bundles for target. */
  all?: boolean;
  /** Dry-run: preview removal without deleting files. */
  dryRun?: boolean;
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
 * Detect uninstall context from the project environment (symmetric with install).
 * Fills in `opts.lockfile` and `opts.target` when they can be inferred.
 * @param opts Uninstall options (mutated in-place).
 * @param ctx CLI context.
 */
async function detectUninstallContext(opts: UninstallOptions, ctx: Context): Promise<void> {
  const userPaths = resolveUserConfigPaths(ctx.env);

  if (!opts.bundle && !opts.lockfile && !opts.all) {
    const foundLock = await findLockfile(ctx.cwd(), ctx.fs, userPaths.userLockfile);
    if (foundLock !== null) {
      opts.lockfile = foundLock;
    }
  }

  if (!opts.target || opts.target.length === 0) {
    const targets = await readTargetsHierarchical(
      { cwd: ctx.cwd(), fs: ctx.fs },
      userPaths.userTargets
    ).catch(() => []);
    if (targets.length === 1) {
      opts.target = targets[0].name;
    }
  }
}

/**
 * Check if target is in allowlist.
 * @param _targetName Target name.
 * @param _opts Uninstall options.
 */
function checkAllowTarget(_targetName: string, _opts: UninstallOptions): void {
  // Uninstall doesn't have allowTarget option, so this is a no-op
  // Kept for consistency with install command
}

/**
 * Command context for install/uninstall commands.
 */
interface CommandContext {
  ctx: Context;
}

/**
 * Base class for install/uninstall commands.
 */
abstract class BaseUninstallCommand extends Command {
  public commandContext: CommandContext = { ctx: null as any };
  public output?: OutputFormat;
}

/**
 * Native clipanion class command for uninstall.
 */
export class UninstallCommand extends BaseUninstallCommand {
  public static readonly paths = [['uninstall']];
  // eslint-disable-next-line new-cap -- Command.Usage is a static method, not a constructor
  public static readonly usage = Command.Usage({
    description: 'Remove bundles from a configured target. Use <bundle-id> to uninstall a specific bundle, --lockfile <path> to uninstall from a lockfile, or --all to remove all bundles.',
    category: 'Installation',
    details: `
      Usage: prompt-registry uninstall [options]

      Examples:
        prompt-registry uninstall --lockfile prompt-registry.lock.json --target my-vscode
        prompt-registry uninstall --all --target my-vscode
        prompt-registry uninstall --dry-run --target my-vscode

      Options:
        --bundle <id>          Bundle id to uninstall
        --lockfile <path>      Path to a lockfile for declarative uninstallation
        --target <name>        Target name to uninstall from
        --all                  Remove all bundles for target
        --dry-run              Preview removal without deleting files
        --scope <scope>        Installation scope (user or repository)
        --commit-mode <mode>   Commit mode for repository scope
    `
  });

  public output = Option.String('-o', '--output') as OutputFormat | undefined;
  public bundle = Option.String('--bundle');
  public lockfile = Option.String('--lockfile');
  public target = Option.String('--target');
  public all = Option.Boolean('--all');
  public dryRun = Option.Boolean('--dry-run');
  public scope = Option.String('--scope');
  public commitMode = Option.String('--commit-mode');

  public async execute(): Promise<number> {
    const { ctx } = this.commandContext;
    const fmt = (this.output ?? 'text');

    const opts: UninstallOptions = {
      output: fmt,
      bundle: this.bundle,
      lockfile: this.lockfile,
      target: this.target,
      all: this.all,
      dryRun: this.dryRun,
      scope: this.scope as 'user' | 'repository' | undefined,
      commitMode: this.commitMode as RepositoryCommitMode | undefined
    };

    await detectUninstallContext(opts, ctx);

    const { noBundle, noLockfile, noAll } = validateUninstallInputs(opts);
    if (noBundle && noLockfile && noAll) {
      return failWith(ctx, fmt, 'uninstall', new RegistryError({
        code: 'USAGE.MISSING_FLAG',
        message: 'uninstall: provide <bundle-id>, --lockfile <path>, or --all',
        hint: 'Examples:\n'
          + '  prompt-registry uninstall <bundle-id> --target my-vscode\n'
          + '  prompt-registry uninstall --lockfile prompt-registry.lock.json\n'
          + '  prompt-registry uninstall --all\n\n'
          + 'Note: Lockfile is auto-detected in current directory and parent directories.'
      }));
    }

    try {
      const targetName = await resolveTargetName(opts, ctx);
      checkAllowTarget(targetName, opts);
      const target = await resolveTarget(targetName, ctx);

      if (opts.lockfile !== undefined && opts.lockfile.length > 0) {
        return await performLockfileUninstall(opts, target, ctx, fmt);
      }

      if (opts.all) {
        return await performAllUninstall(opts, target, ctx, fmt);
      }

      return await performBundleUninstall(opts, target, ctx, fmt);
    } catch (err) {
      if (err instanceof RegistryError) {
        return failWith(ctx, fmt, 'uninstall', err);
      }
      throw err;
    }
  }
}

/**
 * Create a writer factory that routes to the appropriate writer based on target scope.
 * - user scope → FileTreeTargetWriter
 * - repository scope → RepositoryScopeWriter
 * @param ctx CLI context.
 * @param opts Uninstall options.
 * @returns Writer factory function.
 */
const createWriterFactory = (
  ctx: Context,
  opts: UninstallOptions
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
 * Validate uninstall inputs.
 * @param opts Uninstall options.
 * @returns Validation result.
 */
function validateUninstallInputs(opts: UninstallOptions): { noBundle: boolean; noLockfile: boolean; noAll: boolean } {
  const noBundle = opts.bundle === undefined || opts.bundle.length === 0;
  const noLockfile = opts.lockfile === undefined || opts.lockfile.length === 0;
  const noAll = opts.all !== true;
  return { noBundle, noLockfile, noAll };
}

/**
 * Resolve target name from options or state.
 * @param opts Uninstall options.
 * @param ctx CLI context.
 * @returns Resolved target name.
 */
async function resolveTargetName(opts: UninstallOptions, ctx: Context): Promise<string> {
  const targetName = opts.target;
  if (targetName === undefined || targetName.length === 0) {
    const stateStore = new TargetStateStore({
      fs: ctx.fs,
      statePath: path.join(ctx.cwd(), '.prompt-registry', 'target-state.json')
    });
    const lastUsed = await stateStore.getLastUsedTarget();
    if (lastUsed !== null) {
      return lastUsed;
    }
    const configuredTargets = await readTargets({ cwd: ctx.cwd(), fs: ctx.fs }).catch(() => []);
    const hint = configuredTargets.length > 1
      ? `Multiple targets configured: ${configuredTargets.map((t) => t.name).join(', ')}. Specify with --target <name>.`
      : 'Configure a target with `prompt-registry target add <name> --type <kind>` first.';
    throw new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: 'uninstall: --target <name> is required',
      hint
    });
  }
  return targetName;
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
      message: `uninstall: target "${targetName}" is not configured`,
      hint: targets.length === 0
        ? 'Run `prompt-registry target add <name> --type <kind>` to add one.'
        : `Configured targets: ${targets.map((t) => t.name).join(', ')}.`,
      context: { target: targetName }
    });
  }
  return target;
}

/**
 * Perform uninstall by bundle ID.
 * @param opts Uninstall options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function performBundleUninstall(
  opts: UninstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  const bundleId = opts.bundle as string;
  const lockPath = path.join(ctx.cwd(), 'prompt-registry.lock.json');
  const lock = await readLockfile(lockPath, ctx.fs);
  const entry = lock.entries.find((e) => e.target === target.name && e.bundleId === bundleId);

  if (entry === undefined) {
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'warning',
      data: {
        target: target.name,
        bundle: bundleId,
        reason: 'not found in lockfile'
      },
      textRenderer: (d) => `Bundle "${d.bundle}" is not installed in target "${d.target}". Nothing to uninstall.\n`
    });
    return 0;
  }

  // Dry-run: show what would be removed without deleting
  if (opts.dryRun === true) {
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'ok',
      data: {
        dryRun: true,
        target: target.name,
        bundle: bundleId,
        files: entry.files
      },
      textRenderer: (d) => `[dry-run] Would uninstall bundle "${d.bundle}" from target "${d.target}":\n`
        + `  Files: ${d.files.join(', ')}\n`
        + 'Run without --dry-run to apply.\n'
    });
    return 0;
  }

  const writerFactory = createWriterFactory(ctx, opts);
  const pipeline = new UninstallPipeline({
    fs: ctx.fs,
    target,
    lockfile: lockPath,
    writerFactory
  });

  const result = await pipeline.run(bundleId);

  // Remove entry from lockfile
  const nextLock = removeEntry(lock, entry);
  await writeLockfile(lockPath, nextLock, ctx.fs);

  // Update target state
  await updateTargetState(ctx, target.name, bundleId);

  formatOutput({
    ctx,
    command: 'uninstall',
    output: fmt,
    status: 'ok',
    data: {
      target: target.name,
      bundle: bundleId,
      removed: result.removed,
      lockfile: lockPath
    },
    textRenderer: (d) => `Uninstalled ${d.bundle} from target "${d.target}" `
      + `(${d.removed.length} file${d.removed.length === 1 ? '' : 's'} removed). `
      + `Updated ${d.lockfile}.\n`
  });
  return 0;
}

/**
 * Perform uninstall from lockfile.
 * @param opts Uninstall options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function performLockfileUninstall(
  opts: UninstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  const lockfile = opts.lockfile as string;
  const lockPath = path.isAbsolute(lockfile)
    ? lockfile
    : path.join(ctx.cwd(), lockfile);
  const lock = await readLockfile(lockPath, ctx.fs);

  // Dry-run: show what would be removed without deleting
  if (opts.dryRun === true) {
    const entries = lock.entries.filter((e) => e.target === target.name);
    const allFiles = entries.flatMap((e) => e.files);
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'ok',
      data: {
        dryRun: true,
        lockfile: lockPath,
        target: target.name,
        bundles: entries.map((e) => e.bundleId),
        files: allFiles
      },
      textRenderer: (d) => `[dry-run] Would uninstall ${d.bundles.length} bundle${d.bundles.length === 1 ? '' : 's'} from target "${d.target}" (from ${d.lockfile}):\n`
        + `  Bundles: ${d.bundles.join(', ')}\n`
        + `  Files: ${d.files.length} total\n`
        + 'Run without --dry-run to apply.\n'
    });
    return 0;
  }

  const writerFactory = createWriterFactory(ctx, opts);
  const pipeline = new UninstallPipeline({
    fs: ctx.fs,
    target,
    lockfile: lockPath,
    writerFactory
  });

  const results = await pipeline.runFromLockfile();

  if (results.length === 0) {
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'ok',
      data: {
        lockfile: lockPath,
        target: target.name,
        uninstalled: 0
      },
      textRenderer: (d) => `No bundles found to uninstall from target "${d.target}".\n`
    });
    return 0;
  }

  formatOutput({
    ctx,
    command: 'uninstall',
    output: fmt,
    status: 'ok',
    data: {
      lockfile: lockPath,
      target: target.name,
      uninstalled: results.length,
      bundles: results.map((r) => ({ id: r.bundleId, removed: r.removed.length }))
    },
    textRenderer: (d) => `Uninstalled ${d.uninstalled} bundle${d.uninstalled === 1 ? '' : 's'} `
      + `from target "${d.target}" (from ${d.lockfile}).\n`
  });
  return 0;
}

/**
 * Perform uninstall of all bundles for target.
 * @param opts Uninstall options.
 * @param target Target configuration.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function performAllUninstall(
  opts: UninstallOptions,
  target: Target,
  ctx: Context,
  fmt: OutputFormat
): Promise<number> {
  const lockPath = path.join(ctx.cwd(), 'prompt-registry.lock.json');
  const lock = await readLockfile(lockPath, ctx.fs);
  const entries = lock.entries.filter((e) => e.target === target.name);

  // Dry-run: show what would be removed without deleting
  if (opts.dryRun === true) {
    const allFiles = entries.flatMap((e) => e.files);
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'ok',
      data: {
        dryRun: true,
        target: target.name,
        bundles: entries.map((e) => e.bundleId),
        files: allFiles
      },
      textRenderer: (d) => `[dry-run] Would uninstall all bundles from target "${d.target}":\n`
        + `  Bundles: ${d.bundles.join(', ')}\n`
        + `  Files: ${d.files.length} total\n`
        + 'Run without --dry-run to apply.\n'
    });
    return 0;
  }

  const writerFactory = createWriterFactory(ctx, opts);
  const pipeline = new UninstallPipeline({
    fs: ctx.fs,
    target,
    lockfile: lockPath,
    writerFactory
  });

  const results = await pipeline.runAll();

  if (results.length === 0) {
    formatOutput({
      ctx,
      command: 'uninstall',
      output: fmt,
      status: 'ok',
      data: {
        target: target.name,
        uninstalled: 0
      },
      textRenderer: (d) => `No bundles installed in target "${d.target}". Nothing to uninstall.\n`
    });
    return 0;
  }

  // Update target state (clear all bundles)
  const stateStore = new TargetStateStore({
    fs: ctx.fs,
    statePath: path.join(ctx.cwd(), '.prompt-registry', 'target-state.json')
  });
  await stateStore.save({
    targetName: target.name,
    lastInstalledBundles: [],
    lastUsedAt: new Date().toISOString()
  });

  formatOutput({
    ctx,
    command: 'uninstall',
    output: fmt,
    status: 'ok',
    data: {
      target: target.name,
      uninstalled: results.length,
      bundles: results.map((r) => ({ id: r.bundleId, removed: r.removed.length }))
    },
    textRenderer: (d) => `Uninstalled ${d.uninstalled} bundle${d.uninstalled === 1 ? '' : 's'} `
      + `from target "${d.target}".\n`
  });
  return 0;
}

/**
 * Update target state by removing bundle.
 * @param ctx CLI context.
 * @param targetName Target name.
 * @param bundleId Bundle ID to remove.
 */
async function updateTargetState(ctx: Context, targetName: string, bundleId: string): Promise<void> {
  const stateStore = new TargetStateStore({
    fs: ctx.fs,
    statePath: path.join(ctx.cwd(), '.prompt-registry', 'target-state.json')
  });
  const existingState = await stateStore.load(targetName);
  const newBundles = existingState?.lastInstalledBundles ?? [];
  const bundleIndex = newBundles.findIndex((b) => b.bundleId === bundleId);
  if (bundleIndex !== -1) {
    newBundles.splice(bundleIndex, 1);
  }
  await stateStore.save({
    targetName,
    lastInstalledBundles: newBundles,
    lastUsedAt: new Date().toISOString()
  });
}

/**
 * Build the `uninstall` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createUninstallCommand = (
  opts: UninstallOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['uninstall'],
    description: 'Remove bundles from a configured target. Use <bundle-id> to uninstall a specific bundle, --lockfile <path> to uninstall from a lockfile, or --all to remove all bundles.',
    category: 'Installation',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      const { noBundle, noLockfile, noAll } = validateUninstallInputs(opts);
      if (noBundle && noLockfile && noAll) {
        return failWith(ctx, fmt, 'uninstall', new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'uninstall: provide <bundle-id>, --lockfile <path>, or --all',
          hint: 'Examples:\n'
            + '  prompt-registry uninstall <bundle-id> --target my-vscode\n'
            + '  prompt-registry uninstall --lockfile prompt-registry.lock.json\n'
            + '  prompt-registry uninstall --all --target my-vscode'
        }));
      }

      try {
        const targetName = await resolveTargetName(opts, ctx);
        const target = await resolveTarget(targetName, ctx);

        if (opts.all === true) {
          return await performAllUninstall(opts, target, ctx, fmt);
        }

        if (opts.lockfile !== undefined && opts.lockfile.length > 0) {
          return await performLockfileUninstall(opts, target, ctx, fmt);
        }

        return await performBundleUninstall(opts, target, ctx, fmt);
      } catch (err) {
        if (err instanceof RegistryError) {
          return failWith(ctx, fmt, 'uninstall', err);
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

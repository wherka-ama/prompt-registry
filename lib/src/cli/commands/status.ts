/**
 * `prompt-registry status` — show current configuration state at a glance.
 *
 * Reads targets, active hub, primitive index, and lockfile to produce
 * a concise dashboard without any network calls. Useful for verifying
 * that a project is correctly configured before activating profiles.
 */
import * as path from 'node:path';
import {
  resolveUserConfigPaths,
} from '../../app/registry';
import {
  defaultIndexFile,
} from '../../infra/harvest/default-paths';
import {
  ActiveHubStore,
} from '../../infra/stores/active-hub-store';
import {
  tryLoadIndex,
} from '../../infra/stores/json-index-store';
import {
  readLockfile,
} from '../../infra/stores/json-lockfile-store';
import {
  readTargets,
} from '../../infra/stores/target-store';
import {
  HubStore,
} from '../../infra/stores/yaml-hub-store';
import {
  Command,
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  Option,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

/** Status data shape returned to callers. */
export interface StatusData {
  targets: { name: string; type: string; scope: string }[];
  activeHubId: string | null;
  hubs: string[];
  index: { primitives: number; path: string } | null;
  lockfile: { entries: number; path: string } | null;
}

/**
 * Build the `status` command using defineCommand (for test compatibility).
 * @param opts CLI options.
 * @param opts.output Output format.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createStatusCommand = (
  opts: { output?: OutputFormat } = {}
): CommandDefinition =>
  defineCommand({
    path: ['status'],
    description: 'Show current configuration state: targets, active hub, index, and lockfile.',
    category: 'Project',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      return runStatus(ctx, opts.output ?? 'text');
    }
  });

/**
 * Status command class.
 */
export class StatusCommand extends Command {
  public static readonly paths = [['status']];
  // eslint-disable-next-line new-cap -- Command.Usage is a static method, not a constructor
  public static readonly usage = Command.Usage({
    description: 'Show current configuration state: targets, active hub, index, and lockfile.',
    category: 'Project',
    details: `
      Usage: prompt-registry status [-o json]

      Reads local config files (no network calls) and prints a summary of:
        - Configured targets
        - Active hub and available hubs
        - Primitive index size
        - Installed bundles from lockfile
    `
  });

  public output = Option.String('-o,--output');
  public commandContext!: { ctx: Context };

  public async execute(): Promise<number> {
    const { ctx } = this.commandContext;
    return runStatus(ctx, (this.output ?? 'text') as OutputFormat);
  }
}

/**
 * Core status logic shared by both command variants.
 * @param ctx CLI context.
 * @param fmt Output format.
 * @returns Exit code.
 */
async function runStatus(ctx: Context, fmt: OutputFormat): Promise<number> {
  try {
    const cwd = ctx.cwd();
    const userPaths = resolveUserConfigPaths(ctx.env);

    const [targets, hubIds, activeHubId] = await Promise.all([
      readTargets({ cwd, fs: ctx.fs }),
      readHubIds(userPaths.hubs, ctx),
      readActiveHubId(userPaths.activeHub, ctx)
    ]);

    const indexPath = defaultIndexFile(ctx.env);
    const indexStats = tryLoadIndex(indexPath);

    const lockPath = path.join(cwd, 'prompt-registry.lock.json');
    const lockfile = await ctx.fs.exists(lockPath)
      ? await readLockfile(lockPath, ctx.fs)
      : null;

    const data: StatusData = {
      targets: targets.map((t) => ({ name: t.name, type: t.type, scope: t.scope ?? 'user' })),
      activeHubId,
      hubs: hubIds,
      index: indexStats === null
        ? null
        : { primitives: indexStats.search({}).total, path: indexPath },
      lockfile: lockfile === null
        ? null
        : { entries: lockfile.entries.length, path: lockPath }
    };

    formatOutput({
      ctx,
      command: 'status',
      output: fmt,
      status: 'ok',
      data,
      textRenderer: renderStatusText
    });
    return 0;
  } catch (err) {
    if (err instanceof RegistryError) {
      renderError(err, ctx);
      return 1;
    }
    renderError(new RegistryError({
      code: 'INTERNAL.UNEXPECTED',
      message: err instanceof Error ? err.message : String(err),
      cause: err instanceof Error ? err : undefined
    }), ctx);
    return 1;
  }
}

/**
 * Read list of hub IDs from the hubs directory.
 * @param hubsDir Path to hubs directory.
 * @param ctx CLI context.
 * @returns Array of hub IDs.
 */
async function readHubIds(hubsDir: string, ctx: Context): Promise<string[]> {
  try {
    const store = new HubStore(hubsDir, ctx.fs);
    return await store.list();
  } catch {
    return [];
  }
}

/**
 * Read the active hub ID pointer.
 * @param activeHubPath Path to active-hub.json.
 * @param ctx CLI context.
 * @returns Active hub ID or null.
 */
async function readActiveHubId(activeHubPath: string, ctx: Context): Promise<string | null> {
  try {
    const store = new ActiveHubStore(activeHubPath, ctx.fs);
    return await store.get();
  } catch {
    return null;
  }
}

/**
 * Render status as human-readable text.
 * @param d Status data.
 * @returns Rendered text.
 */
function renderStatusText(d: StatusData): string {
  const lines: string[] = ['prompt-registry status\n', '─'.repeat(40) + '\n'];

  if (d.targets.length === 0) {
    lines.push('targets     (none — run `prompt-registry target add`)\n');
  } else {
    const targetList = d.targets.map((t) => `${t.name} [${t.type}]`).join(', ');
    lines.push(`targets     ${targetList}\n`);
  }

  if (d.activeHubId === null) {
    if (d.hubs.length > 0) {
      lines.push(
        `active hub  (none — run \`prompt-registry hub use <id>\`)\n`,
        `hubs        ${d.hubs.join(', ')}\n`
      );
    } else {
      lines.push('active hub  (none — run `prompt-registry hub add <ref>`)\n');
    }
  } else {
    lines.push(`active hub  ${d.activeHubId}\n`);
  }

  if (d.index === null) {
    lines.push('index       (none — run `prompt-registry index build`)\n');
  } else {
    lines.push(`index       ${d.index.primitives} primitives  [${d.index.path}]\n`);
  }

  if (d.lockfile === null) {
    lines.push('lockfile    (none)\n');
  } else {
    lines.push(`lockfile    ${d.lockfile.entries} bundle${d.lockfile.entries === 1 ? '' : 's'} installed  [${d.lockfile.path}]\n`);
  }

  return lines.join('');
}

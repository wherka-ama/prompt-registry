/**
 * Phase 4 / Iter 24 — `plugins list` subcommand.
 *
 * Discovers `prompt-registry-<name>` executables on `$PATH` per
 * decision D5 (kubectl/gh model). Each match becomes a plugin
 * candidate; dashes in the filename map to nested subcommands at
 * dispatch time (not implemented in iter 24).
 *
 * Iter 24 ships discovery only — invocation is deferred to a later
 * iter when the dispatcher knows how to spawn matched plugins.
 *
 * The lookup walks every directory in PATH and reports the first
 * match for each plugin name, mirroring how the shell's PATH search
 * works. Conflicts are flagged as warnings.
 */
import * as path from 'node:path';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
} from '../framework';

interface PluginRecord {
  name: string;
  source: string;
  conflicts: string[];
}

export interface PluginsListOptions {
  output?: OutputFormat;
}

const PLUGIN_PREFIX = 'prompt-registry-';

/**
 * Build the `plugins list` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createPluginsListCommand = (
  opts: PluginsListOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['plugins', 'list'],
    description: 'List `prompt-registry-<name>` plugins discovered on $PATH (kubectl-style).',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const pathVar = ctx.env.PATH ?? '';
      const dirs = pathVar.split(path.delimiter).filter((d) => d.length > 0);
      const plugins = new Map<string, PluginRecord>();
      for (const dir of dirs) {
        if (!(await ctx.fs.exists(dir))) {
          continue;
        }
        let entries: string[];
        try {
          entries = await ctx.fs.readDir(dir);
        } catch {
          continue;
        }
        for (const filename of entries) {
          if (!filename.startsWith(PLUGIN_PREFIX)) {
            continue;
          }
          const name = filename.slice(PLUGIN_PREFIX.length);
          const fullPath = path.join(dir, filename);
          if (plugins.has(name)) {
            // PATH-conflict: prior wins (matches shell behavior).
            const existing = plugins.get(name);
            if (existing !== undefined) {
              existing.conflicts.push(fullPath);
            }
          } else {
            plugins.set(name, { name, source: fullPath, conflicts: [] });
          }
        }
      }
      const records = [...plugins.values()].toSorted((a, b) => a.name.localeCompare(b.name));
      const warnings: string[] = [];
      for (const r of records) {
        for (const c of r.conflicts) {
          warnings.push(`plugin "${r.name}" shadowed: ${c} (in use: ${r.source})`);
        }
      }
      formatOutput({
        ctx,
        command: 'plugins.list',
        output: opts.output ?? 'text',
        status: warnings.length > 0 ? 'warning' : 'ok',
        data: records,
        warnings,
        textRenderer: renderText
      });
      return 0;
    }
  });

const renderText = (records: PluginRecord[]): string => {
  if (records.length === 0) {
    return 'No plugins found on $PATH.\n  (Plugins are executables named `prompt-registry-<name>` discoverable via PATH.)\n';
  }
  return records.map((r) => `${r.name}  ${r.source}`).join('\n') + '\n';
};

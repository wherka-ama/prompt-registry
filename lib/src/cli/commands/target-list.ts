/**
 * Phase 4 / Iter 28 — `target list` stub.
 *
 * The full `target` model lives in Phase 5 (environment-agnostic
 * install). Iter 28 ships a list-only stub that reads `targets[]`
 * from the resolved config and prints what's there. Iter 29 adds
 * `target add`; iter 30 adds `target remove`. Each iter is a one-
 * file delta against the same shape.
 *
 * The point of shipping these stubs in Phase 4 is twofold:
 *   - The migration guide (iter 15) can list every command users
 *     might encounter, including ones whose semantics are not
 *     final.
 *   - When Phase 5 lands install, the command tree won't appear to
 *     "grow new top-level nouns out of nowhere" — `target` is
 *     already a documented hub.
 */
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  loadConfig,
  type OutputFormat,
} from '../framework';

interface TargetRecord {
  name: string;
  type: string;
  scope?: string;
  path?: string;
  allowedKinds?: string[];
}

/**
 * Render a target list as a fixed-width text table. Empty list is
 * rendered as a friendly message that points users at `target add`.
 * @param targets - Array of TargetRecord rows.
 * @returns Rendered table string (newline-terminated).
 */
const renderTargetTable = (targets: TargetRecord[]): string => {
  if (targets.length === 0) {
    return 'No targets configured.\n'
      + 'Add one with: `prompt-registry target add <name> --type <vscode|copilot-cli|kiro|windsurf|vscode-insiders>`\n';
  }
  const header = ['NAME', 'TYPE', 'SCOPE', 'PATH', 'ALLOWED-KINDS'];
  const rows = targets.map((t) => [
    t.name,
    t.type,
    t.scope ?? '',
    t.path ?? '',
    t.allowedKinds === undefined ? '' : t.allowedKinds.join(',')
  ]);
  const widths = header.map((h, i) => Math.max(
    h.length,
    ...rows.map((r) => r[i].length)
  ));
  const fmtRow = (r: string[]): string =>
    r.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
  return [
    fmtRow(header),
    ...rows.map((r): string => fmtRow(r))
  ].join('\n') + '\n';
};

export interface TargetListOptions {
  output?: OutputFormat;
}

/**
 * Build the `target list` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createTargetListCommand = (
  opts: TargetListOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['target', 'list'],
    description: 'List configured install targets (vscode, copilot-cli, kiro, …). Phase 5 will populate; iter 28 reads from config.',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const config = await loadConfig({
        cwd: ctx.cwd(),
        env: ctx.env,
        fs: ctx.fs
      });
      const raw = (config as { targets?: unknown }).targets;
      const targets = Array.isArray(raw)
        ? (raw as TargetRecord[])
        : [];
      formatOutput({
        ctx,
        command: 'target.list',
        output: opts.output ?? 'text',
        status: 'ok',
        data: targets,
        textRenderer: (d) => renderTargetTable(d)
      });
      return 0;
    }
  });

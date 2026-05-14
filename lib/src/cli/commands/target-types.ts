/**
 * F-10 — `target types` command.
 *
 * Lists all supported install target types with a human-readable
 * description. Removes the guessing-game of valid `--type` values
 * from `target add`.
 */
import {
  TARGET_TYPES,
} from '../../domain/install';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
} from '../framework';

/**
 * Human-readable description for each target type.
 * @internal
 */
const TARGET_DESCRIPTIONS: Record<string, string> = {
  vscode: 'VS Code (user scope — ~/.config/Code/User/prompts/)',
  'vscode-insiders': 'VS Code Insiders (user scope — ~/.config/Code - Insiders/User/prompts/)',
  'copilot-cli': 'GitHub Copilot CLI (user scope — ~/.config/github-copilot/prompts/)',
  kiro: 'Kiro IDE',
  windsurf: 'Windsurf IDE (Codeium)'
};

/**
 * Target type entry.
 */
export interface TargetTypeEntry {
  type: string;
  description: string;
}

/**
 * Target types command options.
 */
export interface TargetTypesOptions {
  output?: OutputFormat;
}

/**
 * Build the `target types` command.
 * @param opts Command options.
 * @returns CommandDefinition.
 */
export const createTargetTypesCommand = (opts: TargetTypesOptions = {}): CommandDefinition =>
  defineCommand({
    path: ['target', 'types'],
    description: 'List all supported install target types with descriptions.',
    category: 'Installation',
    // eslint-disable-next-line @typescript-eslint/require-await -- synchronous body, Promise return type required by framework contract
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const data: TargetTypeEntry[] = TARGET_TYPES.map((t) => ({
        type: t,
        description: TARGET_DESCRIPTIONS[t] ?? ''
      }));
      formatOutput({
        ctx,
        command: 'target.types',
        output: opts.output ?? 'text',
        status: 'ok',
        data,
        textRenderer: (d) => [
          'Supported target types:\n',
          ...d.map((t) => `  ${t.type.padEnd(22)} ${t.description}\n`),
          '\nUsage: prompt-registry target add <name> --type <type>\n'
        ].join('')
      });
      return 0;
    }
  });

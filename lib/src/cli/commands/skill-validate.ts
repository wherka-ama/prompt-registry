/**
 * Phase 4 / Iter 6 — `skill validate` subcommand.
 *
 * Replaces `lib/bin/validate-skills.js`. Wraps `validateAllSkills`
 * from `lib/src/skills.ts` and routes the result through the
 * framework's output formatter.
 */
import {
  type AllSkillsValidationResult,
  validateAllSkills,
} from '../..';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
} from '../framework';

export interface SkillValidateOptions {
  /** Output format. Default 'text'. */
  output?: OutputFormat;
  /** Skills directory under the cwd. Default 'skills'. */
  skillsDir?: string;
  /** Verbose mode prints each ok skill in text mode. */
  verbose?: boolean;
}

/**
 * Build the `skill validate` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createSkillValidateCommand = (
  opts: SkillValidateOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['skill', 'validate'],
    description: 'Validate every skill folder under <cwd>/skills/ against the Agent Skills spec. (Replaces `validate-skills`.)',
    run: ({ ctx }: { ctx: Context }): number => {
      const cwd = ctx.cwd();
      const result = validateAllSkills(cwd, opts.skillsDir ?? 'skills');
      formatOutput({
        ctx,
        command: 'skill.validate',
        output: opts.output ?? 'text',
        status: result.valid ? 'ok' : 'error',
        data: result,
        textRenderer: (d) => renderText(d, opts.verbose ?? false)
      });
      return result.valid ? 0 : 1;
    }
  });

const renderText = (d: AllSkillsValidationResult, verbose: boolean): string => {
  const lines: string[] = [`Validated ${d.totalSkills} skill(s): ${d.validSkills} valid, ${d.invalidSkills} invalid`];
  for (const s of d.skills) {
    if (!s.valid) {
      lines.push(`[FAIL] ${s.skillName}: ${s.errors.join('; ')}`);
    } else if (verbose) {
      lines.push(`[ OK ] ${s.skillName}`);
    }
  }
  return `${lines.join('\n')}\n`;
};

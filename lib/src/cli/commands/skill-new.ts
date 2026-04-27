/**
 * Phase 4 / Iter 5 — `skill new` subcommand.
 *
 * Replaces the non-interactive path of `lib/bin/create-skill.js`.
 * Creates a new skill folder under `<cwd>/<skillsDir>/<skillName>/`
 * containing a populated `SKILL.md`.
 *
 * The legacy binary's interactive readline wizard is **deferred** —
 * iter 8 lands `--prompt` style flag wiring, after which a follow-up
 * iter can re-introduce the wizard via `inquirer` (with the prompt
 * stream injected through `Context.stdin`/`stdout`).
 */
import {
  createSkill,
} from '../..';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

interface SkillNewData {
  skillName: string;
  path: string;
}

export interface SkillNewOptions {
  /** Output format. Default 'text'. */
  output?: OutputFormat;
  /** Skill name (required). */
  skillName: string;
  /** Description for the SKILL.md (required). */
  description: string;
  /** Skills directory under the cwd. Default 'skills'. */
  skillsDir?: string;
}

/**
 * Build the `skill new` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createSkillNewCommand = (
  opts: SkillNewOptions
): CommandDefinition =>
  defineCommand({
    path: ['skill', 'new'],
    description: 'Create a new agent skill folder + SKILL.md template. (Replaces `create-skill`.)',
    run: ({ ctx }: { ctx: Context }): number => {
      const cwd = ctx.cwd();
      const result = createSkill(cwd, opts.skillName, opts.description, opts.skillsDir ?? 'skills');
      if (!result.success) {
        const err = new RegistryError({
          code: classifyError(result.error ?? 'unknown error'),
          message: result.error ?? 'createSkill failed',
          context: { skillName: opts.skillName, path: result.path }
        });
        emitError(ctx, opts.output ?? 'text', err);
        return 1;
      }
      formatOutput({
        ctx,
        command: 'skill.new',
        output: opts.output ?? 'text',
        status: 'ok',
        data: { skillName: opts.skillName, path: result.path } satisfies SkillNewData,
        textRenderer: (d) => `Created skill at ${d.path}\n`
      });
      return 0;
    }
  });

const classifyError = (msg: string): string => {
  if (msg.includes('already exists')) {
    return 'PRIMITIVE.ALREADY_EXISTS';
  }
  if (msg.toLowerCase().includes('invalid')) {
    return 'PRIMITIVE.INVALID_NAME';
  }
  return 'PRIMITIVE.CREATE_FAILED';
};

const emitError = (ctx: Context, output: OutputFormat, err: RegistryError): void => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command: 'skill.new',
      output,
      status: 'error',
      data: null,
      errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
};

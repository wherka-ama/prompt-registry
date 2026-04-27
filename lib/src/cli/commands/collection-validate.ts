/**
 * Phase 4 / Iter 2 — `collection validate` subcommand.
 *
 * Replaces `lib/bin/validate-collections.js`. Wraps the existing
 * `validateAllCollections()` and `generateMarkdown()` helpers from
 * `lib/src/validate.ts` so we keep the validator's behavior verbatim.
 *
 * Improvements over the legacy script:
 *
 * - Goes through `Context` for the existence check + the markdown
 *   write (`ctx.fs.exists`, `ctx.fs.writeFile`).
 * - Output formatter routes via text/json/yaml/ndjson; legacy was a
 *   bespoke mix of `console.log` and `console.error`.
 * - Missing `collections/` dir fails with a `FS.NOT_FOUND`
 *   `RegistryError` (renderError → stderr in text mode; envelope
 *   error in JSON mode).
 *
 * The `validateAllCollections()` helper still uses synchronous
 * `node:fs` internally because it reads YAML files. Wrapping it in
 * `Context` would touch `lib/src/validate.ts` — Phase 3's iter-3 audit
 * said feature-layer IO stays in feature layers. Iter 8 (when the
 * config layer lands) will revisit if needed.
 */
import * as path from 'node:path';
import {
  type AllCollectionsResult,
  generateMarkdown,
  listCollectionFiles,
  validateAllCollections,
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

interface ValidateData {
  ok: boolean;
  totalFiles: number;
  fileResults: AllCollectionsResult['fileResults'];
  errors: string[];
}

export interface CollectionValidateOptions {
  /** Output format. Default 'text'. */
  output?: OutputFormat;
  /**
   * Optional path to write a PR-comment-style markdown report to.
   * Mirrors the legacy `--output-markdown` flag.
   */
  markdownPath?: string;
  /**
   * Optional explicit list of collection files (repo-relative). When
   * unset, the command lists everything under `<cwd>/collections/`.
   */
  collectionFiles?: string[];
  /** Verbose mode prints each ok file in text mode (legacy behavior). */
  verbose?: boolean;
}

/**
 * Build the `collection validate` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createCollectionValidateCommand = (
  opts: CollectionValidateOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['collection', 'validate'],
    description: 'Validate `*.collection.yml` files against the schema and check cross-collection invariants. (Replaces `validate-collections`.)',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const cwd = ctx.cwd();
      const collectionsDir = path.join(cwd, 'collections');
      if (!(await ctx.fs.exists(collectionsDir))) {
        const err = new RegistryError({
          code: 'FS.NOT_FOUND',
          message: `collections/ directory not found under ${cwd}`,
          hint: 'Run from a repo root that contains a `collections/` folder.',
          context: { collectionsDir }
        });
        emitError(ctx, opts.output ?? 'text', err);
        return 1;
      }

      const files = opts.collectionFiles && opts.collectionFiles.length > 0
        ? opts.collectionFiles
        : listCollectionFiles(cwd);
      const result = validateAllCollections(cwd, files);
      const data: ValidateData = {
        ok: result.ok,
        totalFiles: files.length,
        fileResults: result.fileResults,
        errors: result.errors
      };

      if (opts.markdownPath !== undefined) {
        const md = generateMarkdown(result, files.length);
        await ctx.fs.writeFile(opts.markdownPath, md);
      }

      formatOutput({
        ctx,
        command: 'collection.validate',
        output: opts.output ?? 'text',
        status: result.ok ? 'ok' : 'error',
        data,
        textRenderer: (d) => renderText(d, opts.verbose ?? false)
      });
      return result.ok ? 0 : 1;
    }
  });

const emitError = (ctx: Context, output: OutputFormat, err: RegistryError): void => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command: 'collection.validate',
      output,
      status: 'error',
      data: null,
      errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
};

const renderText = (d: ValidateData, verbose: boolean): string => {
  const lines: string[] = [`Found ${d.totalFiles} collection(s)`];
  for (const fileResult of d.fileResults) {
    if (!fileResult.ok) {
      lines.push(`[FAIL] ${fileResult.file}: invalid`);
      for (const e of fileResult.errors) {
        lines.push(`  - ${e}`);
      }
    } else if (verbose) {
      lines.push(`[ OK ] ${fileResult.file}: valid`);
    }
  }
  const crossCollectionErrors = d.errors.filter((e) => e.includes('Duplicate collection'));
  if (crossCollectionErrors.length > 0) {
    lines.push('', 'Cross-collection errors:');
    for (const e of crossCollectionErrors) {
      lines.push(`  - ${e}`);
    }
  }
  if (d.ok) {
    lines.push('', `All ${d.totalFiles} collection(s) valid`);
  } else {
    lines.push('', `Validation failed with ${d.errors.length} error(s)`);
  }
  return `${lines.join('\n')}\n`;
};

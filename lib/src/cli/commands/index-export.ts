/**
 * `prompt-registry index export` — export a shortlist as a hub
 * profile YAML (and optionally a suggested collection YAML).
 *
 * Replaces the legacy `primitive-index export` verb. Output goes
 * through `formatOutput` so JSON callers get the canonical envelope
 * with `profileFile` and (when `--suggest-collection`) `collectionFile`
 * paths.
 * @module cli/commands/index-export
 */
// eslint-disable-next-line local/no-framework-imports -- bounded sync writes for the profile/collection YAML output paired with sync loadIndex; refactor tracked separately.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  dump as toYaml,
} from 'js-yaml';
import {
  defaultIndexFile,
} from '../../primitive-index/default-paths';
import {
  exportShortlistAsProfile,
} from '../../primitive-index/export-profile';
import {
  loadIndex,
} from '../../primitive-index/store';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

export interface IndexExportOptions {
  output?: OutputFormat;
  /** Path to the index JSON. */
  indexFile?: string;
  /** Shortlist id to export. Required. */
  shortlistId: string;
  /** Target profile id. Required. */
  profileId: string;
  /** Output directory. Defaults to ".". */
  outDir?: string;
  /** Profile name override. */
  profileName?: string;
  /** Profile description override. */
  description?: string;
  /** Profile icon override. */
  icon?: string;
  /** Also emit a curated collection YAML for loose primitives. */
  suggestCollection?: boolean;
}

interface ExportResult {
  profileFile: string;
  collectionFile?: string;
  warnings: string[];
}

/**
 * Build the `index export` command.
 * @param opts CLI options.
 * @returns CommandDefinition.
 */
export const createIndexExportCommand = (
  opts: IndexExportOptions
): CommandDefinition =>
  defineCommand({
    path: ['index', 'export'],
    description: 'Export a shortlist as a hub profile YAML.',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      if (opts.shortlistId.length === 0) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'index export: --shortlist <SHORTLIST_ID> is required'
        }));
      }
      if (opts.profileId.length === 0) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'index export: --profile-id <ID> is required'
        }));
      }
      const indexPath = opts.indexFile ?? defaultIndexFile(ctx.env);
      try {
        const idx = loadIndex(indexPath);
        const sl = idx.getShortlist(opts.shortlistId);
        if (sl === undefined) {
          return failWith(ctx, fmt, new RegistryError({
            code: 'INDEX.SHORTLIST_NOT_FOUND',
            message: `index export: unknown shortlist "${opts.shortlistId}"`
          }));
        }
        const result = exportShortlistAsProfile(idx, sl, {
          profileId: opts.profileId,
          profileName: opts.profileName,
          description: opts.description,
          icon: opts.icon,
          suggestCollection: opts.suggestCollection
        });
        const outDir = opts.outDir ?? '.';
        fs.mkdirSync(outDir, { recursive: true });
        const profileFile = path.join(outDir, `${opts.profileId}.profile.yml`);
        fs.writeFileSync(profileFile, toYaml(result.profile), 'utf8');
        const data: ExportResult = {
          profileFile,
          warnings: result.warnings
        };
        if (result.suggestedCollection !== undefined) {
          const collectionFile = path.join(outDir, `${result.suggestedCollection.id}.collection.yml`);
          fs.writeFileSync(collectionFile, toYaml(result.suggestedCollection), 'utf8');
          data.collectionFile = collectionFile;
        }
        formatOutput({
          ctx, command: 'index.export', output: fmt, status: 'ok',
          data,
          warnings: result.warnings,
          textRenderer: (d) =>
            `wrote ${d.profileFile}`
            + (d.collectionFile === undefined ? '' : `\nwrote ${d.collectionFile}`)
            + '\n'
        });
        return 0;
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        const err = /ENOENT|no such file/i.test(msg)
          ? new RegistryError({
            code: 'INDEX.NOT_FOUND',
            message: `index not found: ${indexPath}`,
            cause: cause instanceof Error ? cause : undefined
          })
          : new RegistryError({
            code: 'INDEX.EXPORT_FAILED',
            message: `index export failed: ${msg}`,
            cause: cause instanceof Error ? cause : undefined
          });
        return failWith(ctx, fmt, err);
      }
    }
  });

const failWith = (ctx: Context, output: OutputFormat, err: RegistryError): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx, command: 'index.export', output, status: 'error',
      data: null, errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
  return 1;
};

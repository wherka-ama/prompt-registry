/**
 * Phase 4 / Iter 3 — `collection affected` subcommand.
 *
 * Replaces `lib/bin/detect-affected-collections.js`. Given a list of
 * changed paths (typically produced by `git diff --name-only` in a
 * CI workflow), emits the collections whose `.collection.yml` itself
 * or any item-path is in that set.
 *
 * Path normalization mirrors the legacy script: backslash-to-slash,
 * strip a leading `/`, trim. Strings that normalize to empty are
 * dropped silently.
 */
import {
  listCollectionFiles,
  readCollection,
  resolveCollectionItemPaths,
} from '../..';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
} from '../framework';

interface AffectedRecord {
  id: string;
  file: string;
}

export interface CollectionAffectedOptions {
  /** Output format. Default 'text'. */
  output?: OutputFormat;
  /**
   * Changed paths to check against (repo-relative). Mirrors the
   * legacy `--changed-path` flag (repeatable).
   */
  changedPaths?: string[];
}

/**
 * Build the `collection affected` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createCollectionAffectedCommand = (
  opts: CollectionAffectedOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['collection', 'affected'],
    description: 'Print collections whose files or items overlap with the supplied changed-path list. (Replaces `detect-affected-collections`.)',
    run: ({ ctx }: { ctx: Context }): number => {
      const cwd = ctx.cwd();
      const changed = (opts.changedPaths ?? [])
        .map((p) => normalize(p))
        .filter((s) => s.length > 0);
      const changedSet = new Set(changed);

      const collectionFiles = listCollectionFiles(cwd);
      const affected: AffectedRecord[] = [];
      for (const file of collectionFiles) {
        const collection = readCollection(cwd, file);
        const itemPaths = resolveCollectionItemPaths(cwd, collection).map((p) => normalize(p));
        const itemPathsSet = new Set(itemPaths);
        const normalizedFile = normalize(file);
        if (changedSet.has(normalizedFile)) {
          affected.push({ id: collection.id, file });
          continue;
        }
        for (const c of changed) {
          if (itemPathsSet.has(c)) {
            affected.push({ id: collection.id, file });
            break;
          }
        }
      }

      formatOutput({
        ctx,
        command: 'collection.affected',
        output: opts.output ?? 'text',
        status: 'ok',
        data: { affected },
        textRenderer: renderText
      });
      return 0;
    }
  });

const normalize = (p: string): string =>
  String(p).replace(/\\/g, '/').replace(/^\/+/, '').trim();

const renderText = (d: { affected: AffectedRecord[] }): string => {
  if (d.affected.length === 0) {
    return 'no affected collections\n';
  }
  return d.affected.map((a) => `${a.id}  ${a.file}`).join('\n') + '\n';
};

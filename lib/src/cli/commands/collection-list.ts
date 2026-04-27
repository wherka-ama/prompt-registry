/**
 * Phase 4 / Iter 1 — `collection list` subcommand.
 *
 * Replaces `lib/bin/list-collections.js` (which directly imported
 * `listCollectionFiles` and `readCollection` from `../dist`). The new
 * subcommand:
 *
 *   - Goes through the framework's `Context` for fs access (spec §14.2
 *     invariant #3) — no `node:fs` import.
 *   - Emits via `formatOutput` (text/json/yaml/ndjson) — the legacy
 *     binary only emitted JSON.
 *   - Uses `RegistryError` (`FS.NOT_FOUND`) on a missing
 *     `collections/` directory rather than `process.exit(1)` after a
 *     `console.error`.
 *
 * The data shape is preserved (`{ id, name, file }` records) so any
 * downstream consumer parsing the legacy JSON still works after a
 * `--output json` rename.
 */
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

interface CollectionRecord {
  id: string;
  name: string;
  file: string;
}

/**
 * Build the `collection list` command.
 * @param opts - Command options.
 * @param opts.output - Output format (default 'text').
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createCollectionListCommand = (
  opts: { output?: OutputFormat } = {}
): CommandDefinition =>
  defineCommand({
    path: ['collection', 'list'],
    description: 'List `*.collection.yml` files under the current repo and print their id/name/path. (Replaces `list-collections`.)',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const cwd = ctx.cwd();
      const collectionsDir = path.join(cwd, 'collections');
      const dirExists = await ctx.fs.exists(collectionsDir);
      if (!dirExists) {
        const err = new RegistryError({
          code: 'FS.NOT_FOUND',
          message: `collections/ directory not found under ${cwd}`,
          hint: 'Run from a repo root that contains a `collections/` folder, '
            + 'or pass `--cwd <path>` once that flag lands in iter 8.',
          context: { collectionsDir }
        });
        const output = opts.output ?? 'text';
        if (output === 'json' || output === 'yaml' || output === 'ndjson') {
          // Machine-readable: error in the envelope.
          formatOutput({
            ctx,
            command: 'collection.list',
            output,
            status: 'error',
            data: null,
            errors: [err.toJSON()]
          });
        } else {
          // Text mode: human-readable error to stderr (matches the
          // legacy binary's `console.error` behavior).
          renderError(err, ctx);
        }
        return 1;
      }

      const records = await listCollections(ctx, collectionsDir, cwd);
      formatOutput({
        ctx,
        command: 'collection.list',
        output: opts.output ?? 'text',
        status: 'ok',
        data: records,
        textRenderer: renderCollectionsText
      });
      return 0;
    }
  });

const listCollections = async (
  ctx: Context,
  collectionsDir: string,
  cwd: string
): Promise<CollectionRecord[]> => {
  const entries = await ctx.fs.readDir(collectionsDir);
  const ymlFiles = entries.filter((e) => e.endsWith('.collection.yml')).toSorted();
  const records: CollectionRecord[] = [];
  for (const filename of ymlFiles) {
    const absolute = path.join(collectionsDir, filename);
    const text = await ctx.fs.readFile(absolute);
    const doc = yaml.load(text) as { id?: unknown; name?: unknown } | null;
    if (doc === null || typeof doc !== 'object') {
      // Skip ill-formed YAML files; legacy binary would crash, but the
      // CLI should be tolerant — bad files are caught by `collection
      // validate` (iter 2).
      continue;
    }
    const id = typeof doc.id === 'string' ? doc.id : '';
    const name = typeof doc.name === 'string' ? doc.name : id;
    records.push({
      id,
      name,
      file: path.relative(cwd, absolute)
    });
  }
  return records;
};

const renderCollectionsText = (records: CollectionRecord[]): string => {
  if (records.length === 0) {
    return 'no collections found\n';
  }
  // Stable, scriptable: `<id>  <name>  <relative-path>` per line.
  // Two-space gaps survive `awk '{print $1}'` style pipelines.
  return records
    .map((r) => `${r.id}  ${r.name}  ${r.file}`)
    .join('\n') + '\n';
};

/**
 * Phase 4 / Iter 7 — `bundle manifest` subcommand.
 *
 * Replaces `lib/bin/generate-manifest.js`. Reads a collection YAML
 * file plus the referenced primitive files, then writes a deployment
 * manifest YAML to `outFile`.
 *
 * The legacy script accepts a positional version arg. We surface
 * `version` as an option on the factory; iter 8 wires it to a
 * clipanion positional.
 */
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import {
  normalizeRepoRelativePath,
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

interface BundleManifestData {
  id: string;
  version: string;
  outFile: string;
  totalItems: number;
  itemsByType: Record<string, number>;
  mcpServerCount: number;
}

export interface BundleManifestOptions {
  /** Output format. Default 'text'. */
  output?: OutputFormat;
  /** Bundle version (e.g. '1.0.0'). Required. */
  version: string;
  /**
   * Collection file (repo-relative). When unset, the first
   * `*.collection.yml` under `<cwd>/collections/` is used.
   */
  collectionFile?: string;
  /** Output deployment manifest path. Default 'deployment-manifest.yml'. */
  outFile?: string;
}

const KIND_TO_TYPE_MAP: Record<string, string> = {
  instruction: 'instructions',
  'chat-mode': 'chatmode'
};

interface RawCollection {
  id?: string;
  name?: string;
  description?: string;
  author?: string;
  tags?: string[];
  items?: { path?: string; kind?: string }[];
  mcpServers?: Record<string, unknown>;
  mcp?: { items?: Record<string, unknown> };
}

/**
 * Build the `bundle manifest` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createBundleManifestCommand = (
  opts: BundleManifestOptions
): CommandDefinition =>
  defineCommand({
    path: ['bundle', 'manifest'],
    description: 'Generate a deployment-manifest.yml from a collection.yml + the referenced item files. (Replaces `generate-manifest`.)',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const cwd = ctx.cwd();
      const outFile = opts.outFile ?? 'deployment-manifest.yml';
      try {
        const collectionFile = await resolveCollectionFile(ctx, cwd, opts.collectionFile);
        const collectionAbs = path.isAbsolute(collectionFile)
          ? collectionFile
          : path.join(cwd, collectionFile);
        const collection = yaml.load(await ctx.fs.readFile(collectionAbs)) as RawCollection;
        const items = Array.isArray(collection.items) ? collection.items : [];
        const prompts: { id: string; name: string; description: string; file: string; type: string; tags: string[] }[] = [];
        for (const item of items) {
          if (item.path === undefined || item.kind === undefined) {
            continue;
          }
          const itemPath = normalizeRepoRelativePath(item.path);
          const itemAbs = path.join(cwd, itemPath);
          if (!(await ctx.fs.exists(itemAbs))) {
            throw new RegistryError({
              code: 'BUNDLE.ITEM_NOT_FOUND',
              message: `Referenced ${item.kind} file not found: ${itemPath}`,
              context: { itemPath, kind: item.kind }
            });
          }
          const itemContent = await ctx.fs.readFile(itemAbs);
          const nameMatch = /^#\s+(.+)$/m.exec(itemContent);
          const descMatch = /^##?\s*Description[:\s]+(.+)$/im.exec(itemContent)
            ?? /^>\s*(.+)$/m.exec(itemContent);
          const tags = Array.isArray(collection.tags) ? [...collection.tags] : [];
          const extension = path.extname(itemPath);
          const type = KIND_TO_TYPE_MAP[item.kind] ?? item.kind;
          let itemId: string;
          if (item.kind === 'skill') {
            const parts = itemPath.split('/');
            itemId = parts.length >= 2
              ? (parts.at(-2) ?? path.basename(itemPath, extension))
              : path.basename(itemPath, extension);
          } else {
            itemId = path.basename(itemPath, extension);
          }
          prompts.push({
            id: itemId,
            name: nameMatch === null ? itemId : nameMatch[1],
            description: descMatch === null ? '' : descMatch[1],
            file: itemPath,
            type,
            tags
          });
        }
        const manifestId = collection.id ?? 'unknown';
        const mcpServers = collection.mcpServers ?? collection.mcp?.items;
        const manifest = {
          id: manifestId,
          version: opts.version,
          name: collection.name ?? '',
          description: collection.description ?? '',
          author: collection.author ?? 'Prompt Registry',
          tags: collection.tags ?? [],
          environments: ['vscode', 'windsurf', 'cursor'],
          license: 'MIT',
          repository: '',
          prompts,
          dependencies: [],
          ...(mcpServers !== undefined && Object.keys(mcpServers).length > 0 ? { mcpServers } : {})
        };
        await ctx.fs.mkdir(path.dirname(outFile), { recursive: true });
        await ctx.fs.writeFile(outFile, yaml.dump(manifest, { lineWidth: -1 }));
        const itemsByType: Record<string, number> = {};
        for (const p of prompts) {
          itemsByType[p.type] = (itemsByType[p.type] ?? 0) + 1;
        }
        const data: BundleManifestData = {
          id: manifestId,
          version: opts.version,
          outFile,
          totalItems: prompts.length,
          itemsByType,
          mcpServerCount: mcpServers === undefined ? 0 : Object.keys(mcpServers).length
        };
        formatOutput({
          ctx,
          command: 'bundle.manifest',
          output: opts.output ?? 'text',
          status: 'ok',
          data,
          textRenderer: renderText
        });
        return 0;
      } catch (err) {
        const re = err instanceof RegistryError
          ? err
          : new RegistryError({
            code: 'INTERNAL.UNEXPECTED',
            message: err instanceof Error ? err.message : String(err),
            cause: err
          });
        emitError(ctx, opts.output ?? 'text', re);
        return 1;
      }
    }
  });

const resolveCollectionFile = async (
  ctx: Context,
  cwd: string,
  explicit: string | undefined
): Promise<string> => {
  if (explicit !== undefined) {
    return explicit;
  }
  const collectionsDir = path.join(cwd, 'collections');
  if (!(await ctx.fs.exists(collectionsDir))) {
    throw new RegistryError({
      code: 'FS.NOT_FOUND',
      message: `collections/ directory not found under ${cwd}`,
      hint: 'Pass --collection-file or run from a repo with a collections/ folder.'
    });
  }
  const entries = await ctx.fs.readDir(collectionsDir);
  const first = entries.find((e) => e.endsWith('.collection.yml'));
  if (first === undefined) {
    throw new RegistryError({
      code: 'BUNDLE.NOT_FOUND',
      message: 'no `*.collection.yml` files in collections/'
    });
  }
  return path.join('collections', first);
};

const emitError = (ctx: Context, output: OutputFormat, err: RegistryError): void => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command: 'bundle.manifest',
      output,
      status: 'error',
      data: null,
      errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
};

const renderText = (d: BundleManifestData): string => {
  const lines: string[] = [`Generated ${d.outFile}`, `  id: ${d.id}`, `  version: ${d.version}`, `  total items: ${d.totalItems}`];
  for (const [type, count] of Object.entries(d.itemsByType)) {
    lines.push(`    ${type}: ${count}`);
  }
  if (d.mcpServerCount > 0) {
    // Capitalised "MCP Servers" preserves the legacy script's text
    // (regression test in lib/test/generate-manifest.test.ts asserts
    // the exact substring `MCP Servers: <n>` to keep CI logs stable).
    lines.push(`  MCP Servers: ${d.mcpServerCount}`);
  }
  return `${lines.join('\n')}\n`;
};

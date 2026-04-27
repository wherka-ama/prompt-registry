/**
 * Phase 4 / Iter 19 — `--explain <code>` and `prompt-registry explain <code>`.
 *
 * Looks up a structured RegistryError code and prints a paragraph of
 * documentation. The full code catalog is built incrementally; this
 * iter delivers a stub that recognizes the 11 namespaces (spec §10 /
 * decision D5) and a small initial set of codes that the Phase 4
 * commands actually emit. Codes that aren't yet documented produce
 * a generic "namespace recognized, but no entry yet" message rather
 * than failing — Phase 5 fills out the catalog as new codes appear.
 */
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

interface ExplainData {
  code: string;
  namespace: string;
  summary: string;
  remediation: string;
  docsUrl: string | null;
}

export interface ExplainOptions {
  /** Output format. Default 'text'. */
  output?: OutputFormat;
  /** The error code to explain. Required. */
  code: string;
}

const NAMESPACES = new Set([
  'BUNDLE', 'INDEX', 'HUB', 'PRIMITIVE',
  'CONFIG', 'NETWORK', 'AUTH', 'FS',
  'PLUGIN', 'USAGE', 'INTERNAL'
]);

interface CatalogEntry {
  summary: string;
  remediation: string;
  docsUrl?: string;
}

// Initial catalog. Every code emitted by Phase 4 commands gets an
// entry; new codes added in Phase 5+ should be added here in the
// same iter that introduces them.
const CATALOG: Record<string, CatalogEntry> = {
  'FS.NOT_FOUND': {
    summary: 'A required file or directory could not be found on disk.',
    remediation: 'Check the path is correct, or pass --cwd <repo-root> to redirect filesystem operations.'
  },
  'BUNDLE.NOT_FOUND': {
    summary: 'No bundle (collection or plugin) matched the requested identifier.',
    remediation: 'Run `prompt-registry collection list` to see available collections.'
  },
  'BUNDLE.INVALID_MANIFEST': {
    summary: 'A collection or bundle manifest failed schema validation (missing required fields).',
    remediation: 'Run `prompt-registry collection validate` for a per-file diagnosis.'
  },
  'BUNDLE.INVALID_VERSION': {
    summary: 'The collection.version field is not a valid semver string.',
    remediation: 'Edit the collection.yml file and ensure `version:` matches MAJOR.MINOR.PATCH.'
  },
  'BUNDLE.ITEM_NOT_FOUND': {
    summary: 'A collection item references a path that does not exist on disk.',
    remediation: 'Check the `items[].path` entries and ensure each file exists relative to the repo root.'
  },
  'PRIMITIVE.ALREADY_EXISTS': {
    summary: 'A skill folder with the requested name already exists.',
    remediation: 'Choose a different --skill-name or remove the existing folder.'
  },
  'PRIMITIVE.INVALID_NAME': {
    summary: 'The skill name failed the spec validation (e.g., contains whitespace).',
    remediation: 'Use only lowercase letters, digits, and hyphens.'
  },
  'PRIMITIVE.CREATE_FAILED': {
    summary: 'createSkill failed for an unspecified reason.',
    remediation: 'Re-run with verbose output and check the surrounding logs.'
  },
  'USAGE.MISSING_FLAG': {
    summary: 'A required CLI flag was not provided.',
    remediation: 'Re-run with --help on the subcommand to see the required flags.'
  },
  'INTERNAL.UNEXPECTED': {
    summary: 'An unexpected error escaped a command handler. This is a bug.',
    remediation: 'Please report at https://github.com/AmadeusITGroup/prompt-registry/issues with the stderr output.'
  },
  // Phase 5 / Iter 32: install-related codes.
  'BUNDLE.MANIFEST_MISSING': {
    summary: 'The bundle is missing `deployment-manifest.yml` at its root.',
    remediation: 'Verify the bundle was built with `prompt-registry bundle build`. The manifest must live at the bundle root, not in a subdir.'
  },
  'BUNDLE.MANIFEST_INVALID': {
    summary: 'The deployment-manifest.yml is malformed (bad YAML, missing id/version/name).',
    remediation: 'Open the manifest and ensure it is a YAML mapping with non-empty `id`, `version`, `name` fields.'
  },
  'BUNDLE.ID_MISMATCH': {
    summary: 'The manifest id differs from the requested bundle id.',
    remediation: 'Check the install command line; the bundle id and the manifest id must match.'
  },
  'BUNDLE.VERSION_MISMATCH': {
    summary: 'The manifest version differs from the requested bundle version.',
    remediation: 'Either install with --version matching the manifest, or `--version latest` to skip the check.'
  },
  'BUNDLE.EXTRACT_FAILED': {
    summary: 'The bundle bytes could not be unpacked.',
    remediation: 'Check that the downloaded zip is intact (no truncation), or re-build locally with `prompt-registry bundle build`.'
  },
  'NETWORK.DOWNLOAD_FAILED': {
    summary: 'The bundle could not be downloaded from the resolved URL.',
    remediation: 'Check connectivity, GitHub rate limits, and the bundle URL. Try `prompt-registry doctor` for diagnostics.'
  },
  'CONFIG.SCHEMA_VERSION_UNSUPPORTED': {
    summary: 'The config or lockfile carries a schemaVersion this build does not understand.',
    remediation: 'Upgrade prompt-registry, or roll back to a build matching the schema version on disk.'
  },
  'FS.WRITE_FAILED': {
    summary: 'A target write failed (permissions, full disk, parent missing).',
    remediation: 'Check write permissions on the target path; run `prompt-registry doctor` for environment diagnostics.'
  }
};

/**
 * Build the `explain` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createExplainCommand = (
  opts: ExplainOptions
): CommandDefinition =>
  defineCommand({
    path: ['explain'],
    description: 'Print documentation for a RegistryError code (e.g., `prompt-registry explain BUNDLE.NOT_FOUND`).',
    run: ({ ctx }: { ctx: Context }): number => {
      const code = opts.code;
      if (code.length === 0) {
        const err = new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'explain: missing error code',
          hint: 'Usage: `prompt-registry explain <NAMESPACE.CODE>` (e.g., BUNDLE.NOT_FOUND)'
        });
        emitError(ctx, opts.output ?? 'text', err);
        return 1;
      }
      const dotIdx = code.indexOf('.');
      const namespace = dotIdx === -1 ? code : code.slice(0, dotIdx);
      if (!NAMESPACES.has(namespace)) {
        const err = new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: `unknown namespace: ${namespace}`,
          hint: `Valid namespaces: ${[...NAMESPACES].toSorted().join(', ')}`
        });
        emitError(ctx, opts.output ?? 'text', err);
        return 1;
      }
      const entry = CATALOG[code];
      const data: ExplainData = entry === undefined
        ? {
          code,
          namespace,
          summary: `Code ${code} is in the recognized namespace ${namespace} but has no catalog entry yet.`,
          remediation: 'Phase 5 fills out the catalog as new codes appear. Search the source for `code: \'CODE_NAME\'` if you need the throw site.',
          docsUrl: null
        }
        : {
          code,
          namespace,
          summary: entry.summary,
          remediation: entry.remediation,
          docsUrl: entry.docsUrl ?? null
        };
      formatOutput({
        ctx,
        command: 'explain',
        output: opts.output ?? 'text',
        status: 'ok',
        data,
        textRenderer: renderText
      });
      return 0;
    }
  });

const emitError = (ctx: Context, output: OutputFormat, err: RegistryError): void => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command: 'explain',
      output,
      status: 'error',
      data: null,
      errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
};

const renderText = (d: ExplainData): string => {
  const lines: string[] = [`${d.code}`, `  ${d.summary}`, '', `Remediation: ${d.remediation}`];
  if (d.docsUrl !== null) {
    lines.push(`Docs:        ${d.docsUrl}`);
  }
  return `${lines.join('\n')}\n`;
};

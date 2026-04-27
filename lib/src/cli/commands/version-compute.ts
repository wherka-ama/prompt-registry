/**
 * Phase 4 / Iter 4 — `version compute` subcommand.
 *
 * Replaces `lib/bin/compute-collection-version.js`. Computes the next
 * semver version + git tag for a collection given:
 *   - the collection file's `version` field (manual override), and
 *   - the set of existing git tags matching `<collection-id>-v*`.
 *
 * The git interaction is injected via `gitTagsProvider` so the command
 * stays Context-pure for tests. The default provider shells out to
 * `git tag --list` synchronously (same as the legacy script) and is
 * the *only* place this command file touches a child process.
 */
import {
  spawnSync,
} from 'node:child_process';
import * as semver from 'semver';
import {
  readCollection,
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

interface VersionComputeData {
  collectionId: string;
  collectionFile: string;
  lastVersion: string | null;
  manualVersion: string;
  nextVersion: string;
  tag: string;
}

export interface VersionComputeOptions {
  /** Output format. Default 'text'. */
  output?: OutputFormat;
  /** Collection file (repo-relative). Mirrors --collection-file. */
  collectionFile: string;
  /**
   * Optional override for tag enumeration. Tests pass a fixed array;
   * production wiring uses `defaultGitTagsProvider` which shells out
   * to `git tag --list`.
   */
  gitTagsProvider?: (cwd: string) => string[];
}

/**
 * Build the `version compute` command.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createVersionComputeCommand = (
  opts: VersionComputeOptions
): CommandDefinition =>
  defineCommand({
    path: ['version', 'compute'],
    description: 'Compute the next semver version + git tag for a collection. (Replaces `compute-collection-version`.)',
    run: ({ ctx }: { ctx: Context }): number => {
      const cwd = ctx.cwd();
      try {
        const provider = opts.gitTagsProvider ?? defaultGitTagsProvider;
        const data = computeNextVersion({
          repoRoot: cwd,
          collectionFile: opts.collectionFile,
          allTags: provider(cwd)
        });
        formatOutput({
          ctx,
          command: 'version.compute',
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

const computeNextVersion = (input: {
  repoRoot: string;
  collectionFile: string;
  allTags: string[];
}): VersionComputeData => {
  const collection = readCollection(input.repoRoot, input.collectionFile);
  const collectionId = collection.id;
  if (typeof collectionId !== 'string' || collectionId.length === 0) {
    throw new RegistryError({
      code: 'BUNDLE.INVALID_MANIFEST',
      message: 'collection.id is required',
      hint: 'Add an `id:` field to the collection.yml file.'
    });
  }

  const DEFAULT_VERSION = '1.0.0';
  let manualVersion = DEFAULT_VERSION;
  if (collection.version !== undefined && typeof collection.version === 'string') {
    if (semver.valid(collection.version) === null) {
      throw new RegistryError({
        code: 'BUNDLE.INVALID_VERSION',
        message: `collection.version must be a valid semver string (got: ${collection.version})`,
        context: { version: collection.version }
      });
    }
    manualVersion = collection.version;
  }

  const tagPrefix = `${collectionId}-v`;
  const tagsForCollection = input.allTags.filter((t) => t.startsWith(tagPrefix));
  const versions = tagsForCollection
    .map((t) => t.slice(tagPrefix.length))
    .filter((v) => semver.valid(v) !== null)
    .toSorted(semver.rcompare);
  const lastVersion = versions.length === 0 ? null : versions[0];

  let nextVersion: string;
  if (lastVersion === null) {
    nextVersion = manualVersion;
  } else if (semver.gt(manualVersion, lastVersion)) {
    nextVersion = manualVersion;
  } else {
    const incremented = semver.inc(lastVersion, 'patch');
    if (incremented === null) {
      throw new RegistryError({
        code: 'BUNDLE.INVALID_VERSION',
        message: `unable to increment patch on ${lastVersion}`
      });
    }
    nextVersion = incremented;
  }

  let tag = `${collectionId}-v${nextVersion}`;
  const tagSet = new Set(input.allTags);
  if (lastVersion !== null && semver.gt(manualVersion, lastVersion)) {
    if (tagSet.has(tag)) {
      throw new RegistryError({
        code: 'BUNDLE.TAG_EXISTS',
        message: `Tag already exists for manual version: ${tag}`,
        hint: 'Bump the `version:` field in the collection.yml or remove the existing tag.',
        context: { tag, manualVersion }
      });
    }
  } else {
    while (tagSet.has(tag)) {
      const incremented = semver.inc(nextVersion, 'patch');
      if (incremented === null) {
        throw new RegistryError({
          code: 'BUNDLE.INVALID_VERSION',
          message: `unable to find a free patch version after ${nextVersion}`
        });
      }
      nextVersion = incremented;
      tag = `${collectionId}-v${nextVersion}`;
    }
  }

  return {
    collectionId,
    collectionFile: input.collectionFile.replace(/\\/g, '/'),
    lastVersion,
    manualVersion,
    nextVersion,
    tag
  };
};

const defaultGitTagsProvider = (cwd: string): string[] => {
  // The single point in this command file where we shell out. Bounded
  // and deterministic — any future migration to a `Context.git`
  // abstraction can replace this one function.
  const res = spawnSync('git', ['tag', '--list'], { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    return [];
  }
  return (res.stdout ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

const emitError = (ctx: Context, output: OutputFormat, err: RegistryError): void => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command: 'version.compute',
      output,
      status: 'error',
      data: null,
      errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
};

const renderText = (d: VersionComputeData): string =>
  `${d.collectionId}: ${d.lastVersion ?? '(none)'} -> ${d.nextVersion} (tag: ${d.tag})\n`;

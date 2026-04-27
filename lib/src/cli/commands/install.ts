/**
 * Phase 4 / Iter 31 — `install` stub (Phase 5 preview).
 *
 * The install command is the primary deliverable of Phase 5
 * (environment-agnostic install). Iter 31 ships the surface so the
 * migration guide can mention it; Phase 5 fills the body.
 *
 * Final shape (per spec §14.1):
 *   prompt-registry install <bundle>            (imperative)
 *   prompt-registry install --lockfile <path>   (declarative from a lockfile)
 */
import * as path from 'node:path';
import {
  checksumFiles,
} from '../../install/checksum';
import {
  GitHubBundleResolver,
} from '../../install/github-resolver';
import {
  envTokenProvider,
  type HttpClient,
  type TokenProvider,
} from '../../install/http';
import {
  HttpsBundleDownloader,
} from '../../install/https-downloader';
import {
  readLocalBundle,
} from '../../install/local-dir-source';
import {
  type LockfileEntry,
  readLockfile,
  upsertEntry,
  upsertSource,
  writeLockfile,
} from '../../install/lockfile';
import {
  validateManifest,
} from '../../install/manifest-validator';
import {
  NodeHttpClient,
} from '../../install/node-http-client';
import {
  parseBundleSpec,
} from '../../install/spec-parser';
import {
  readTargets,
} from '../../install/target-store';
import {
  FileTreeTargetWriter,
} from '../../install/target-writer';
import {
  YauzlBundleExtractor,
} from '../../install/yauzl-extractor';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

export interface InstallOptions {
  output?: OutputFormat;
  /** Bundle id to install (imperative mode). */
  bundle?: string;
  /** Lockfile path (declarative mode). */
  lockfile?: string;
  /** Target name (resolved against `targets[]` in config). */
  target?: string;
  /**
   * Path to an already-built bundle directory. When set, the install
   * command bypasses resolve/download/extract and reads files from
   * the directory directly. Useful for dev workflows where the
   * user just ran `prompt-registry bundle build`.
   */
  from?: string;
  /** Dry-run: validate + plan the install but write nothing. */
  dryRun?: boolean;
  /**
   * Comma-separated allowlist of target names this run is permitted
   * to write to. Defense-in-depth for CI; refuses any --target outside
   * the set even if the target is configured. Spec sec 9.2.1.
   */
  allowTarget?: string;
  /**
   * Phase 5 spillover / iter 31: Optional source slug for the
   * remote install path. When `<bundle>` is given without
   * `--from`, this resolves the bundle via `GitHubBundleResolver`.
   * Format: `owner/repo`. If omitted, the bundleSpec must carry
   * a sourceId of the same form (e.g. `install owner/repo:foo`).
   */
  source?: string;
  /**
   * Phase 5 spillover / iter 31: dependency-injection seam for
   * tests. Production callers leave this undefined; the install
   * command then constructs a `NodeHttpClient`. Tests pass a
   * `RecordingHttpClient` to avoid real sockets.
   */
  http?: HttpClient;
  /**
   * Phase 5 spillover / iter 31: dependency-injection seam for
   * tests. Production callers leave this undefined; the install
   * command then constructs an `envTokenProvider(ctx.env)`.
   */
  tokens?: TokenProvider;
}

/**
 * Build the `install` command stub.
 * @param opts - Command options.
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createInstallCommand = (
  opts: InstallOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['install'],
    description: 'Install bundles to a configured target. Phase 5 will implement; iter 31 ships the surface.',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const fmt = opts.output ?? 'text';
      const noBundle = opts.bundle === undefined || opts.bundle.length === 0;
      const noLockfile = opts.lockfile === undefined || opts.lockfile.length === 0;
      if (noBundle && noLockfile) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'install: provide either <bundle-id> (imperative) or --lockfile <path> (declarative)',
          hint: 'Examples:\n'
            + '  prompt-registry install <bundle-id>\n'
            + '  prompt-registry install --lockfile prompt-registry.lock.json'
        }));
      }
      // Resolve target.
      if (opts.target === undefined || opts.target.length === 0) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: 'install: --target <name> is required',
          hint: 'Configure a target with `prompt-registry target add <name> --type <kind>` first.'
        }));
      }
      // Phase 5 / Iter 29: --allow-target gating (spec sec 9.2.1).
      // Compared *before* config lookup so a wrong-target call fails
      // fast without leaking which targets are configured.
      if (opts.allowTarget !== undefined && opts.allowTarget.length > 0) {
        const allowSet = new Set(
          opts.allowTarget.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
        );
        if (!allowSet.has(opts.target)) {
          return failWith(ctx, fmt, new RegistryError({
            code: 'USAGE.MISSING_FLAG',
            message: `install: target "${opts.target}" is not in --allow-target=${opts.allowTarget}`,
            hint: 'Add it to --allow-target or unset the flag to allow any configured target.',
            context: { target: opts.target, allowTarget: opts.allowTarget }
          }));
        }
      }

      const targets = await readTargets({ cwd: ctx.cwd(), fs: ctx.fs });
      const target = targets.find((t) => t.name === opts.target);
      if (target === undefined) {
        return failWith(ctx, fmt, new RegistryError({
          code: 'USAGE.MISSING_FLAG',
          message: `install: target "${opts.target}" is not configured`,
          hint: targets.length === 0
            ? 'Run `prompt-registry target add <name> --type <kind>` to add one.'
            : `Configured targets: ${targets.map((t) => t.name).join(', ')}.`,
          context: { target: opts.target }
        }));
      }

      // Phase 5 / Iter 22-23: local-dir install path.
      if (opts.from !== undefined && opts.from.length > 0) {
        try {
          const files = await readLocalBundle(opts.from, ctx.fs);
          const manifest = validateManifest(files, {
            expectedId: opts.bundle ?? '',
            expectedVersion: undefined
          });
          if (opts.dryRun === true) {
            formatOutput({
              ctx,
              command: 'install',
              output: fmt,
              status: 'ok',
              data: {
                dryRun: true,
                target: target.name,
                bundle: { id: manifest.id, version: manifest.version },
                files: [...files.keys()]
              },
              textRenderer: (d) => `Dry run: would install ${d.bundle.id}@${d.bundle.version} `
                + `(${d.files.length} file${d.files.length === 1 ? '' : 's'}) into target "${d.target}".\n`
            });
            return 0;
          }
          const writer = new FileTreeTargetWriter({
            fs: ctx.fs,
            env: ctx.env
          });
          const result = await writer.write(target, files);

          // Phase 5 / Iter 27: persist a lockfile entry. Lockfile
          // lives next to the project config; default name is
          // `prompt-registry.lock.json` and is created on first
          // install.
          const lockPath = path.join(ctx.cwd(), 'prompt-registry.lock.json');
          const existing = await readLockfile(lockPath, ctx.fs);
          // Phase 5 spillover / iter 14-15: per-file checksums + source
          // record so the lockfile is iso-functional with the
          // extension's lockfile (D13). For local-dir installs the
          // source is recorded with type 'local' and url = absolute
          // bundle dir.
          const checksums = checksumFiles(files);
          const localSourceId = `local-${path.basename(opts.from)}`;
          const entry: LockfileEntry = {
            target: target.name,
            sourceId: localSourceId,
            bundleId: manifest.id,
            bundleVersion: manifest.version,
            installedAt: new Date().toISOString(),
            files: [...files.keys()].filter((f) => f !== 'deployment-manifest.yml'),
            fileChecksums: checksums
          };
          let nextLock = upsertEntry(existing, entry);
          nextLock = upsertSource(nextLock, localSourceId, {
            type: 'local',
            url: path.resolve(ctx.cwd(), opts.from)
          });
          await writeLockfile(lockPath, nextLock, ctx.fs);

          formatOutput({
            ctx,
            command: 'install',
            output: fmt,
            status: 'ok',
            data: {
              target: target.name,
              bundle: { id: manifest.id, version: manifest.version },
              written: result.written,
              skipped: result.skipped,
              lockfile: lockPath
            },
            textRenderer: (d) => `Installed ${d.bundle.id}@${d.bundle.version} into target "${d.target}" `
              + `(${d.written.length} written, ${d.skipped.length} skipped). `
              + `Updated ${d.lockfile}.\n`
          });
          return 0;
        } catch (cause) {
          // Promote a known structured code to a RegistryError code;
          // anything else collapses to INTERNAL.UNEXPECTED.
          const raw = (cause as { code?: string }).code;
          const code = raw !== undefined && /^(BUNDLE|FS|NETWORK|USAGE|CONFIG)\.[A-Z0-9_]+$/.test(raw)
            ? raw
            : 'INTERNAL.UNEXPECTED';
          return failWith(ctx, fmt, new RegistryError({
            code,
            message: `install: ${(cause as Error).message}`,
            hint: 'Run `prompt-registry doctor` for environment diagnostics.',
            context: { from: opts.from },
            cause: cause instanceof Error ? cause : undefined
          }));
        }
      }

      // Phase 5 spillover / iter 35-37: declarative install via
      // lockfile. Reads every entry whose .target matches and
      // re-installs it via the same remote pipeline used by the
      // imperative path. Each entry's source descriptor is read
      // from `lock.sources[entry.sourceId]` to recover the upstream
      // owner/repo. local sources (type: 'local') replay via the
      // recorded `url` (absolute path).
      if (opts.lockfile !== undefined && opts.lockfile.length > 0) {
        const lockPath = path.isAbsolute(opts.lockfile)
          ? opts.lockfile
          : path.join(ctx.cwd(), opts.lockfile);
        const lock = await readLockfile(lockPath, ctx.fs);
        const matching = lock.entries.filter((e) => e.target === target.name);
        const sources = lock.sources ?? {};
        const replayed: string[] = [];
        const failures: { bundleId: string; reason: string }[] = [];
        const http = opts.http ?? new NodeHttpClient();
        const tokens = opts.tokens ?? envTokenProvider(ctx.env);
        const writer = new FileTreeTargetWriter({ fs: ctx.fs, env: ctx.env });
        for (const e of matching) {
          const src = sources[e.sourceId];
          if (src === undefined) {
            failures.push({
              bundleId: e.bundleId,
              reason: `source ${e.sourceId} missing from lockfile.sources`
            });
            continue;
          }
          try {
            let files;
            if (src.type === 'local') {
              files = await readLocalBundle(src.url, ctx.fs);
            } else if (src.type === 'github') {
              const repoSlug = src.url.replace(/^https?:\/\/github\.com\//, '');
              const resolver = new GitHubBundleResolver({ repoSlug, http, tokens });
              const downloader = new HttpsBundleDownloader(http, tokens);
              const installable = await resolver.resolve({
                bundleId: e.bundleId,
                bundleVersion: e.bundleVersion
              });
              if (installable === null) {
                failures.push({
                  bundleId: e.bundleId,
                  reason: `bundle ${e.bundleId}@${e.bundleVersion} not found at ${repoSlug}`
                });
                continue;
              }
              const dl = await downloader.download(installable);
              if (e.sha256 !== undefined && dl.sha256 !== e.sha256) {
                failures.push({
                  bundleId: e.bundleId,
                  reason: `bundle bytes changed: lockfile sha256=${e.sha256}, fetched=${dl.sha256}`
                });
                continue;
              }
              files = await new YauzlBundleExtractor().extract(dl.bytes);
            } else {
              failures.push({
                bundleId: e.bundleId,
                reason: `unsupported source type: ${src.type}`
              });
              continue;
            }
            validateManifest(files, {
              expectedId: e.bundleId,
              expectedVersion: e.bundleVersion
            });
            await writer.write(target, files);
            replayed.push(e.bundleId);
          } catch (cause) {
            failures.push({
              bundleId: e.bundleId,
              reason: (cause as Error).message
            });
          }
        }
        // Phase 6 / iter 97: D24 profile-aware replay. If the
        // lockfile carries useProfile, surface it so callers (and
        // text-mode users) know the profile linkage was preserved.
        // The activation state itself lives at user scope and is
        // re-applied automatically when `profile activate` is
        // invoked next; replay does not silently re-trigger
        // user-level activation IO.
        const profileLink = lock.useProfile;
        const status = failures.length === 0 ? 'ok' : 'warning';
        formatOutput({
          ctx,
          command: 'install',
          output: fmt,
          status,
          data: {
            lockfile: lockPath,
            target: target.name,
            replayPlanned: matching.length,
            replayed,
            failures,
            useProfile: profileLink ?? null
          },
          warnings: failures.length > 0
            ? failures.map((f) => `${f.bundleId}: ${f.reason}`)
            : undefined,
          textRenderer: (d) => `Replay: ${d.replayed.length}/${d.replayPlanned} bundles installed `
            + `into target "${d.target}"`
            + (d.failures.length === 0
              ? '.\n'
              : `; ${d.failures.length} failure${d.failures.length === 1 ? '' : 's'}:\n`
                + d.failures.map((f) => `  - ${f.bundleId}: ${f.reason}\n`).join(''))
        });
        return failures.length === 0 ? 0 : 1;
      }

      // Phase 5 spillover / iter 31-32: imperative install via remote
      // resolver + downloader + extractor.
      try {
        // Parse <bundle> as a BundleSpec and merge with --source
        // (the latter wins when both yield a sourceId). `noBundle`
        // is already false at this point (the early-exit above
        // catches the no-bundle/no-lockfile case), so opts.bundle
        // is non-undefined and non-empty.
        const spec = parseBundleSpec(opts.bundle as string);
        const repoSlug = opts.source ?? spec.sourceId;
        if (repoSlug === undefined || repoSlug.length === 0) {
          return failWith(ctx, fmt, new RegistryError({
            code: 'USAGE.MISSING_FLAG',
            message: 'install: a remote install needs --source <owner/repo> (or `install owner/repo:<bundleId>`).',
            hint: 'Examples:\n'
              + '  prompt-registry install foo --source owner/repo --target my-vscode\n'
              + '  prompt-registry install owner/repo:foo --target my-vscode\n'
              + '  prompt-registry install foo --from <localDir> --target my-vscode'
          }));
        }
        const http = opts.http ?? new NodeHttpClient();
        const tokens = opts.tokens ?? envTokenProvider(ctx.env);
        const resolver = new GitHubBundleResolver({ repoSlug, http, tokens });
        const downloader = new HttpsBundleDownloader(http, tokens);
        const extractor = new YauzlBundleExtractor();

        const installable = await resolver.resolve(spec);
        if (installable === null) {
          return failWith(ctx, fmt, new RegistryError({
            code: 'BUNDLE.NOT_FOUND',
            message: `install: ${spec.bundleId} not found at ${repoSlug}`,
            hint: 'Check the source slug and that a release with the requested version + asset (bundle.zip) exists.',
            context: { spec, repoSlug }
          }));
        }
        const dl = await downloader.download(installable);
        const files = await extractor.extract(dl.bytes);
        const manifest = validateManifest(files, {
          expectedId: spec.bundleId,
          expectedVersion: spec.bundleVersion === 'latest' ? undefined : spec.bundleVersion
        });
        if (opts.dryRun === true) {
          formatOutput({
            ctx,
            command: 'install',
            output: fmt,
            status: 'ok',
            data: {
              dryRun: true,
              target: target.name,
              bundle: { id: manifest.id, version: manifest.version },
              source: { type: 'github', repo: repoSlug, downloadUrl: installable.downloadUrl },
              sha256: dl.sha256,
              files: [...files.keys()]
            },
            textRenderer: (d) => `Dry run: would install ${d.bundle.id}@${d.bundle.version} `
              + `from ${d.source.repo} (${d.files.length} file${d.files.length === 1 ? '' : 's'}) `
              + `into target "${d.target}".\n`
          });
          return 0;
        }
        const writer = new FileTreeTargetWriter({ fs: ctx.fs, env: ctx.env });
        const result = await writer.write(target, files);
        const lockPath = path.join(ctx.cwd(), 'prompt-registry.lock.json');
        const existing = await readLockfile(lockPath, ctx.fs);
        const checksums = checksumFiles(files);
        const entry: LockfileEntry = {
          target: target.name,
          sourceId: installable.ref.sourceId,
          bundleId: manifest.id,
          bundleVersion: manifest.version,
          sha256: dl.sha256,
          installedAt: new Date().toISOString(),
          files: [...files.keys()].filter((f) => f !== 'deployment-manifest.yml'),
          fileChecksums: checksums
        };
        let nextLock = upsertEntry(existing, entry);
        nextLock = upsertSource(nextLock, installable.ref.sourceId, {
          type: 'github',
          url: `https://github.com/${repoSlug}`
        });
        await writeLockfile(lockPath, nextLock, ctx.fs);

        formatOutput({
          ctx,
          command: 'install',
          output: fmt,
          status: 'ok',
          data: {
            target: target.name,
            bundle: { id: manifest.id, version: manifest.version },
            source: { type: 'github', repo: repoSlug, sourceId: installable.ref.sourceId },
            sha256: dl.sha256,
            written: result.written,
            skipped: result.skipped,
            lockfile: lockPath
          },
          textRenderer: (d) => `Installed ${d.bundle.id}@${d.bundle.version} from ${d.source.repo} `
            + `into target "${d.target}" (${d.written.length} written, ${d.skipped.length} skipped). `
            + `Updated ${d.lockfile}.\n`
        });
        return 0;
      } catch (cause) {
        const raw = (cause as { code?: string }).code;
        const code = raw !== undefined && /^(BUNDLE|FS|NETWORK|USAGE|CONFIG)\.[A-Z0-9_]+$/.test(raw)
          ? raw
          : 'NETWORK.DOWNLOAD_FAILED';
        return failWith(ctx, fmt, new RegistryError({
          code,
          message: `install: ${(cause as Error).message}`,
          hint: 'Run `prompt-registry doctor` for environment diagnostics, or use `--from <localDir>` to install a pre-built bundle.',
          context: {
            mode: 'imperative-remote',
            bundle: opts.bundle,
            source: opts.source,
            target: opts.target
          },
          cause: cause instanceof Error ? cause : undefined
        }));
      }
    }
  });

const failWith = (ctx: Context, output: OutputFormat, err: RegistryError): number => {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command: 'install',
      output,
      status: 'error',
      data: null,
      errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
  return 1;
};

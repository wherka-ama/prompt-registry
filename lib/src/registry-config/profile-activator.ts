/**
 * Phase 6 / Iter 61-65 — ProfileActivator (D21, D22).
 *
 * Atomic activation engine for a registry Profile. Resolves every
 * bundle via the existing Phase 5-spillover install pipeline, then
 * writes them across the chosen targets transactionally:
 *
 *   1. Resolve all bundles upfront. Any null abort BEFORE downloads.
 *   2. Download all bundles. Any failure abort BEFORE extracts.
 *   3. Extract + validate. Any failure abort BEFORE writes.
 *   4. Write across every target. On any per-write failure, REVERT
 *      every previously-written file by deleting it, then re-throw
 *      with PROFILE.ACTIVATION_FAILED.
 *
 * Target-agnostic: the activator iterates over the supplied targets;
 * the same Profile activates uniformly into vscode + claude-code +
 * kiro + windsurf + copilot-cli. No target-specific code paths.
 *
 * D21 enforcement: caller MUST pass a fresh activation (the
 * deactivation of any previous active profile is the orchestrator's
 * job, not the activator's).
 */
import * as path from 'node:path';
import {
  type FsAbstraction,
} from '../cli/framework';
import {
  type Profile,
  type ProfileActivationState,
  type RegistrySource,
  type Target,
} from '../domain';
import {
  type Installable,
} from '../domain/install';
import {
  AssetFetcher,
} from '../github/asset-fetcher';
import {
  AwesomeCopilotBundleResolver,
} from '../install/awesome-copilot-resolver';
import {
  type ExtractedFiles,
} from '../install/extractor';
import {
  GitHubBundleResolver,
} from '../install/github-resolver';
import {
  type HttpClient,
  type TokenProvider,
} from '../install/http';
import {
  HttpsBundleDownloader,
} from '../install/https-downloader';
import {
  readLocalBundle,
} from '../install/local-dir-source';
import {
  validateManifest,
} from '../install/manifest-validator';
import {
  LocalAwesomeCopilotBundleResolver,
  LocalSkillsBundleResolver,
  SkillsBundleResolver,
} from '../install/skills-resolver';
import {
  FileTreeTargetWriter,
} from '../install/target-writer';
import {
  YauzlBundleExtractor,
} from '../install/yauzl-extractor';

export interface ProfileActivatorDeps {
  /** Filesystem abstraction. */
  fs: FsAbstraction;
  /** Env (passed to FileTreeTargetWriter for ${HOME} expansion). */
  env: Record<string, string | undefined>;
  /** HttpClient for github resolves + downloads. */
  http: HttpClient;
  /** TokenProvider. */
  tokens: TokenProvider;
}

export interface ActivationInput {
  hubId: string;
  profile: Profile;
  /** Map sourceId -> RegistrySource (from the hub config). */
  sources: Record<string, RegistrySource>;
  /** All targets to write into (target-agnostic). */
  targets: Target[];
}

export interface ActivationOutcome {
  state: ProfileActivationState;
  /** Per-target written file lists. */
  written: Record<string, string[]>;
}

/**
 * Atomic Profile activation engine.
 */
export class ProfileActivator {
  /**
   * @param deps Injected dependencies.
   */
  public constructor(private readonly deps: ProfileActivatorDeps) {}

  /**
   * Activate a profile across all targets atomically. Throws on
   * any failure with rollback already complete.
   * @param input Activation input.
   * @returns Activation outcome (state + per-target write log).
   */
  public async activate(input: ActivationInput): Promise<ActivationOutcome> {
    if (input.targets.length === 0) {
      throw new Error('PROFILE.ACTIVATION_NO_TARGETS: at least one target is required');
    }
    // Phase 1: resolve every bundle. No IO writes yet.
    const resolved = await this.resolveAll(input);
    // Phase 2: fetch + extract every bundle into memory.
    const materialized = await this.materializeAll(resolved);
    // Phase 3: write every bundle into every target. Track for rollback.
    const writer = new FileTreeTargetWriter({ fs: this.deps.fs, env: this.deps.env });
    const writtenByTarget: Record<string, string[]> = {};
    try {
      for (const t of input.targets) {
        writtenByTarget[t.name] = [];
        for (const m of materialized) {
          const result = await writer.write(t, m.files);
          writtenByTarget[t.name].push(...result.written);
        }
      }
    } catch (cause) {
      await this.rollback(writtenByTarget);
      const err = new Error(
        `PROFILE.ACTIVATION_FAILED: ${(cause as Error).message}`
      );
      (err as { code?: string }).code = 'PROFILE.ACTIVATION_FAILED';
      throw err;
    }
    const versions: Record<string, string> = {};
    for (const m of materialized) {
      versions[m.bundleId] = m.bundleVersion;
    }
    const state: ProfileActivationState = {
      hubId: input.hubId,
      profileId: input.profile.id,
      activatedAt: new Date().toISOString(),
      syncedBundles: materialized.map((m) => m.bundleId),
      syncedBundleVersions: versions,
      syncedTargets: input.targets.map((t) => t.name)
    };
    return { state, written: writtenByTarget };
  }

  private async resolveAll(input: ActivationInput): Promise<ResolvedBundle[]> {
    const out: ResolvedBundle[] = [];
    for (const b of input.profile.bundles) {
      const src = input.sources[b.source];
      if (src === undefined) {
        throw new Error(
          `PROFILE.SOURCE_MISSING: profile "${input.profile.id}" references source "${b.source}" not in hub`
        );
      }
      const resolver = this.resolverFor(src);
      if (resolver !== null) {
        const inst = await resolver.resolve({
          bundleId: b.id, bundleVersion: b.version === 'latest' ? undefined : b.version
        });
        if (inst === null) {
          throw new Error(
            `PROFILE.BUNDLE_NOT_FOUND: ${b.id}@${b.version} not in source ${b.source}`
          );
        }
        out.push({ bundleRef: b, source: src, installable: inst, kind: 'remote' });
      } else if (src.type === 'local') {
        out.push({ bundleRef: b, source: src, installable: null, kind: 'local' });
      } else {
        throw new Error(
          `PROFILE.SOURCE_UNSUPPORTED: source type "${src.type}" not implemented yet`
        );
      }
    }
    return out;
  }

  /**
   * Pick the right resolver for a source's type. Returns null when
   * the type has no remote resolver (e.g., `local` — handled by
   * `readLocalBundle`).
   * @param src Source.
   * @returns Resolver instance or null.
   */
  private resolverFor(src: RegistrySource): {
    resolve: (s: { bundleId: string; bundleVersion: string | undefined }) => Promise<Installable | null>;
  } | null {
    if (src.type === 'github') {
      return new GitHubBundleResolver({
        repoSlug: this.repoSlug(src.url), http: this.deps.http, tokens: this.deps.tokens
      });
    }
    if (src.type === 'awesome-copilot') {
      const config = (src as { config?: { branch?: string; collectionsPath?: string } }).config ?? {};
      return new AwesomeCopilotBundleResolver({
        repoSlug: this.repoSlug(src.url),
        branch: config.branch,
        collectionsPath: config.collectionsPath,
        http: this.deps.http,
        tokens: this.deps.tokens
      });
    }
    if (src.type === 'skills') {
      return new SkillsBundleResolver({
        repoSlug: this.repoSlug(src.url),
        ref: (src as { ref?: string }).ref,
        http: this.deps.http,
        tokens: this.deps.tokens
      });
    }
    if (src.type === 'local-skills') {
      return new LocalSkillsBundleResolver({
        rootPath: src.url, fs: this.deps.fs
      });
    }
    if (src.type === 'local-awesome-copilot') {
      const config = (src as { config?: { collectionsPath?: string } }).config ?? {};
      return new LocalAwesomeCopilotBundleResolver({
        rootPath: src.url,
        collectionsPath: config.collectionsPath,
        fs: this.deps.fs
      });
    }
    return null;
  }

  /**
   * Strip `https://github.com/` and trailing slashes from a source URL.
   * @param url
   */
  private repoSlug(url: string): string {
    return url
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '')
      .replace(/\/+$/, '');
  }

  private async materializeAll(resolved: ResolvedBundle[]): Promise<MaterializedBundle[]> {
    const out: MaterializedBundle[] = [];
    // Use the new shared AssetFetcher (lib/src/github/) so the bundle
    // download path gains retries on transient 5xx, the strict-Accept
    // switch for api.github.com release assets (I-012), and the inline-
    // bytes shortcut used by awesome-copilot/skills resolvers.
    const downloader = new HttpsBundleDownloader(
      new AssetFetcher({ tokens: this.deps.tokens })
    );
    const extractor = new YauzlBundleExtractor();
    for (const r of resolved) {
      let files: ExtractedFiles;
      if (r.kind === 'remote' && r.installable !== null) {
        const dl = await downloader.download(r.installable);
        files = await extractor.extract(dl.bytes);
      } else {
        // local: read the directory pointed at by source.url
        files = await readLocalBundle(r.source.url, this.deps.fs);
      }
      // For hub-driven activation we trust the source+release as
      // the bundle's identity; the hub config's `id` is often a
      // synthesized "owner-repo-bundle" string that does not match
      // the manifest's natural id (and we never used it to fetch
      // the bytes anyway). Validate version when explicit.
      const manifest = validateManifest(files, {
        expectedVersion: r.bundleRef.version === 'latest' ? undefined : r.bundleRef.version
      });
      out.push({
        bundleId: manifest.id,
        bundleVersion: manifest.version,
        files
      });
    }
    return out;
  }

  private async rollback(writtenByTarget: Record<string, string[]>): Promise<void> {
    for (const files of Object.values(writtenByTarget)) {
      for (const f of files) {
        try {
          await this.deps.fs.remove(f);
        } catch {
          // best-effort; rollback continues
        }
      }
    }
    // Clean up empty parent directories left by partial writes.
    for (const files of Object.values(writtenByTarget)) {
      const dirs = new Set(files.map((f) => path.dirname(f)));
      for (const d of dirs) {
        try {
          const entries = await this.deps.fs.readDir(d);
          if (entries.length === 0) {
            await this.deps.fs.remove(d);
          }
        } catch {
          // best-effort
        }
      }
    }
  }
}

interface ResolvedBundle {
  bundleRef: { id: string; version: string; source: string; required: boolean };
  source: RegistrySource;
  installable: Installable | null;
  kind: 'remote' | 'local';
}

interface MaterializedBundle {
  bundleId: string;
  bundleVersion: string;
  files: ExtractedFiles;
}

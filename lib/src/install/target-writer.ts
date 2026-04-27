/**
 * Phase 5 / Iter 16-17 — TargetWriter interface + FileTreeTargetWriter.
 *
 * Writer = "given a Target, an Installable's manifest, and the
 * extracted file map, route the bundle's primitive files into the
 * target's filesystem layout".
 *
 * The four target types (`vscode`, `copilot-cli`, `kiro`, `windsurf`)
 * differ only in:
 *   1. The base directory (host-specific User Data dir or workspace).
 *   2. The per-kind subdirectory (e.g. `prompts/`, `chatmodes/`,
 *      `instructions/`).
 *   3. The list of accepted primitive kinds.
 *
 * `FileTreeTargetWriter` consolidates all four behind a single
 * implementation parameterized by a `TargetLayout`. Each Target type
 * has a `defaultLayout()` factory; user overrides via `target.path`
 * replace the base dir; user overrides via `target.allowedKinds`
 * replace the accepted-kinds list.
 *
 * The writer is fully Context-driven: no Node globals, all IO
 * through the injected `WriterFs`.
 */
import * as path from 'node:path';
import type {
  Target,
} from '../domain/install';
import type {
  ExtractedFiles,
} from './extractor';

export interface WriterFs {
  writeFile(p: string, contents: string): Promise<void>;
  mkdir(p: string, opts?: { recursive?: boolean }): Promise<void>;
}

export interface TargetWriteResult {
  /** Absolute paths of files written. */
  written: string[];
  /** Files in the bundle that were skipped (kind not allowed). */
  skipped: string[];
}

export interface TargetWriter {
  /**
   * Write the bundle into the target.
   * @param target - Target chosen via `--target <name>`.
   * @param files - Extracted bundle files.
   * @returns TargetWriteResult.
   */
  write(target: Target, files: ExtractedFiles): Promise<TargetWriteResult>;
}

/** Mapping from a primitive kind to a relative subdirectory. */
export type KindRoutes = Record<string, string>;

export interface TargetLayout {
  /** Base directory the writer writes into (post-${VAR} expansion). */
  baseDir: string;
  /** Map: bundle subpath prefix → output subpath under baseDir. */
  kindRoutes: KindRoutes;
  /** Bundle-relative paths to skip (manifests, READMEs, etc.). */
  skipPaths?: string[];
}

/** Default layout per Target type. Resolved against `target.path` later. */
const DEFAULT_LAYOUT_BY_TYPE: Record<Target['type'], (t: Target) => TargetLayout> = {
  vscode: (t): TargetLayout => ({
    baseDir: t.path ?? '${HOME}/.config/Code/User',
    kindRoutes: {
      'prompts/': 'prompts/',
      'chatmodes/': 'chatmodes/',
      'instructions/': 'instructions/'
    },
    skipPaths: ['deployment-manifest.yml', 'README.md']
  }),
  // eslint-disable-next-line @typescript-eslint/naming-convention -- vscode-insiders is a fixed external identifier
  'vscode-insiders': (t: Target): TargetLayout => ({
    baseDir: t.path ?? '${HOME}/.config/Code - Insiders/User',
    kindRoutes: {
      'prompts/': 'prompts/',
      'chatmodes/': 'chatmodes/',
      'instructions/': 'instructions/'
    },
    skipPaths: ['deployment-manifest.yml', 'README.md']
  }),
  // eslint-disable-next-line @typescript-eslint/naming-convention -- copilot-cli is a fixed external identifier
  'copilot-cli': (t: Target): TargetLayout => ({
    baseDir: t.path ?? '${HOME}/.config/github-copilot',
    kindRoutes: { 'prompts/': 'prompts/' },
    skipPaths: ['deployment-manifest.yml', 'README.md']
  }),
  kiro: (t): TargetLayout => ({
    baseDir: t.path ?? '${HOME}/.kiro',
    kindRoutes: {
      'prompts/': 'prompts/',
      'agents/': 'agents/',
      'chatmodes/': 'chatmodes/',
      'instructions/': 'instructions/'
    },
    skipPaths: ['deployment-manifest.yml', 'README.md']
  }),
  windsurf: (t): TargetLayout => ({
    baseDir: t.path ?? '${HOME}/.codeium/windsurf',
    kindRoutes: {
      'prompts/': 'rules/',
      'agents/': 'workflows/',
      'instructions/': 'rules/'
    },
    skipPaths: ['deployment-manifest.yml', 'README.md']
  }),
  // D18 / iter 39-41: Anthropic Claude Code. Default base dir is
  // `${HOME}/.claude` (matching the conventional Claude Code config
  // dir). Layout mirrors kiro's permissive routing — prompts go to
  // commands/, agents/instructions land in their own subdirs.
  // eslint-disable-next-line @typescript-eslint/naming-convention -- claude-code is a fixed external identifier
  'claude-code': (t: Target): TargetLayout => ({
    baseDir: t.path ?? '${HOME}/.claude',
    kindRoutes: {
      'prompts/': 'commands/',
      'agents/': 'agents/',
      'instructions/': 'instructions/',
      'chatmodes/': 'modes/'
    },
    skipPaths: ['deployment-manifest.yml', 'README.md']
  })
};

/**
 * Resolve the layout for a given Target (default layout overridden by
 * `target.path`). Pure; no IO.
 * @param target - Target to resolve.
 * @returns Resolved TargetLayout.
 */
export const resolveLayout = (target: Target): TargetLayout => {
  const factory = DEFAULT_LAYOUT_BY_TYPE[target.type];
  return factory(target);
};

/**
 * Expand `${VAR}` and leading `~` in a path. Pure; HOME comes from the
 * injected env map.
 * @param p - Path with possible ${VAR} or ~ tokens.
 * @param env - Process env map.
 * @returns Expanded path.
 */
export const expandPath = (p: string, env: Record<string, string | undefined>): string => {
  let out = p.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => env[name] ?? '');
  if (out.startsWith('~')) {
    const home = env.HOME ?? env.USERPROFILE ?? '';
    out = home + out.slice(1);
  }
  return out;
};

export interface FileTreeTargetWriterOptions {
  fs: WriterFs;
  /** Process env, used for ${VAR} expansion. */
  env: Record<string, string | undefined>;
}

/**
 * Generic writer that routes bundle files into a target tree using
 * the layout returned by resolveLayout(target).
 */
export class FileTreeTargetWriter implements TargetWriter {
  public constructor(private readonly opts: FileTreeTargetWriterOptions) {}

  /**
   * Write the bundle into the target.
   * @param target - Target chosen via `--target <name>`.
   * @param files - Extracted bundle files.
   * @returns TargetWriteResult.
   */
  public async write(target: Target, files: ExtractedFiles): Promise<TargetWriteResult> {
    const layout = resolveLayout(target);
    const baseDir = expandPath(layout.baseDir, this.opts.env);
    const skip = new Set(layout.skipPaths);
    const allowed = target.allowedKinds === undefined ? null : new Set(target.allowedKinds);
    const written: string[] = [];
    const skipped: string[] = [];

    // Eager mkdir of the routed-kind directories; reduces churn over
    // calling mkdir per file. Per-kind subdir creation is recursive
    // so root + nested dirs are covered.
    for (const sub of Object.values(layout.kindRoutes)) {
      await this.opts.fs.mkdir(path.join(baseDir, sub), { recursive: true });
    }

    for (const [bundlePath, bytes] of files) {
      if (skip.has(bundlePath)) {
        continue;
      }
      const route = pickRoute(bundlePath, layout.kindRoutes);
      if (route === null) {
        // Unrouted file; not an error (bundles may carry extras).
        skipped.push(bundlePath);
        continue;
      }
      // Skip when allowedKinds explicitly excludes this kind.
      if (allowed !== null && !allowed.has(routeToKind(route.prefix))) {
        skipped.push(bundlePath);
        continue;
      }
      const outPath = path.join(baseDir, route.outPrefix, route.tail);
      await this.opts.fs.mkdir(path.dirname(outPath), { recursive: true });
      await this.opts.fs.writeFile(outPath, new TextDecoder().decode(bytes));
      written.push(outPath);
    }
    return { written, skipped };
  }
}

interface PickedRoute {
  prefix: string;
  outPrefix: string;
  tail: string;
}

const pickRoute = (bundlePath: string, routes: KindRoutes): PickedRoute | null => {
  for (const [prefix, outPrefix] of Object.entries(routes)) {
    if (bundlePath.startsWith(prefix)) {
      return { prefix, outPrefix, tail: bundlePath.slice(prefix.length) };
    }
  }
  return null;
};

/**
 * Map a layout prefix back to the primitive kind it represents.
 * Used to honor `target.allowedKinds`.
 * @param prefix - Layout prefix (e.g., "prompts/").
 * @returns Kind name without trailing slash.
 */
const routeToKind = (prefix: string): string => prefix.replace(/\/$/, '');

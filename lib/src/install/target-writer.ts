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
} from '../ports/bundle-extractor';
import type {
  TargetWriteResult,
  TargetWriter,
} from '../ports/target-writer';

export type {
  ExtractedFiles,
} from '../ports/bundle-extractor';

export type {
  TargetWriteResult,
  TargetWriter,
} from '../ports/target-writer';

export interface WriterFs {
  writeFile(p: string, contents: string): Promise<void>;
  mkdir(p: string, opts?: { recursive?: boolean }): Promise<void>;
  remove(p: string): Promise<void>;
  exists(p: string): Promise<boolean>;
}

/**
 * Result of a remove operation.
 * Contains removed and skipped file paths.
 */
export interface TargetRemoveResult {
  /** Absolute paths of files removed. */
  removed: string[];
  /** Files not found (skipped). */
  skipped: string[];
}

/**
 * @deprecated Use {@link TargetWriter} from `../ports/target-writer` directly.
 * This re-exported interface stays here for backward compatibility.
 */

/**
 * Mapping from a primitive kind to a relative subdirectory.
 * Defines where each kind of primitive should be placed.
 */
export type KindRoutes = Record<string, string>;

/**
 * Target layout configuration.
 * Defines base directory and routing for different primitive kinds.
 */
export interface TargetLayout {
  /** Base directory the writer writes into (post-${VAR} expansion). */
  baseDir: string;
  /** Map: bundle subpath prefix → output subpath under baseDir. */
  kindRoutes: KindRoutes;
  /** Bundle-relative paths to skip (manifests, READMEs, etc.). */
  skipPaths?: string[];
}

/**
 * Default layout per Target type.
 * Resolved against `target.path` (and `target.scope`) later.
 *
 * Scope-aware layouts (user vs repository) are based on the
 * per-ecosystem conventions documented in
 * `docs/contributor-guide/cascade-model-study.md §9-10`.
 */
const DEFAULT_LAYOUT_BY_TYPE: Record<Target['type'], (t: Target) => TargetLayout> = {
  // NOTE on agent/skill distinction across all layouts:
  //   skills/ → Agent Skills standard (SKILL.md + folder of supporting resources).
  //             Discovered from well-known locations by all tools.
  //   agents/ → Custom agent definitions (.agent.md for Copilot, *.json for Kiro,
  //             YAML subagents for Claude Code). Format is tool-specific and
  //             NOT the same as skills. Only route agents/ where the tool has a
  //             defined standalone agent directory outside of plugins.
  vscode: (t): TargetLayout => {
    if (t.scope === 'repository') {
      // Repository scope: VS Code Copilot reads from .github/ subdirs.
      // prompts/ → .github/prompts/  (reusable .prompt.md files)
      // instructions/ → .github/instructions/  (path-scoped .instructions.md)
      // chatmodes/ → .github/chatmodes/
      // skills/ → .github/skills/  (Agent Skills standard — SKILL.md + resources)
      // agents/: NOT routed — Copilot custom agents are bundled in plugins
      //          (agents/*.agent.md inside plugin.json bundles), not raw repo files.
      const base = t.workspaceRoot ?? t.path ?? '.';
      return {
        baseDir: base,
        kindRoutes: {
          'prompts/': '.github/prompts/',
          'chatmodes/': '.github/chatmodes/',
          'instructions/': '.github/instructions/',
          'skills/': '.github/skills/'
        },
        skipPaths: ['deployment-manifest.yml', 'README.md']
      };
    }
    // User scope: VS Code stores user-level prompt/instruction files
    // under the platform User Data directory.
    return {
      baseDir: t.path ?? '${HOME}/.config/Code/User',
      kindRoutes: {
        'prompts/': 'prompts/',
        'chatmodes/': 'chatmodes/',
        'instructions/': 'instructions/',
        'skills/': 'skills/'
      },
      skipPaths: ['deployment-manifest.yml', 'README.md']
    };
  },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- vscode-insiders is a fixed external identifier
  'vscode-insiders': (t: Target): TargetLayout => {
    if (t.scope === 'repository') {
      const base = t.workspaceRoot ?? t.path ?? '.';
      return {
        baseDir: base,
        kindRoutes: {
          'prompts/': '.github/prompts/',
          'chatmodes/': '.github/chatmodes/',
          'instructions/': '.github/instructions/',
          'skills/': '.github/skills/'
        },
        skipPaths: ['deployment-manifest.yml', 'README.md']
      };
    }
    return {
      baseDir: t.path ?? '${HOME}/.config/Code - Insiders/User',
      kindRoutes: {
        'prompts/': 'prompts/',
        'chatmodes/': 'chatmodes/',
        'instructions/': 'instructions/',
        'skills/': 'skills/'
      },
      skipPaths: ['deployment-manifest.yml', 'README.md']
    };
  },

  // copilot-cli is user-scope only. Base: ~/.copilot (not ~/.config/github-copilot).
  // Skills go to skills/ (Agent Skills standard — SKILL.md + resources).
  // agents/: NOT routed — Copilot CLI agents are plugin-distributed, not user-level files.
  'copilot-cli': (t: Target): TargetLayout => ({
    baseDir: t.path ?? '${HOME}/.copilot',
    kindRoutes: {
      'prompts/': 'prompts/',
      'skills/': 'skills/'
    },
    skipPaths: ['deployment-manifest.yml', 'README.md']
  }),
  // Kiro uses "steering files" for prompts/instructions; agents go to
  // .kiro/agents/ (JSON config format). No chatmodes concept.
  // skills/ → skills/ (Kiro supports Agent Skills standard at ~/.kiro/skills/).
  kiro: (t): TargetLayout => {
    if (t.scope === 'repository') {
      const base = t.workspaceRoot ?? t.path ?? '.';
      return {
        baseDir: base,
        kindRoutes: {
          'prompts/': '.kiro/steering/',
          'agents/': '.kiro/agents/',
          'instructions/': '.kiro/steering/',
          'skills/': '.kiro/skills/'
        },
        skipPaths: ['deployment-manifest.yml', 'README.md']
      };
    }
    return {
      baseDir: t.path ?? '${HOME}/.kiro',
      kindRoutes: {
        'prompts/': 'steering/',
        'agents/': 'agents/',
        'instructions/': 'steering/',
        'skills/': 'skills/'
      },
      skipPaths: ['deployment-manifest.yml', 'README.md']
    };
  },
  // Windsurf: prompts/instructions → rules/ (Cascade rules mechanism).
  // skills/ → skills/ (Agent Skills standard; Windsurf scans .windsurf/skills/).
  // agents/: NOT routed — Windsurf has no native custom agent concept;
  //          Rules+Skills are the equivalent abstraction.
  // Repository scope uses .windsurf/ prefix for workspace-level primitives.
  windsurf: (t): TargetLayout => {
    if (t.scope === 'repository') {
      const base = t.workspaceRoot ?? t.path ?? '.';
      return {
        baseDir: base,
        kindRoutes: {
          'prompts/': '.windsurf/rules/',
          'instructions/': '.windsurf/rules/',
          'skills/': '.windsurf/skills/'
        },
        skipPaths: ['deployment-manifest.yml', 'README.md']
      };
    }
    return {
      baseDir: t.path ?? '${HOME}/.codeium/windsurf',
      kindRoutes: {
        'prompts/': 'rules/',
        'instructions/': 'rules/',
        'skills/': 'skills/'
      },
      skipPaths: ['deployment-manifest.yml', 'README.md']
    };
  },
  // D18 / iter 39-41: Anthropic Claude Code. Default base dir is
  // `${HOME}/.claude`. prompts → commands/, subagents go to agents/,
  // skills → skills/ (Agent Skills standard; Claude Code scans .claude/skills/).
  // Repository scope uses .claude/ prefix for workspace-level config.
  // eslint-disable-next-line @typescript-eslint/naming-convention -- claude-code is a fixed external identifier
  'claude-code': (t: Target): TargetLayout => {
    if (t.scope === 'repository') {
      const base = t.workspaceRoot ?? t.path ?? '.';
      return {
        baseDir: base,
        kindRoutes: {
          'prompts/': '.claude/commands/',
          'agents/': '.claude/agents/',
          'instructions/': '.claude/instructions/',
          'chatmodes/': '.claude/modes/',
          'skills/': '.claude/skills/'
        },
        skipPaths: ['deployment-manifest.yml', 'README.md']
      };
    }
    return {
      baseDir: t.path ?? '${HOME}/.claude',
      kindRoutes: {
        'prompts/': 'commands/',
        'agents/': 'agents/',
        'instructions/': 'instructions/',
        'chatmodes/': 'modes/',
        'skills/': 'skills/'
      },
      skipPaths: ['deployment-manifest.yml', 'README.md']
    };
  }
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
  let out = p.replaceAll(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => env[name] ?? '');
  if (out.startsWith('~')) {
    const home = env.HOME ?? env.USERPROFILE ?? '';
    out = home + out.slice(1);
  }
  return out;
};

/**
 * Options for FileTreeTargetWriter.
 */
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
  /**
   * Construct a FileTreeTargetWriter.
   * @param opts Writer options including filesystem and environment.
   */
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

  /**
   * Phase 1 Step 1.8: Remove a file from the target.
   * @param target - Target chosen via `--target <name>`.
   * @param filePath - Relative file path to remove (from bundle root).
   */
  public async remove(target: Target, filePath: string): Promise<void> {
    const layout = resolveLayout(target);
    const baseDir = expandPath(layout.baseDir, this.opts.env);
    const route = pickRoute(filePath, layout.kindRoutes);
    if (route === null) {
      return; // Unrouted file, nothing to do
    }
    const outPath = path.join(baseDir, route.outPrefix, route.tail);
    await this.opts.fs.remove(outPath);
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

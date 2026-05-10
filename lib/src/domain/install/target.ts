/**
 * Phase 1 / Step 1.2 — Target type (rclone-style install destinations).
 *
 * A Target is a typed, named entry that tells `prompt-registry install`
 * where to write a bundle. The shape mirrors `rclone`'s "remotes":
 * each entry carries a `type` discriminant plus per-type fields. Spec
 * §5.6 / §8.1 / §14.1.
 *
 * Six types are reserved by the spec (D18 added claude-code):
 *   `vscode`           → User VS Code install (settings + prompts).
 *   `vscode-insiders`  → Insiders variant.
 *   `copilot-cli`      → GitHub Copilot CLI prompts directory.
 *   `kiro`             → Kiro IDE config dir.
 *   `windsurf`         → Windsurf editor config dir.
 *   `claude-code`      → Anthropic Claude Code config dir.
 *
 * Per-type fields (scope, paths, profile id, allowedKinds) live on
 * each variant. Unknown types are tolerated by the loader (warning,
 * not error) per spec §8.1 forward-compat clause.
 *
 * Phase 1 Step 1.2: Scope unification:
 * - Changed from `scope: 'user' | 'workspace'` to `scope: 'user' | 'repository'`
 * - Dropped `workspace` scope per user decision
 * - Added `commitMode?: 'commit' | 'local-only'` for repository scope
 * - Added `workspaceRoot?: string` for repository scope targets
 */

/**
 * All target types known to the spec.
 */
export const TARGET_TYPES = [
  'vscode',
  'vscode-insiders',
  'copilot-cli',
  'kiro',
  'windsurf',
  'claude-code'
] as const;

/**
 * Target type discriminant.
 */
export type TargetType = typeof TARGET_TYPES[number];

/**
 * Common fields every Target carries.
 */
export interface TargetCommon {
  /** Unique identifier, looked up by `install --target <name>`. */
  name: string;
  /** Discriminant for the per-type fields. */
  type: TargetType;
}

/**
 * vscode / vscode-insiders entry.
 */
export interface VsCodeTarget extends TargetCommon {
  type: 'vscode' | 'vscode-insiders';
  /** Primary scope: 'user' (host User dir) or 'repository' (.github/). */
  scope: 'user' | 'repository';
  /** Override path; falls back to platform default if omitted. */
  path?: string;
  /** Restrict which primitive kinds this target accepts. */
  allowedKinds?: string[];
  /** Commit mode for repository scope: tracked by git or excluded. */
  commitMode?: 'commit' | 'local-only';
  /** Workspace root path (required for repository scope). */
  workspaceRoot?: string;
}

/**
 * copilot-cli entry.
 */
export interface CopilotCliTarget extends TargetCommon {
  type: 'copilot-cli';
  scope: 'user';
  path?: string;
  allowedKinds?: string[];
  /** Commit mode for repository scope: tracked by git or excluded. */
  commitMode?: 'commit' | 'local-only';
  /** Workspace root path (required for repository scope). */
  workspaceRoot?: string;
}

/**
 * Kiro IDE entry.
 */
export interface KiroTarget extends TargetCommon {
  type: 'kiro';
  scope: 'user' | 'repository';
  path?: string;
  allowedKinds?: string[];
  /** Commit mode for repository scope: tracked by git or excluded. */
  commitMode?: 'commit' | 'local-only';
  /** Workspace root path (required for repository scope). */
  workspaceRoot?: string;
}

/**
 * Windsurf editor entry.
 */
export interface WindsurfTarget extends TargetCommon {
  type: 'windsurf';
  scope: 'user' | 'repository';
  path?: string;
  allowedKinds?: string[];
  /** Commit mode for repository scope: tracked by git or excluded. */
  commitMode?: 'commit' | 'local-only';
  /** Workspace root path (required for repository scope). */
  workspaceRoot?: string;
}

/**
 * Anthropic Claude Code entry. (D18 / iter 39)
 */
export interface ClaudeCodeTarget extends TargetCommon {
  type: 'claude-code';
  scope: 'user' | 'repository';
  path?: string;
  allowedKinds?: string[];
  /** Commit mode for repository scope: tracked by git or excluded. */
  commitMode?: 'commit' | 'local-only';
  /** Workspace root path (required for repository scope). */
  workspaceRoot?: string;
}

/**
 * Tagged union of every Target type.
 */
export type Target =
  | VsCodeTarget
  | CopilotCliTarget
  | KiroTarget
  | WindsurfTarget
  | ClaudeCodeTarget;

/**
 * Type guard for `Target`. Pure; no IO.
 * @param x - Value to inspect (typically a parsed YAML node).
 * @returns true iff `x` matches the Target shape.
 */
export const isTarget = (x: unknown): x is Target => {
  if (x === null || typeof x !== 'object') {
    return false;
  }
  const obj = x as Record<string, unknown>;
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    return false;
  }
  if (typeof obj.type !== 'string') {
    return false;
  }
  if (!(TARGET_TYPES as readonly string[]).includes(obj.type)) {
    return false;
  }
  // Validate scope field
  if (obj.scope !== undefined && typeof obj.scope === 'string') {
    const validScopes = ['user', 'repository'];
    if (!validScopes.includes(obj.scope)) {
      return false;
    }
  }
  // Validate commitMode if present
  if (obj.commitMode !== undefined && typeof obj.commitMode === 'string') {
    const validModes = ['commit', 'local-only'];
    if (!validModes.includes(obj.commitMode)) {
      return false;
    }
  }
  return true;
};

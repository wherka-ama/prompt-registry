/**
 * Phase 5 / Iter 1 — Target type (rclone-style install destinations).
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
 */

/** All target types known to the spec. */
export const TARGET_TYPES = [
  'vscode',
  'vscode-insiders',
  'copilot-cli',
  'kiro',
  'windsurf',
  'claude-code'
] as const;

export type TargetType = typeof TARGET_TYPES[number];

/** Common fields every Target carries. */
export interface TargetCommon {
  /** Unique identifier, looked up by `install --target <name>`. */
  name: string;
  /** Discriminant for the per-type fields. */
  type: TargetType;
}

/** vscode / vscode-insiders entry. */
export interface VsCodeTarget extends TargetCommon {
  type: 'vscode' | 'vscode-insiders';
  /** Primary scope: 'user' (host User dir) or 'workspace' (.vscode/). */
  scope: 'user' | 'workspace';
  /** Override path; falls back to platform default if omitted. */
  path?: string;
  /** Restrict which primitive kinds this target accepts. */
  allowedKinds?: string[];
}

/** copilot-cli entry. */
export interface CopilotCliTarget extends TargetCommon {
  type: 'copilot-cli';
  scope: 'user';
  path?: string;
  allowedKinds?: string[];
}

/** Kiro IDE entry. */
export interface KiroTarget extends TargetCommon {
  type: 'kiro';
  scope: 'user' | 'workspace';
  path?: string;
  allowedKinds?: string[];
}

/** Windsurf editor entry. */
export interface WindsurfTarget extends TargetCommon {
  type: 'windsurf';
  scope: 'user' | 'workspace';
  path?: string;
  allowedKinds?: string[];
}

/** Anthropic Claude Code entry. (D18 / iter 39) */
export interface ClaudeCodeTarget extends TargetCommon {
  type: 'claude-code';
  scope: 'user' | 'workspace';
  path?: string;
  allowedKinds?: string[];
}

/** Tagged union of every Target type. */
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
  return (TARGET_TYPES as readonly string[]).includes(obj.type);
};

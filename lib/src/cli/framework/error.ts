/**
 * Phase 2 / Iter 6 — RegistryError + renderError.
 *
 * Spec §10 / decision D5:
 *   class RegistryError {
 *     code:      `${Namespace}.${UPPER_SNAKE}`,  // 11 namespaces locked iter 23
 *     message:   string,
 *     hint?:     string,
 *     docsUrl?:  string,
 *     cause?:    unknown,
 *     context?:  Record<string, unknown>
 *   }
 *
 * Codes follow `NAMESPACE.UPPER_SNAKE_CASE` where `NAMESPACE` is one of
 * the 11 locked categories. Construction validates the format eagerly
 * so a typo'd code fails at the throw site, not at the renderer.
 *
 * `toJSON()` produces the `OutputError` shape iter-5's `formatOutput`
 * expects — they round-trip cleanly.
 *
 * `renderError(err, ctx)` writes a multi-line text rendering to
 * `ctx.stderr` for the human (text-mode) case. JSON-mode rendering
 * goes through `formatOutput({ status: 'error', errors: [err.toJSON()] })`.
 */
import type {
  Context,
} from './context';
import type {
  OutputError,
} from './output';

const NAMESPACES = [
  'BUNDLE', 'INDEX', 'HUB', 'PRIMITIVE',
  'CONFIG', 'NETWORK', 'AUTH', 'FS',
  'PLUGIN', 'USAGE', 'INTERNAL'
] as const;
export type RegistryErrorNamespace = (typeof NAMESPACES)[number];

const CODE_PATTERN = /^([A-Z]+)\.[A-Z][A-Z0-9_]*$/;

/**
 * Construction options for {@link RegistryError}.
 */
export interface RegistryErrorOptions {
  code: string;
  message: string;
  hint?: string;
  docsUrl?: string;
  cause?: unknown;
  context?: Record<string, unknown>;
}

/**
 * Domain-specific error class. All error paths in command code should
 * throw `RegistryError` so the renderer can produce consistent output
 * for both text and JSON modes.
 */
export class RegistryError extends Error {
  public readonly code: string;
  public readonly hint?: string;
  public readonly docsUrl?: string;
  public readonly context?: Record<string, unknown>;
  // We declare `cause` explicitly because the project's tsconfig targets
  // ES2020, which predates the ES2022 `Error.cause` typing. Once the
  // lib is bumped to ES2022 we can remove this and rely on the built-in.
  public readonly cause?: unknown;

  public constructor(opts: RegistryErrorOptions) {
    super(opts.message);
    validateCode(opts.code);
    this.name = 'RegistryError';
    this.code = opts.code;
    this.hint = opts.hint;
    this.docsUrl = opts.docsUrl;
    this.context = opts.context;
    this.cause = opts.cause;
  }

  /**
   * Serialize to the {@link OutputError} shape consumed by the JSON
   * envelope in `formatOutput()`. Optional fields are omitted (not
   * `undefined`) so JSON consumers get a clean object.
   * @returns Output-friendly representation.
   */
  public toJSON(): OutputError {
    const out: OutputError = {
      code: this.code,
      message: this.message
    };
    if (this.hint !== undefined) {
      out.hint = this.hint;
    }
    if (this.docsUrl !== undefined) {
      out.docsUrl = this.docsUrl;
    }
    if (this.context !== undefined) {
      out.context = this.context;
    }
    return out;
  }
}

const validateCode = (code: string): void => {
  const m = CODE_PATTERN.exec(code);
  if (m === null) {
    throw new TypeError(
      `Invalid RegistryError code "${code}": expected NAMESPACE.UPPER_SNAKE format`
    );
  }
  const ns = m[1];
  if (!(NAMESPACES as readonly string[]).includes(ns)) {
    throw new TypeError(
      `Invalid RegistryError namespace "${ns}" in code "${code}": expected one of ${NAMESPACES.join(', ')}`
    );
  }
};

/**
 * Type guard for RegistryError. Use over `instanceof` when crossing
 * module boundaries where multiple realms might supply different
 * RegistryError prototypes (rare but defensive).
 * @param value Anything.
 * @returns Whether `value` is a RegistryError.
 */
export const isRegistryError = (value: unknown): value is RegistryError =>
  value instanceof RegistryError;

/**
 * Render an error to `ctx.stderr` for human consumption. The output
 * shape is:
 *
 *   error[CODE]: <message>
 *     hint: <hint>
 *     docs: <docsUrl>
 *
 * where the hint and docs lines are omitted when absent.
 *
 * Non-RegistryError values are wrapped as `INTERNAL.UNEXPECTED` so the
 * renderer is total — callers do not need to type-narrow before
 * delegating to it.
 * @param err Anything thrown — RegistryError or otherwise.
 * @param ctx Context whose stderr will receive the rendering.
 */
export const renderError = (err: unknown, ctx: Context): void => {
  const re = isRegistryError(err) ? err : asInternalError(err);
  const lines: string[] = [`error[${re.code}]: ${re.message}`];
  if (re.hint !== undefined) {
    lines.push(`  hint: ${re.hint}`);
  }
  if (re.docsUrl !== undefined) {
    lines.push(`  docs: ${re.docsUrl}`);
  }
  ctx.stderr.write(`${lines.join('\n')}\n`);
};

const asInternalError = (err: unknown): RegistryError => {
  const message = err instanceof Error ? err.message : String(err);
  return new RegistryError({
    code: 'INTERNAL.UNEXPECTED',
    message,
    cause: err
  });
};

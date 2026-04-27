/**
 * Phase 5 / Iter 2 — Target store: read/write `targets[]` in the
 * project config file (`prompt-registry.yml` or `prompt-registry.yaml`).
 *
 * Keeps round-trip *simple*, not perfect: we read the whole YAML
 * mapping, mutate the `targets` array, and re-emit. Comments and
 * key-ordering aren't preserved (`js-yaml` doesn't surface them).
 * That's an acceptable trade for a single-file, single-section
 * mutation; users editing comment-rich configs are advised to use
 * `prompt-registry config list` to inspect and hand-edit until the
 * round-trip is upgraded.
 *
 * The store does **not** consume the layered `loadConfig`. Layered
 * config is for reading; persistence has to land in *one* file
 * (the project file). Writes always target the nearest project
 * config in the upward walk; if none exists, we create one in `cwd`.
 */
import * as path from 'node:path';
import {
  load as parseYaml,
  dump as stringifyYaml,
} from 'js-yaml';
import type {
  ConfigFs,
} from '../cli/framework/config';
import type {
  Target,
} from '../domain/install';

const PROJECT_CONFIG_NAMES = ['prompt-registry.yml', 'prompt-registry.yaml'];

export interface TargetStoreOptions {
  /** Working directory; upward walk starts here. */
  cwd: string;
  /** ConfigFs adapter (read+write subset). */
  fs: ConfigFs & {
    writeFile(path: string, contents: string): Promise<void>;
    mkdir?(path: string, opts?: { recursive?: boolean }): Promise<void>;
  };
}

/**
 * Find the project config path nearest to `cwd` (cargo upward walk).
 * Falls back to `cwd/prompt-registry.yml` when no config exists.
 * @param opts cwd / fs.
 * @returns Object `{ file, exists }`.
 */
export const findProjectConfigPath = async (
  opts: TargetStoreOptions
): Promise<{ file: string; exists: boolean }> => {
  let dir = opts.cwd;
  while (true) {
    for (const name of PROJECT_CONFIG_NAMES) {
      const candidate = path.join(dir, name);
      if (await opts.fs.exists(candidate)) {
        return { file: candidate, exists: true };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return { file: path.join(opts.cwd, PROJECT_CONFIG_NAMES[0]), exists: false };
    }
    dir = parent;
  }
};

/**
 * Read `targets[]` from the nearest project config. Returns an empty
 * array when no config or no targets[] is present.
 * @param opts cwd / fs.
 * @returns Targets array.
 */
export const readTargets = async (opts: TargetStoreOptions): Promise<Target[]> => {
  const { file, exists } = await findProjectConfigPath(opts);
  if (!exists) {
    return [];
  }
  const raw = await opts.fs.readFile(file);
  const parsed = parseYaml(raw) as Record<string, unknown> | null | undefined;
  if (parsed === null || parsed === undefined) {
    return [];
  }
  const targets = (parsed).targets;
  return Array.isArray(targets) ? (targets as Target[]) : [];
};

interface WriteTargetsResult {
  file: string;
  created: boolean;
}

/**
 * Replace `targets[]` in the nearest project config and persist.
 * Creates the file if it does not exist.
 * @param opts cwd / fs.
 * @param next New targets array (full replacement; not append).
 * @returns Result `{file, created}` so callers can render it back to the user.
 */
export const writeTargets = async (
  opts: TargetStoreOptions,
  next: Target[]
): Promise<WriteTargetsResult> => {
  const { file, exists } = await findProjectConfigPath(opts);
  let parsed: Record<string, unknown>;
  if (exists) {
    const raw = await opts.fs.readFile(file);
    const loaded = parseYaml(raw) as Record<string, unknown> | null | undefined;
    parsed = loaded === null || loaded === undefined ? {} : loaded;
  } else {
    parsed = {};
  }
  parsed.targets = next;
  const dumped = stringifyYaml(parsed, {
    // Stable key ordering keeps diffs minimal; writes pass through
    // existing keys unchanged because we mutate the parsed object
    // in place (parseYaml gives us back a plain JS object, so the
    // round-trip is a YAML→JS→YAML normalization step).
    sortKeys: false,
    lineWidth: 100,
    noRefs: true
  });
  if (!exists && opts.fs.mkdir !== undefined) {
    await opts.fs.mkdir(path.dirname(file), { recursive: true });
  }
  await opts.fs.writeFile(file, dumped);
  return { file, created: !exists };
};

/**
 * Append a target by name. Throws when a target with the same name
 * already exists.
 * @param opts cwd / fs.
 * @param target Target to add.
 * @returns Result `{file, created}` from writeTargets.
 */
export const addTarget = async (
  opts: TargetStoreOptions,
  target: Target
): Promise<WriteTargetsResult> => {
  const current = await readTargets(opts);
  if (current.some((t) => t.name === target.name)) {
    throw new Error(`target "${target.name}" already exists`);
  }
  return writeTargets(opts, [...current, target]);
};

/**
 * Remove a target by name. Throws when the name is not present.
 * @param opts cwd / fs.
 * @param name Target name to remove.
 * @returns Result `{file, created}` from writeTargets.
 */
export const removeTargetByName = async (
  opts: TargetStoreOptions,
  name: string
): Promise<WriteTargetsResult> => {
  const current = await readTargets(opts);
  const next = current.filter((t) => t.name !== name);
  if (next.length === current.length) {
    throw new Error(`target "${name}" not found`);
  }
  return writeTargets(opts, next);
};

/**
 * Hub config parser.
 *
 * Reads a hub-config.yml (as produced by the VS Code extension / hub schema)
 * and emits a minimal, normalised list of sources the primitive-index
 * harvester understands. Only `github` and `awesome-copilot` source types
 * are supported today; everything else is silently skipped (forward-compat).
 *
 * Unknown `config.*` keys are preserved under `rawConfig` so downstream
 * experiments can consume new fields without forcing a schema bump here.
 */

import * as yaml from 'js-yaml';

export interface HubSourceSpec {
  id: string;
  name: string;
  type: 'github' | 'awesome-copilot' | 'awesome-copilot-plugin';
  url: string;
  owner: string;
  repo: string;
  branch: string;
  /** For `awesome-copilot` sources: subdir containing collection bundles. */
  collectionsPath?: string;
  /**
   * For `awesome-copilot-plugin` sources: subdir containing plugin roots
   * (each plugin is `<pluginsPath>/<id>/.github/plugin/plugin.json`).
   * Defaults to "plugins" per PR #245 convention.
   */
  pluginsPath?: string;
  rawConfig?: Record<string, unknown>;
}

/**
 * Parse a hub-config.yml string (or already-parsed object) into normalised
 * source specs. Disabled sources and non-github hosts are filtered out.
 * @param input - Raw YAML string or already-parsed object.
 */
export function parseHubConfig(input: string | Record<string, unknown>): HubSourceSpec[] {
  const data = typeof input === 'string' ? (yaml.load(input) as Record<string, unknown>) : input;
  const raw = Array.isArray(data?.sources) ? (data.sources as Record<string, unknown>[]) : [];
  const out: HubSourceSpec[] = [];
  for (const entry of raw) {
    if (entry.enabled === false) {
      continue;
    }
    const type = entry.type as string | undefined;
    if (type !== 'github' && type !== 'awesome-copilot' && type !== 'awesome-copilot-plugin') {
      continue;
    }
    const url = typeof entry.url === 'string' ? entry.url : undefined;
    if (!url) {
      continue;
    }
    const ownerRepo = normalizeRepoFromUrl(url);
    if (!ownerRepo) {
      continue;
    }
    const config = (entry.config ?? {}) as Record<string, unknown>;
    const idStr = typeof entry.id === 'string' ? entry.id : `${ownerRepo.owner}-${ownerRepo.repo}`;
    const nameStr = typeof entry.name === 'string'
      ? entry.name
      : (typeof entry.id === 'string' ? entry.id : ownerRepo.repo);
    // Type-specific defaults. awesome-copilot-plugin defaults pluginsPath
    // to "plugins" (PR #245 convention); other types leave it undefined.
    const pluginsPath = type === 'awesome-copilot-plugin'
      ? (typeof config.pluginsPath === 'string' ? config.pluginsPath : 'plugins')
      : undefined;
    out.push({
      id: idStr,
      name: nameStr,
      type,
      url,
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      branch: typeof config.branch === 'string' ? config.branch : 'main',
      collectionsPath: typeof config.collectionsPath === 'string' ? config.collectionsPath : undefined,
      pluginsPath,
      rawConfig: config
    });
  }
  return out;
}

/**
 * Extract {owner, repo} from a GitHub clone/html URL. Handles trailing
 * slashes and a trailing `.git`. Returns undefined for non-github hosts.
 * @param url - URL to parse.
 */
export function normalizeRepoFromUrl(url: string): { owner: string; repo: string } | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') {
    return undefined;
  }
  const segments = u.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length < 2) {
    return undefined;
  }
  const [owner, repoRaw] = segments;
  const repo = repoRaw.endsWith('.git') ? repoRaw.slice(0, -4) : repoRaw;
  return { owner, repo };
}

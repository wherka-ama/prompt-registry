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
import type {
  HubSourceSpec,
} from '../../domain';

// Phase 3 / Iter 5 promoted HubSourceSpec into `lib/src/domain/hub/`.
// Iter 8 removed the back-compat re-export from this module after
// every in-tree consumer (and both public package barrels) was
// migrated to import from `domain` directly. This file's job is the
// `parseHubConfig` and `normalizeRepoFromUrl` helpers below; the
// type lives in `domain/hub/types.ts`.

/**
 * Parse a single hub-config entry into a HubSourceSpec.
 * Returns undefined if the entry should be filtered out.
 * @param entry - Raw config entry object.
 */
function parseHubConfigEntry(entry: Record<string, unknown>): HubSourceSpec | undefined {
  if (entry.enabled === false) {
    return undefined;
  }
  const type = entry.type as string | undefined;
  if (type !== 'github' && type !== 'awesome-copilot' && type !== 'awesome-copilot-plugin') {
    return undefined;
  }
  const url = typeof entry.url === 'string' ? entry.url : undefined;
  if (!url) {
    return undefined;
  }
  const ownerRepo = normalizeRepoFromUrl(url);
  if (!ownerRepo) {
    return undefined;
  }
  const config = (entry.config ?? {}) as Record<string, unknown>;
  const idStr = typeof entry.id === 'string' ? entry.id : `${ownerRepo.owner}-${ownerRepo.repo}`;
  let nameStr: string;
  if (typeof entry.name === 'string') {
    nameStr = entry.name;
  } else if (typeof entry.id === 'string') {
    nameStr = entry.id;
  } else {
    nameStr = ownerRepo.repo;
  }
  // Type-specific defaults. awesome-copilot-plugin defaults pluginsPath
  // to "plugins" (PR #245 convention); other types leave it undefined.
  let pluginsPath: string | undefined;
  if (type === 'awesome-copilot-plugin') {
    pluginsPath = typeof config.pluginsPath === 'string' ? config.pluginsPath : 'plugins';
  }
  return {
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
  };
}

/**
 * Parse a hub-config.yml string (or already-parsed object) into normalised
 * source specs. Disabled sources and non-github hosts are filtered out.
 * @param input - Raw YAML string or already-parsed object.
 */
export function parseHubConfig(input: string | Record<string, unknown>): HubSourceSpec[] {
  const data = typeof input === 'string' ? (yaml.load(input) as Record<string, unknown>) : input;
  const raw = Array.isArray(data?.sources) ? (data.sources as Record<string, unknown>[]) : [];
  return raw.flatMap((entry) => {
    const spec = parseHubConfigEntry(entry);
    return spec ? [spec] : [];
  });
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

/**
 * Hub harvest pipeline — orchestrates the full
 * "fetch hub-config → walk sources → write index" workflow.
 *
 * Extracted from the legacy `lib/src/primitive-index/cli.ts` so the
 * framework command (`prompt-registry index harvest`) and any other
 * caller can drive the same logic without re-implementing argv
 * plumbing.
 *
 * The function takes an `events` callback for observability — the
 * CLI command pipes those into stderr; tests can capture them.
 * @module primitive-index/hub-harvest-pipeline
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  HubSourceSpec,
} from '../domain';
import {
  defaultHubCacheDir,
  defaultIndexFile,
} from './default-paths';
import {
  BlobCache,
} from './hub/blob-cache';
import {
  BlobFetcher,
} from './hub/blob-fetcher';
import {
  EtagStore,
} from './hub/etag-store';
import {
  parseExtraSource,
} from './hub/extra-source';
import {
  GitHubApiClient,
} from './hub/github-api-client';
import {
  parseHubConfig,
} from './hub/hub-config';
import {
  HubHarvester,
  type HubHarvestEvent,
} from './hub/hub-harvester';
import {
  saveIndexWithIntegrity,
} from './hub/integrity';
import {
  redactToken,
  resolveGithubToken,
} from './hub/token-provider';
import {
  saveIndex,
} from './store';
import type {
  IndexStats,
} from './types';

export interface HubHarvestPipelineOptions {
  /** "owner/repo" — required unless `noHubConfig` or `hubConfigFile`. */
  hubRepo?: string;
  /** Branch / tag / commit. Defaults to `main`. */
  hubBranch?: string;
  /**
   * Read sources from a local YAML file instead of fetching
   * `hub-config.yml` from the hub repo. Useful for tests / dev.
   */
  hubConfigFile?: string;
  /**
   * Skip fetching the hub-config entirely; sources come from
   * `extraSources` only.
   */
  noHubConfig?: boolean;
  /** Override cache root. Defaults to `defaultHubCacheDir(hubRepo)`. */
  cacheDir?: string;
  /** Override progress-file path. Defaults to `<cacheDir>/progress.jsonl`. */
  progressFile?: string;
  /** Override output index file. Defaults to `defaultIndexFile()`. */
  outFile?: string;
  /** Concurrency. Default 4 (measured 5.3× speedup vs serial). */
  concurrency?: number;
  /** Optional token. Otherwise resolved via `resolveGithubToken`. */
  explicitToken?: string;
  /** Filter sources to this set of ids (after extra-source injection). */
  sourcesInclude?: string[];
  /** Filter out these source ids. */
  sourcesExclude?: string[];
  /** Inject synthetic sources via the `parseExtraSource` mini-DSL. */
  extraSources?: string[];
  /** Skip cache and re-fetch every blob. */
  force?: boolean;
  /** Walk sources but don't write the index. */
  dryRun?: boolean;
  /** Observer for harvester progress events. */
  onEvent?: (ev: HubHarvestEvent) => void;
  /** Observer for diagnostic messages (one per source-config decision). */
  onLog?: (msg: string) => void;
}

export interface HubHarvestPipelineResult {
  outFile: string;
  progressFile: string;
  cacheDir: string;
  stats: IndexStats;
  totals: {
    totalMs: number;
    done: number;
    error: number;
    skip: number;
    primitives: number;
    wallMs: number;
  };
  hub: {
    repo: string;
    branch: string;
    sources: number;
  };
  rateLimit: GitHubApiClient['lastRateLimit'];
  tokenSource: string;
}

/**
 * Run the full harvest pipeline. Throws on token-resolution failure
 * or invalid `hubRepo`; otherwise resolves with a structured summary
 * (consumed by the CLI command's JSON envelope).
 * @param opts Pipeline options (see {@link HubHarvestPipelineOptions}).
 * @param env Process env to read from. Defaults to `process.env`.
 * @returns Summary suitable for surfacing as JSON.
 */
export const harvestHub = async (
  opts: HubHarvestPipelineOptions,
  env: NodeJS.ProcessEnv = process.env
): Promise<HubHarvestPipelineResult> => {
  const noHubConfig = opts.noHubConfig === true;
  const hubConfigFile = opts.hubConfigFile;
  if (!noHubConfig && hubConfigFile === undefined && (opts.hubRepo === undefined || opts.hubRepo.length === 0)) {
    throw new Error('hubRepo is required (or set noHubConfig=true / hubConfigFile)');
  }
  const hubRepo = !noHubConfig && hubConfigFile === undefined
    ? opts.hubRepo as string
    : (opts.hubRepo ?? 'local/local');
  const hubBranch = opts.hubBranch ?? 'main';
  const hubId = noHubConfig || hubConfigFile !== undefined ? 'local' : hubRepo;
  const cacheDir = opts.cacheDir
    ?? defaultHubCacheDir(hubId, env as Parameters<typeof defaultHubCacheDir>[1]);
  const progressFile = opts.progressFile ?? path.join(cacheDir, 'progress.jsonl');
  const outFile = opts.outFile
    ?? defaultIndexFile(env as Parameters<typeof defaultIndexFile>[0]);
  const concurrency = opts.concurrency ?? 4;

  const token = await resolveGithubToken({ explicit: opts.explicitToken });
  if (token.token === undefined || token.token.length === 0) {
    throw new Error('No GitHub token available (tried explicit, env, gh CLI).');
  }
  const resolvedToken: string = token.token;
  const client = new GitHubApiClient({ token: resolvedToken });
  const [owner, repo] = hubRepo.split('/');
  if (owner === undefined || repo === undefined || owner.length === 0 || repo.length === 0) {
    throw new Error(`Invalid hubRepo: ${hubRepo} (expected "owner/repo").`);
  }

  // Source resolution.
  let sources: HubSourceSpec[];
  if (hubConfigFile !== undefined) {
    sources = parseHubConfig(fs.readFileSync(hubConfigFile, 'utf8'));
  } else if (noHubConfig) {
    sources = [];
  } else {
    const yamlText = await client.getText(
      `https://raw.githubusercontent.com/${owner}/${repo}/${hubBranch}/hub-config.yml`
    );
    sources = parseHubConfig(yamlText);
  }
  for (const raw of opts.extraSources ?? []) {
    const injected = parseExtraSource(raw);
    sources = sources.filter((s) => s.id !== injected.id);
    sources.push(injected);
    opts.onLog?.(
      `injected extra-source id=${injected.id} type=${injected.type} `
      + `url=${injected.url}@${injected.branch}`
      + (injected.pluginsPath === undefined ? '' : ` pluginsPath=${injected.pluginsPath}`)
    );
  }
  if (opts.sourcesInclude !== undefined && opts.sourcesInclude.length > 0) {
    const set = new Set(opts.sourcesInclude);
    sources = sources.filter((s) => set.has(s.id));
  }
  if (opts.sourcesExclude !== undefined && opts.sourcesExclude.length > 0) {
    const set = new Set(opts.sourcesExclude);
    sources = sources.filter((s) => !set.has(s.id));
  }

  opts.onLog?.(
    `hub=${hubRepo}@${hubBranch} `
    + `token=${token.source}:${redactToken(token.token)} `
    + `sources=${String(sources.length)} concurrency=${String(concurrency)}`
  );

  const cache = new BlobCache(path.join(cacheDir, 'blobs'));
  const blobs = new BlobFetcher({ client, cache });
  const etagStore = await EtagStore.open(path.join(cacheDir, 'etags.json'));
  const harvester = new HubHarvester({
    sources, client, blobs, etagStore,
    progressFile, concurrency,
    force: opts.force ?? false,
    dryRun: opts.dryRun ?? false,
    onEvent: opts.onEvent
  });
  const result = await harvester.run();
  await etagStore.save();
  saveIndex(result.index, outFile);
  // Optional sidecar HMAC; opt-in via env to keep main flow quiet.
  const signKey = env.PRIMITIVE_INDEX_SIGN_KEY;
  const signKeyId = env.PRIMITIVE_INDEX_SIGN_KEY_ID ?? 'default';
  if (signKey !== undefined && signKey.length > 0) {
    const sigFile = outFile.replace(/\.json$/u, '.sig.json');
    saveIndexWithIntegrity(result.index.toJSON(), sigFile, { keyId: signKeyId, key: signKey });
  }
  const stats = result.index.stats();
  return {
    outFile, progressFile, cacheDir, stats,
    totals: {
      totalMs: result.totalMs,
      done: result.done, error: result.error, skip: result.skip,
      primitives: result.primitives, wallMs: result.wallMs
    },
    hub: { repo: hubRepo, branch: hubBranch, sources: sources.length },
    rateLimit: client.lastRateLimit,
    tokenSource: token.source
  };
};

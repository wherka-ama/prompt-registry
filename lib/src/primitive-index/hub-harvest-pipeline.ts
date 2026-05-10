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
import { readFile } from 'node:fs/promises';
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

/**
 * Parameters for resolving hub sources.
 */
interface ResolveHubSourcesParams {
  noHubConfig: boolean;
  hubConfigFile: string | undefined;
  hubRepo: string;
  hubBranch: string;
  client: GitHubApiClient;
  extraSources: string[] | undefined;
  onLog: ((msg: string) => void) | undefined;
  sourcesInclude: string[] | undefined;
  sourcesExclude: string[] | undefined;
}

/**
 * Parameters for building harvest result.
 */
interface BuildHarvestResultParams {
  outFile: string;
  progressFile: string;
  cacheDir: string;
  stats: IndexStats;
  result: any;
  hubRepo: string;
  hubBranch: string;
  sourcesCount: number;
  tokenSource: string;
  client: GitHubApiClient;
}

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

function resolveHubRepo(
  noHubConfig: boolean,
  hubConfigFile: string | undefined,
  hubRepo: string | undefined
): { hubRepo: string; hubId: string } {
  const resolvedHubRepo = !noHubConfig && hubConfigFile === undefined
    ? hubRepo as string
    : (hubRepo ?? 'local/local');
  const hubId = noHubConfig || hubConfigFile !== undefined ? 'local' : resolvedHubRepo;
  return { hubRepo: resolvedHubRepo, hubId };
}

async function resolveHubSources(params: ResolveHubSourcesParams): Promise<HubSourceSpec[]> {
  let sources = await loadBaseSources(params.noHubConfig, params.hubConfigFile, params.hubRepo, params.hubBranch, params.client);
  sources = injectExtraSources(sources, params.extraSources, params.onLog);
  sources = filterSources(sources, params.sourcesInclude, params.sourcesExclude);
  return sources;
}

async function loadBaseSources(
  noHubConfig: boolean,
  hubConfigFile: string | undefined,
  hubRepo: string,
  hubBranch: string,
  client: GitHubApiClient
): Promise<HubSourceSpec[]> {
  if (hubConfigFile !== undefined) {
    return parseHubConfig(await readFile(hubConfigFile, 'utf8'));
  }
  if (noHubConfig) {
    return [];
  }
  const [owner, repo] = hubRepo.split('/');
  const yamlText = await client.getText(
    `https://raw.githubusercontent.com/${owner}/${repo}/${hubBranch}/hub-config.yml`
  );
  return parseHubConfig(yamlText);
}

function injectExtraSources(
  sources: HubSourceSpec[],
  extraSources: string[] | undefined,
  onLog: ((msg: string) => void) | undefined
): HubSourceSpec[] {
  for (const raw of extraSources ?? []) {
    const injected = parseExtraSource(raw);
    sources = sources.filter((s) => s.id !== injected.id);
    sources.push(injected);
    onLog?.(
      `injected extra-source id=${injected.id} type=${injected.type} `
      + `url=${injected.url}@${injected.branch}`
      + (injected.pluginsPath === undefined ? '' : ` pluginsPath=${injected.pluginsPath}`)
    );
  }
  return sources;
}

function filterSources(
  sources: HubSourceSpec[],
  sourcesInclude: string[] | undefined,
  sourcesExclude: string[] | undefined
): HubSourceSpec[] {
  if (sourcesInclude !== undefined && sourcesInclude.length > 0) {
    const set = new Set(sourcesInclude);
    sources = sources.filter((s) => set.has(s.id));
  }
  if (sourcesExclude !== undefined && sourcesExclude.length > 0) {
    const set = new Set(sourcesExclude);
    sources = sources.filter((s) => !set.has(s.id));
  }
  return sources;
}

/**
 * Harvest primitives from a GitHub hub (collections, plugins, or both).
 * Returns a summary with primitive counts and (if `dryRun=true`) a preview.
 * (consumed by the CLI command's JSON envelope).
 * @param opts Pipeline options (see {@link HubHarvestPipelineOptions}).
 * @param env Process env to read from. Defaults to `process.env`.
 * @returns Summary suitable for surfacing as JSON.
 */
export const harvestHub = async (
  opts: HubHarvestPipelineOptions,
  env: NodeJS.ProcessEnv = process.env
): Promise<HubHarvestPipelineResult> => {
  validateHarvestOptions(opts);
  const { hubRepo, hubBranch, cacheDir, progressFile, outFile, concurrency } = resolveHarvestPaths(opts, env);
  const { resolvedToken, client, tokenSource } = await createGitHubClient(hubRepo, opts);
  const sources = await resolveHubSources({
    noHubConfig: opts.noHubConfig === true,
    hubConfigFile: opts.hubConfigFile,
    hubRepo,
    hubBranch,
    client,
    extraSources: opts.extraSources,
    onLog: opts.onLog,
    sourcesInclude: opts.sourcesInclude,
    sourcesExclude: opts.sourcesExclude
  });

  logHarvestStart(opts, hubRepo, hubBranch, resolvedToken, sources.length, concurrency);
  const result = await runHarvester(sources, client, cacheDir, progressFile, concurrency, opts);
  await writeIndexWithIntegrity(result.index, outFile, env);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- stats() return type is not fully typed
  const stats = result.index.stats();

  return buildHarvestResult({
    outFile,
    progressFile,
    cacheDir,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- result parameter is typed as any for flexibility
    stats,
    result,
    hubRepo,
    hubBranch,
    sourcesCount: sources.length,
    tokenSource,
    client
  });
};

function validateHarvestOptions(opts: HubHarvestPipelineOptions): void {
  const noHubConfig = opts.noHubConfig === true;
  const hubConfigFile = opts.hubConfigFile;
  if (!noHubConfig && hubConfigFile === undefined && (opts.hubRepo === undefined || opts.hubRepo.length === 0)) {
    throw new Error('hubRepo is required (or set noHubConfig=true / hubConfigFile)');
  }
}

function resolveHarvestPaths(opts: HubHarvestPipelineOptions, env: NodeJS.ProcessEnv): {
  hubRepo: string;
  hubBranch: string;
  cacheDir: string;
  progressFile: string;
  outFile: string;
  concurrency: number;
} {
  const { hubRepo } = resolveHubRepo(opts.noHubConfig === true, opts.hubConfigFile, opts.hubRepo);
  const hubBranch = opts.hubBranch ?? 'main';
  const hubId = opts.noHubConfig === true || opts.hubConfigFile !== undefined ? 'local' : hubRepo;
  const cacheDir = opts.cacheDir
    ?? defaultHubCacheDir(hubId, env as Parameters<typeof defaultHubCacheDir>[1]);
  const progressFile = opts.progressFile ?? path.join(cacheDir, 'progress.jsonl');
  const outFile = opts.outFile
    ?? defaultIndexFile(env as Parameters<typeof defaultIndexFile>[0]);
  const concurrency = opts.concurrency ?? 4;
  return { hubRepo, hubBranch, cacheDir, progressFile, outFile, concurrency };
}

async function createGitHubClient(hubRepo: string, opts: HubHarvestPipelineOptions): Promise<{
  resolvedToken: string;
  client: GitHubApiClient;
  tokenSource: string;
}> {
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
  return { resolvedToken, client, tokenSource: token.source };
}

function logHarvestStart(opts: HubHarvestPipelineOptions, hubRepo: string, hubBranch: string, resolvedToken: string, sourcesCount: number, concurrency: number): void {
  opts.onLog?.(
    `hub=${hubRepo}@${hubBranch} `
    + `token=${opts.explicitToken ? 'explicit' : 'env'}:${redactToken(resolvedToken)} `
    + `sources=${String(sourcesCount)} concurrency=${String(concurrency)}`
  );
}

async function runHarvester(
  sources: HubSourceSpec[],
  client: GitHubApiClient,
  cacheDir: string,
  progressFile: string,
  concurrency: number,
  opts: HubHarvestPipelineOptions
): Promise<{ index: any; totalMs: number; done: number; error: number; skip: number; primitives: number; wallMs: number }> {
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
  return result;
}

// eslint-disable-next-line @typescript-eslint/require-await -- Intentionally async for interface compatibility
async function writeIndexWithIntegrity(index: any, outFile: string, env: NodeJS.ProcessEnv): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- index parameter is typed as any for flexibility
  saveIndex(index, outFile);
  const signKey = env.PRIMITIVE_INDEX_SIGN_KEY;
  const signKeyId = env.PRIMITIVE_INDEX_SIGN_KEY_ID ?? 'default';
  if (signKey !== undefined && signKey.length > 0) {
    const sigFile = outFile.replace(/\.json$/u, '.sig.json');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- index parameter is typed as any for flexibility
    saveIndexWithIntegrity(index.toJSON(), sigFile, { keyId: signKeyId, key: signKey });
  }
}

function buildHarvestResult(params: BuildHarvestResultParams): HubHarvestPipelineResult {
  return {
    outFile: params.outFile,
    progressFile: params.progressFile,
    cacheDir: params.cacheDir,
    stats: params.stats,
    totals: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- result parameter is typed as any for flexibility
      totalMs: params.result.totalMs,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- result parameter is typed as any for flexibility
      done: params.result.done,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- result parameter is typed as any for flexibility
      error: params.result.error,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- result parameter is typed as any for flexibility
      skip: params.result.skip,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- result parameter is typed as any for flexibility
      primitives: params.result.primitives,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- result parameter is typed as any for flexibility
      wallMs: params.result.wallMs
    },
    hub: { repo: params.hubRepo, branch: params.hubBranch, sources: params.sourcesCount },
    rateLimit: params.client.lastRateLimit,
    tokenSource: params.tokenSource
  };
}

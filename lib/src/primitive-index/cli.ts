/**
 * CLI entry for the primitive index.
 *
 * Subcommands:
 *   build    --root DIR [--out FILE] [--source-id ID]
 *   search   --index FILE --q "text" [--kinds k1,k2] [--sources s1] [--tags t1] [--limit N] [--json]
 *   stats    --index FILE [--json]
 *   shortlist new    --index FILE --name NAME [--description DESC]  (rewrites index file)
 *   shortlist add    --index FILE --id SL --primitive PID
 *   shortlist remove --index FILE --id SL --primitive PID
 *   shortlist list   --index FILE [--json]
 *   export   --index FILE --shortlist SL --profile-id ID [--out-dir DIR] [--suggest-collection]
 *
 * All JSON outputs are stable (sorted keys inside the search hits contract)
 * so the primitive-finder skill can rely on them.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import {
  type BenchCase,
  renderBenchReportMarkdown,
  runBench,
} from './bench';
import {
  defaultHubCacheDir,
  defaultIndexFile,
  defaultProgressFile,
} from './default-paths';
import {
  renderPatternReportMarkdown,
  runPatternEval,
} from './eval-pattern';
import {
  exportShortlistAsProfile,
} from './export-profile';
import {
  LocalFolderBundleProvider,
} from './providers/local-folder';
import {
  loadIndex,
  saveIndex,
} from './store';
import type {
  PrimitiveKind,
  SearchQuery,
} from './types';
import {
  PrimitiveIndex,
} from './index';

interface ParsedArgs {
  _: string[];
  /**
   * Flag values. Most flags are string|boolean; repeated string flags
   * coalesce to string[] (see parseArgs) so callers like --extra-source
   * can accept multiple occurrences.
   */
  flags: Record<string, string | boolean | string[]>;
}

/**
 * Short-flag aliases. Kept tiny on purpose — this is a small, linear CLI
 * and adopting a full arg-parse lib would be over-engineering. Add entries
 * here (not in per-subcommand code) so every subcommand gets the same
 * UX. Users who mistype short flags get an explicit "unknown flag" error
 * via the subcommand handlers that call requireString().
 */
const SHORT_FLAG_ALIASES: Record<string, string> = {
  q: 'q',
  k: 'kinds',
  s: 'sources',
  b: 'bundles',
  t: 'tags',
  l: 'limit',
  o: 'offset',
  h: 'help'
};

function parseArgs(argv: string[]): ParsedArgs {
  const _: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  const isFlag = (s: string | undefined): boolean => s !== undefined && (s.startsWith('--') || /^-[a-zA-Z]$/u.test(s));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let key: string | undefined;
    if (a.startsWith('--')) {
      key = a.slice(2);
    } else if (/^-[a-zA-Z]$/u.test(a)) {
      // Single-dash single-letter short flag, resolved via SHORT_FLAG_ALIASES.
      // If the letter isn't mapped, we still accept it (stored under its own
      // name) so a future caller can opt in without editing this function.
      const letter = a.slice(1);
      key = SHORT_FLAG_ALIASES[letter] ?? letter;
    }
    if (key === undefined) {
      _.push(a);
    } else {
      const next = argv[i + 1];
      const value: string | true = next !== undefined && !isFlag(next) ? (i++, next) : true;
      const existing = flags[key];
      // Repeated string flags coalesce into an array (e.g. multiple
      // --extra-source). Boolean flags override.
      if (existing === undefined) {
        flags[key] = value;
      } else if (typeof value === 'string') {
        if (Array.isArray(existing)) {
          existing.push(value);
        } else if (typeof existing === 'string') {
          flags[key] = [existing, value];
        } else {
          flags[key] = value;
        }
      } else {
        flags[key] = value;
      }
    }
  }
  return { _, flags };
}

/**
 * Coerce a flag value (string | string[] | boolean | undefined) to string[].
 * @param v
 */
function normaliseStringArray(v: string | string[] | boolean | undefined): string[] {
  if (Array.isArray(v)) {
    return v;
  }
  if (typeof v === 'string' && v) {
    return [v];
  }
  return [];
}

function requireString(flags: Record<string, string | boolean | string[]>, name: string): string {
  const v = flags[name];
  if (typeof v !== 'string' || !v) {
    throw new Error(`Missing required --${name}`);
  }
  return v;
}

function csv(value: string | boolean | string[] | undefined): string[] | undefined {
  if (Array.isArray(value)) {
    return value.flatMap((v) => v.split(',').map((s) => s.trim()).filter(Boolean));
  }
  if (typeof value !== 'string' || !value) {
    return undefined;
  }
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * CLI entry point; returns the desired exit code.
 * @param argv - Command-line arguments (excluding node + script).
 */
export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const cmd = parsed._[0];
  const sub = parsed._[1];
  try {
    switch (cmd) {
      case 'build': {
        return await handleBuild(parsed);
      }
      case 'search': {
        return handleSearch(parsed);
      }
      case 'stats': {
        return handleStats(parsed);
      }
      case 'export': {
        return handleExport(parsed);
      }
      case 'hub-harvest': {
        return await handleHubHarvest(parsed);
      }
      case 'hub-report': {
        return await handleHubReport(parsed);
      }
      case 'eval-pattern': {
        return handleEvalPattern(parsed);
      }
      case 'bench': {
        return handleBench(parsed);
      }
      case 'shortlist': {
        return handleShortlist(sub, parsed);
      }
      case 'help':
      case undefined: {
        printUsage();
        return 0;
      }
      default: {
        process.stderr.write(`Unknown command: ${cmd}\n`);
        printUsage();
        return 2;
      }
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    return 1;
  }
}

async function handleBuild({ flags }: ParsedArgs): Promise<number> {
  const root = requireString(flags, 'root');
  const out = typeof flags.out === 'string' ? flags.out : path.join(root, 'primitive-index.json');
  const sourceId = typeof flags['source-id'] === 'string' ? flags['source-id'] : undefined;
  const provider = new LocalFolderBundleProvider({ root, sourceId });
  const idx = await PrimitiveIndex.buildFrom(provider, { hubId: sourceId });
  saveIndex(idx, out);
  const stats = idx.stats();
  process.stdout.write(JSON.stringify({ ok: true, out, stats }, null, 2) + '\n');
  return 0;
}

function resolveIndexPath(flags: Record<string, string | boolean | string[]>): string {
  if (typeof flags.index === 'string' && flags.index) {
    return flags.index;
  }
  // No explicit --index: fall back to the XDG-style default. We don't
  // create the file — loadIndex will throw with a clear error if the
  // user has never harvested, which guides them to run `hub-harvest`
  // first.
  return defaultIndexFile();
}

function handleSearch({ flags }: ParsedArgs): number {
  const idx = loadIndex(resolveIndexPath(flags));
  const query: SearchQuery = {
    q: typeof flags.q === 'string' ? flags.q : undefined,
    kinds: csv(flags.kinds) as PrimitiveKind[] | undefined,
    sources: csv(flags.sources),
    bundles: csv(flags.bundles),
    tags: csv(flags.tags),
    installedOnly: flags['installed-only'] === true,
    limit: typeof flags.limit === 'string' ? Number.parseInt(flags.limit, 10) : undefined,
    offset: typeof flags.offset === 'string' ? Number.parseInt(flags.offset, 10) : undefined,
    explain: flags.explain === true
  };
  const result = idx.search(query);
  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(renderSearch(result));
  }
  return 0;
}

function handleStats({ flags }: ParsedArgs): number {
  const idx = loadIndex(resolveIndexPath(flags));
  const stats = idx.stats();
  if (flags.json) {
    process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
  } else {
    process.stdout.write(
      `primitives: ${stats.primitives}\nbundles: ${stats.bundles}\nshortlists: ${stats.shortlists}\n`
      + `byKind: ${JSON.stringify(stats.byKind)}\nbySource: ${JSON.stringify(stats.bySource)}\n`
    );
  }
  return 0;
}

function handleEvalPattern({ flags }: ParsedArgs): number {
  // Pattern-based relevance eval. Loads a golden-set JSON file (with
  // a `cases[]` array of PatternCase) and runs every query against
  // the index, asserting per-case mustMatch patterns. Intended to
  // guard ranking quality in CI and to support `lib/fixtures/
  // golden-queries.json` as a live reference.
  const idx = loadIndex(resolveIndexPath(flags));
  const file = typeof flags.gold === 'string'
    ? flags.gold
    : path.join(__dirname, '..', '..', 'fixtures', 'golden-queries.json');
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw) as { cases: import('./eval-pattern').PatternCase[] };
  const report = runPatternEval(idx, parsed.cases);
  if (flags.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderPatternReportMarkdown(report));
  }
  // Non-zero exit when any case failed, so CI treats it as a fail.
  return report.aggregate.failed > 0 ? 1 : 0;
}

function handleBench({ flags }: ParsedArgs): number {
  // Microbenchmark: runs every case in the golden-set file N times
  // against the index and prints per-query median/p95/max + total QPS.
  const idx = loadIndex(resolveIndexPath(flags));
  const file = typeof flags.gold === 'string'
    ? flags.gold
    : path.join(__dirname, '..', '..', 'fixtures', 'golden-queries.json');
  const iterations = typeof flags.iterations === 'string' ? Number.parseInt(flags.iterations, 10) : 50;
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw) as { cases: { id: string; query: BenchCase['query'] }[] };
  const cases: BenchCase[] = parsed.cases.map((c) => ({ id: c.id, query: c.query }));
  const report = runBench(idx, cases, iterations);
  if (flags.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderBenchReportMarkdown(report));
  }
  return 0;
}

function handleShortlist(sub: string | undefined, { flags }: ParsedArgs): number {
  const indexPath = resolveIndexPath(flags);
  const idx = loadIndex(indexPath);
  switch (sub) {
    case 'new': {
      const sl = idx.createShortlist(requireString(flags, 'name'), typeof flags.description === 'string' ? flags.description : undefined);
      saveIndex(idx, indexPath);
      process.stdout.write(JSON.stringify(sl, null, 2) + '\n');
      return 0;
    }
    case 'add': {
      const sl = idx.addToShortlist(requireString(flags, 'id'), requireString(flags, 'primitive'));
      saveIndex(idx, indexPath);
      process.stdout.write(JSON.stringify(sl, null, 2) + '\n');
      return 0;
    }
    case 'remove': {
      const sl = idx.removeFromShortlist(requireString(flags, 'id'), requireString(flags, 'primitive'));
      saveIndex(idx, indexPath);
      process.stdout.write(JSON.stringify(sl, null, 2) + '\n');
      return 0;
    }
    case 'list': {
      const list = idx.listShortlists();
      if (flags.json) {
        process.stdout.write(JSON.stringify(list, null, 2) + '\n');
      } else {
        for (const sl of list) {
          process.stdout.write(`${sl.id}\t${sl.name}\t${sl.primitiveIds.length} items\n`);
        }
      }
      return 0;
    }
    default: {
      process.stderr.write(`Unknown shortlist subcommand: ${String(sub)}\n`);
      return 2;
    }
  }
}

function handleExport({ flags }: ParsedArgs): number {
  const indexPath = resolveIndexPath(flags);
  const idx = loadIndex(indexPath);
  const shortlistId = requireString(flags, 'shortlist');
  const sl = idx.getShortlist(shortlistId);
  if (!sl) {
    throw new Error(`Unknown shortlist: ${shortlistId}`);
  }
  const profileId = requireString(flags, 'profile-id');
  const outDir = typeof flags['out-dir'] === 'string' ? flags['out-dir'] : '.';
  const result = exportShortlistAsProfile(idx, sl, {
    profileId,
    profileName: typeof flags.name === 'string' ? flags.name : undefined,
    description: typeof flags.description === 'string' ? flags.description : undefined,
    icon: typeof flags.icon === 'string' ? flags.icon : undefined,
    suggestCollection: flags['suggest-collection'] === true
  });
  fs.mkdirSync(outDir, { recursive: true });
  const profilePath = path.join(outDir, `${profileId}.profile.yml`);
  fs.writeFileSync(profilePath, yaml.dump(result.profile), 'utf8');
  const out: Record<string, unknown> = { profile: profilePath, warnings: result.warnings };
  if (result.suggestedCollection) {
    const collectionPath = path.join(outDir, `${result.suggestedCollection.id}.collection.yml`);
    fs.writeFileSync(collectionPath, yaml.dump(result.suggestedCollection), 'utf8');
    out.collection = collectionPath;
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  return 0;
}

function renderSearch(result: ReturnType<PrimitiveIndex['search']>): string {
  const lines: string[] = [`total: ${result.total}  took: ${result.tookMs}ms`];
  for (const hit of result.hits) {
    const p = hit.primitive;
    lines.push(
      `${hit.score.toFixed(3)}  [${p.kind}] ${p.title}  (${p.bundle.sourceId}/${p.bundle.bundleId})  ${p.id}`
    );
    if (p.description) {
      lines.push(`      ${p.description}`);
    }
  }
  return lines.join('\n') + '\n';
}

function printUsage(): void {
  process.stdout.write(`primitive-index <command> [flags]

Commands:
  build     --root DIR [--out FILE] [--source-id ID]
  search    [--index FILE] --q "text" [--kinds k1,k2] [--sources ...] [--tags ...] [--limit N] [--json] [--explain]
  stats     [--index FILE] [--json]
  shortlist new    [--index FILE] --name NAME [--description DESC]
  shortlist add    [--index FILE] --id SL --primitive PID
  shortlist remove [--index FILE] --id SL --primitive PID
  shortlist list   [--index FILE] [--json]
  export    [--index FILE] --shortlist SL --profile-id ID [--out-dir DIR] [--suggest-collection]
  hub-harvest --hub-repo OWNER/REPO [--hub-branch BRANCH] [--cache-dir DIR]
              [--out FILE] [--progress FILE] [--concurrency N]
              [--token-env NAME] [--sources-include csv] [--sources-exclude csv]
              [--extra-source "id=...,type=...,url=...,branch=...,pluginsPath=..."]*
              [--force] [--dry-run] [--json] [--verbose]

  # Example: harvest the Amadeus hub AND inject the upstream github/awesome-copilot
  # plugins/ folder as an awesome-copilot-plugin source:
  #   primitive-index hub-harvest \\
  #     --hub-repo Amadeus-xDLC/genai.prompt-registry-config \\
  #     --extra-source 'id=upstream-ac,type=awesome-copilot-plugin,url=https://github.com/github/awesome-copilot,branch=main,pluginsPath=plugins'
  hub-report  [--progress FILE] [--hub-repo OWNER/REPO] [--cache-dir DIR] [--format markdown|json]
  eval-pattern [--index FILE] [--gold FILE] [--json]
              # Runs a pattern-based relevance eval against the index.
              # Default gold set: lib/fixtures/golden-queries.json.
  bench       [--index FILE] [--gold FILE] [--iterations N] [--json]
              # Runs each gold query N times (default 50) and reports
              # per-case p50/p95/max + aggregate queries/sec.

Short flags (same everywhere):
  -q <text>   alias for --q
  -k <csv>    alias for --kinds
  -s <csv>    alias for --sources
  -b <csv>    alias for --bundles
  -t <csv>    alias for --tags
  -l <n>      alias for --limit
  -o <n>      alias for --offset
  -h          alias for --help

Default paths (no flag required):
  cache dir     $PROMPT_REGISTRY_CACHE
                $XDG_CACHE_HOME/prompt-registry
                ~/.cache/prompt-registry                  (POSIX fallback)
  index file    <cache dir>/primitive-index.json
  hub cache     <cache dir>/hubs/<owner>_<repo>/
  progress      <hub cache>/progress.jsonl

Env (opt-in):
  PROMPT_REGISTRY_CACHE          override cache root (see Default paths).
  PRIMITIVE_INDEX_SIGN_KEY       HMAC secret; enables .sig.json sidecar.
  PRIMITIVE_INDEX_SIGN_KEY_ID    HMAC keyId (default "default").
`);
}

async function handleHubReport({ flags }: ParsedArgs): Promise<number> {
  const [
    { HarvestProgressLog },
    { BlobCache }
  ] = await Promise.all([
    import('./hub/progress-log'),
    import('./hub/blob-cache')
  ]);
  // Progress file resolution order: explicit --progress wins; otherwise
  // derive from --hub-repo; otherwise fall back to the 'local' hub
  // (matches the hub-harvest default when --no-hub-config is used).
  const hubRepoFlag = typeof flags['hub-repo'] === 'string' ? flags['hub-repo'] : undefined;
  const progressFile = typeof flags.progress === 'string'
    ? flags.progress
    : defaultProgressFile(hubRepoFlag);
  const cacheDir = typeof flags['cache-dir'] === 'string'
    ? flags['cache-dir']
    : defaultHubCacheDir(hubRepoFlag);
  const format = typeof flags.format === 'string' ? flags.format : 'markdown';
  const log = await HarvestProgressLog.open(progressFile);
  const state = log.projectState();
  const summary = log.summary();
  await log.close();

  // Optional blob cache stats when --cache-dir is given.
  let cacheStats: { entries: number; bytes: number } | undefined;
  if (cacheDir) {
    const cache = new BlobCache(path.join(cacheDir, 'blobs'));
    cacheStats = await cache.stats();
  }

  if (format === 'json') {
    process.stdout.write(JSON.stringify({
      summary,
      cacheStats,
      bundles: [...state.values()]
    }, null, 2) + '\n');
    return 0;
  }

  // Markdown output: human-readable per-bundle status table.

  const lines: string[] = [
    `# Primitive Index — Hub harvest report`,
    '',
    `- Progress file: \`${progressFile}\``,
    `- Done: **${summary.done}**  Skip: **${summary.skip}**  Error: **${summary.error}**`,
    `- Primitives (done): **${summary.primitives}**  Wall ms: **${summary.wallMs}**`
  ];
  if (cacheStats) {
    lines.push(`- Blob cache: **${cacheStats.entries}** entries, **${(cacheStats.bytes / 1024).toFixed(1)} KiB**`);
  }
  lines.push('', '| Source | Bundle | Status | Commit sha | Primitives | ms | Note |', '|--------|--------|--------|-----------|------------|----|------|');
  const rows = [...state.values()].toSorted((a, b) => a.sourceId.localeCompare(b.sourceId));
  for (const r of rows) {
    const note = r.status === 'error' ? (r.error ?? '') : (r.reason ?? '');
    lines.push(`| ${r.sourceId} | ${r.bundleId} | ${r.status} | ${r.commitSha.slice(0, 10)} | ${r.primitives ?? '—'} | ${r.ms ?? '—'} | ${note.split('|').join('\\|')} |`);
  }
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

async function handleHubHarvest({ flags }: ParsedArgs): Promise<number> {
  // Imported lazily so the normal CLI path doesn't pay for loading the
  // hub stack on every invocation.
  const [
    { GitHubApiClient },
    { BlobCache },
    { BlobFetcher },
    { parseHubConfig },
    { HubHarvester },
    { resolveGithubToken, redactToken },
    { EtagStore },
    { saveIndexWithIntegrity },
    { parseExtraSource }
  ] = await Promise.all([
    import('./hub/github-api-client'),
    import('./hub/blob-cache'),
    import('./hub/blob-fetcher'),
    import('./hub/hub-config'),
    import('./hub/hub-harvester'),
    import('./hub/token-provider'),
    import('./hub/etag-store'),
    import('./hub/integrity'),
    import('./hub/extra-source')
  ]);

  // --hub-repo is required unless --no-hub-config is used (in which case
  // sources come entirely from --extra-source flags / a local file).
  const noHubConfig = flags['no-hub-config'] === true;
  const hubConfigFile = typeof flags['hub-config-file'] === 'string' ? flags['hub-config-file'] : undefined;
  const hubRepo = !noHubConfig && !hubConfigFile
    ? requireString(flags, 'hub-repo')
    : (typeof flags['hub-repo'] === 'string' ? flags['hub-repo'] : 'local/local');
  const hubBranch = typeof flags['hub-branch'] === 'string' ? flags['hub-branch'] : 'main';
  // Namespace the cache by hub id so multiple hubs coexist under a single
  // XDG-style cache root. Explicit --cache-dir overrides everything.
  const hubId = noHubConfig || hubConfigFile ? 'local' : hubRepo;
  const cacheDir = typeof flags['cache-dir'] === 'string'
    ? flags['cache-dir']
    : defaultHubCacheDir(hubId);
  const progressFile = typeof flags.progress === 'string'
    ? flags.progress
    : path.join(cacheDir, 'progress.jsonl');
  // The serialised index is shared across hubs (one merged view); the
  // user can still point at a per-hub file via --out.
  const outFile = typeof flags.out === 'string'
    ? flags.out
    : defaultIndexFile();
  // Default 4: measured 5.3× cold speedup on a 15-source hub vs serial with
  // zero rate-limit incidents. Users can bump higher, but a well-behaved
  // client should stay modest to leave headroom for other harvester runs.
  const concurrency = typeof flags.concurrency === 'string' ? Number.parseInt(flags.concurrency, 10) : 4;
  const tokenEnv = typeof flags['token-env'] === 'string' ? flags['token-env'] : undefined;
  const includeCsv = csv(flags['sources-include']);
  const excludeCsv = csv(flags['sources-exclude']);
  const verbose = flags.verbose === true;
  const force = flags.force === true;
  const dryRun = flags['dry-run'] === true;

  const token = await resolveGithubToken({
    explicit: tokenEnv ? process.env[tokenEnv] : undefined
  });
  if (!token.token) {
    throw new Error('No GitHub token available (tried explicit, env, gh CLI).');
  }
  const client = new GitHubApiClient({ token: token.token });
  const [owner, repo] = hubRepo.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid --hub-repo: ${hubRepo} (expected "owner/repo").`);
  }

  // Source resolution, in order:
  //   --hub-config-file FILE  → read YAML from disk (dev/test)
  //   --no-hub-config         → start with empty sources
  //   default                 → fetch hub-config.yml from the hub repo
  let sources: import('./hub/hub-config').HubSourceSpec[];
  if (hubConfigFile) {
    const local = fs.readFileSync(hubConfigFile, 'utf8');
    sources = parseHubConfig(local);
  } else if (noHubConfig) {
    sources = [];
  } else {
    const hubConfigYaml = await client.getText(
      `https://raw.githubusercontent.com/${owner}/${repo}/${hubBranch}/hub-config.yml`
    );
    sources = parseHubConfig(hubConfigYaml);
  }
  // --extra-source flags let the user inject synthetic sources on top of
  // the fetched hub-config. Useful for testing a new source type (e.g.
  // awesome-copilot-plugin) before the actual hub is updated. The flag
  // may be repeated: `argv` coalesces repeated string flags into an
  // array of strings.
  const extraArgs = normaliseStringArray(flags['extra-source']);
  if (extraArgs.length > 0) {
    for (const raw of extraArgs) {
      const injected = parseExtraSource(raw);
      // Drop any pre-existing source with the same id (user override wins).
      sources = sources.filter((s) => s.id !== injected.id);
      sources.push(injected);
      process.stderr.write(
        `[hub-harvest] injected extra-source id=${injected.id} type=${injected.type} url=${injected.url}@${injected.branch}`
        + (injected.pluginsPath ? ` pluginsPath=${injected.pluginsPath}` : '')
        + '\n'
      );
    }
  }
  if (includeCsv) {
    sources = sources.filter((s) => includeCsv.includes(s.id));
  }
  if (excludeCsv) {
    sources = sources.filter((s) => !excludeCsv.includes(s.id));
  }
  // Both github and awesome-copilot sources are harvested in the same way
  // today: we walk the whole repo tree and let the primitive-candidate
  // filter surface *.prompt.md / *.instructions.md / *.chatmode.md /
  // *.agent.md / SKILL.md / mcp.json / collection.yml. awesome-copilot's
  // per-collection sub-bundling is a presentation concern the index
  // doesn't care about.
  const ghSources = sources;
  const skipped = 0;

  process.stderr.write(
    `[hub-harvest] hub=${hubRepo}@${hubBranch} token=${token.source}:${redactToken(token.token)} sources=${sources.length} (github=${ghSources.length} skipped=${skipped}) concurrency=${concurrency}\n`
  );

  const cache = new BlobCache(path.join(cacheDir, 'blobs'));
  const blobs = new BlobFetcher({ client, cache });
  const etagStore = await EtagStore.open(path.join(cacheDir, 'etags.json'));
  const harvester = new HubHarvester({
    sources: ghSources, client, blobs, etagStore,
    progressFile, concurrency,
    force, dryRun,
    onEvent: (ev) => {
      if (!verbose && ev.kind === 'source-start') {
        return;
      }
      process.stderr.write(`[${ev.kind}] ${JSON.stringify(ev)}\n`);
    }
  });
  // Graceful shutdown: on SIGINT/SIGTERM flush the etag store + write a
  // breadcrumb to stderr so the user knows progress was persisted. The
  // progress log itself is already append-only + crash-safe; we only
  // need to protect the etag store which batches writes.
  let shuttingDown = false;
  const onSignal = (sig: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stderr.write(`\n[hub-harvest] received ${sig}; flushing etag store and exiting...\n`);
    void etagStore.save().finally(() => {
      // CLI script; process.exit is the idiomatic SIGINT response here.
      // eslint-disable-next-line unicorn/no-process-exit -- CLI entry point
      process.exit(130);
    });
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  const result = await harvester.run();
  await etagStore.save();
  // When PRIMITIVE_INDEX_SIGN_KEY is present we additionally write a
  // signed sidecar .sig.json that detects tampering. The primary index
  // file remains a plain JSON for backwards compatibility with existing
  // tooling (search, stats, export, ...).
  saveIndex(result.index, outFile);
  const signKey = process.env.PRIMITIVE_INDEX_SIGN_KEY;
  const signKeyId = process.env.PRIMITIVE_INDEX_SIGN_KEY_ID ?? 'default';
  if (signKey) {
    const sigFile = outFile.replace(/\.json$/u, '.sig.json');
    saveIndexWithIntegrity(result.index.toJSON(), sigFile, { keyId: signKeyId, key: signKey });
  }
  const stats = result.index.stats();
  const summary = {
    ok: result.error === 0,
    out: outFile,
    progressFile,
    cacheDir,
    stats,
    totals: {
      totalMs: result.totalMs,
      done: result.done, error: result.error, skip: result.skip,
      primitives: result.primitives, wallMs: result.wallMs
    },
    hub: { repo: hubRepo, branch: hubBranch, githubSources: ghSources.length, skippedNonGithub: skipped },
    rateLimit: client.lastRateLimit
  };
  if (flags.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    process.stdout.write(
      `done=${result.done} error=${result.error} skip=${result.skip} primitives=${result.primitives} wallMs=${result.wallMs} totalMs=${result.totalMs}\n`
    );
  }
  return result.error === 0 ? 0 : 1;
}

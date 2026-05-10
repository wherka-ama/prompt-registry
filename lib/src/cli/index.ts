/**
 * Phase 4 / Iter 8 — CLI entry point.
 *
 * Wires every Phase 4 command into a single `prompt-registry` binary.
 * Argument parsing is still a minimal hand-roll until iter 9 lands
 * clipanion-native options on every command; the parser supports
 *   `-o / --output <fmt>`,
 *   `--collection-file <path>`,
 *   `--version <semver>`,
 *   `--out / --out-file <path>`,
 *   `--changed-path <p>` (repeatable),
 *   `--skill-name <s>`,
 *   `--description <s>`,
 *   `--skills-dir <s>`,
 *   `--verbose / -v`,
 *   `--markdown <path>`.
 * Unknown flags are passed through to clipanion which already
 * handles `--help` and `--version`.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import {
  createBundleBuildCommand,
} from './commands/bundle-build';
import {
  createBundleManifestCommand,
} from './commands/bundle-manifest';
import {
  createCollectionAffectedCommand,
} from './commands/collection-affected';
import {
  createCollectionListCommand,
} from './commands/collection-list';
import {
  createCollectionValidateCommand,
} from './commands/collection-validate';
import {
  createConfigGetCommand,
} from './commands/config-get';
import {
  createConfigListCommand,
} from './commands/config-list';
import {
  createDoctorCommand,
} from './commands/doctor';
import {
  createExplainCommand,
} from './commands/explain';
import {
  createHubAddCommand,
  createHubListCommand,
  createHubRemoveCommand,
  createHubSyncCommand,
  createHubUseCommand,
} from './commands/hub';
import {
  createIndexBenchCommand,
} from './commands/index-bench';
import {
  createIndexBuildCommand,
} from './commands/index-build';
import {
  createIndexEvalCommand,
} from './commands/index-eval';
import {
  createIndexExportCommand,
} from './commands/index-export';
import {
  createIndexHarvestCommand,
} from './commands/index-harvest';
import {
  createIndexReportCommand,
} from './commands/index-report';
import {
  createIndexSearchCommand,
} from './commands/index-search';
import {
  createIndexShortlistCommand,
  type IndexShortlistSubcommand,
} from './commands/index-shortlist';
import {
  createIndexStatsCommand,
} from './commands/index-stats';
import {
  createInstallCommand,
} from './commands/install';
import {
  createPluginsListCommand,
} from './commands/plugins-list';
import {
  createProfileActivateCommand,
  createProfileCurrentCommand,
  createProfileDeactivateCommand,
  createProfileListCommand,
  createProfileShowCommand,
} from './commands/profile';
import {
  createSkillNewCommand,
} from './commands/skill-new';
import {
  createSkillValidateCommand,
} from './commands/skill-validate';
import {
  createSourceAddCommand,
  createSourceListCommand,
  createSourceRemoveCommand,
} from './commands/source';
import {
  createTargetAddCommand,
} from './commands/target-add';
import {
  createTargetListCommand,
} from './commands/target-list';
import {
  createTargetRemoveCommand,
} from './commands/target-remove';
import {
  createUninstallCommand,
} from './commands/uninstall';
import {
  createVersionComputeCommand,
} from './commands/version-compute';
import {
  runCli,
} from './framework/cli';
import {
  parseCsv,
  parseCsvKinds,
} from './framework/parsers';
import type {
  OutputFormat,
} from './framework/output';
import {
  createProductionContext,
} from './framework/production-context';

/**
 * Collect repeatable flag occurrences (e.g. multiple `--extra-source`).
 * @param argv Argument vector to scan.
 * @param flag Flag name including the leading `--`.
 * @returns Captured values in order; empty when the flag never appears.
 * @throws Error if a flag appears at the end of argv without a value.
 */
const collectRepeated = (argv: string[], flag: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag) {
      if (i + 1 >= argv.length) {
        throw new Error(
          `Flag ${flag} appears at end of arguments without a value. ` +
          `Usage: ${flag} <value> [${flag} <value> ...]`
        );
      }
      out.push(argv[i + 1]);
    }
  }
  return out;
};

/**
 * Dispatch `prompt-registry index <verb>` to the right framework
 * command. Argument parsing happens here so the heavy lifting in
 * each command file stays clipanion-free.
 * @param argv Full argv (including `index` at [0]).
 * @param ctx Context.
 * @returns Exit code from the dispatched command.
 */
const runIndexCommand = async (
  argv: string[],
  ctx: ReturnType<typeof createProductionContext>
): Promise<number> => {
  const sub = argv[1];
  const restArgv = [argv[0], argv[1], ...argv.slice(2)];
  const parsedI = parseArgs(restArgv);
  const lookup = (flag: string): string | undefined => {
    const i = restArgv.indexOf(flag);
    return i !== -1 && i + 1 < restArgv.length ? restArgv[i + 1] : undefined;
  };
  const positional = restArgv.length >= 3 && !restArgv[2].startsWith('-')
    ? restArgv[2]
    : undefined;

  switch (sub) {
    case 'search': {
      const limit = lookup('--limit');
      const offset = lookup('--offset');
      const cmd = createIndexSearchCommand({
        output: parsedI.output,
        query: lookup('--q'),
        indexFile: lookup('--index'),
        kinds: parseCsvKinds(lookup('--kinds')),
        sources: parseCsv(lookup('--sources')),
        bundles: parseCsv(lookup('--bundles')),
        tags: parseCsv(lookup('--tags')),
        installedOnly: restArgv.includes('--installed-only'),
        limit: limit === undefined ? undefined : Number.parseInt(limit, 10),
        offset: offset === undefined ? undefined : Number.parseInt(offset, 10),
        explain: restArgv.includes('--explain')
      });
      return cmd.run({ ctx });
    }
    case 'stats': {
      return createIndexStatsCommand({
        output: parsedI.output,
        indexFile: lookup('--index')
      }).run({ ctx });
    }
    case 'build': {
      return createIndexBuildCommand({
        output: parsedI.output,
        root: lookup('--root') ?? '',
        outFile: lookup('--out'),
        sourceId: lookup('--source-id')
      }).run({ ctx });
    }
    case 'shortlist': {
      const slSub = restArgv[2] as IndexShortlistSubcommand | undefined;
      const valid: IndexShortlistSubcommand[] = ['new', 'add', 'remove', 'list'];
      if (slSub === undefined || !valid.includes(slSub)) {
        ctx.stderr.write(`Unknown index shortlist subcommand: ${String(slSub ?? '')}\n`);
        return 64;
      }
      return createIndexShortlistCommand({
        subcommand: slSub,
        output: parsedI.output,
        indexFile: lookup('--index'),
        name: lookup('--name'),
        description: lookup('--description'),
        shortlistId: lookup('--id'),
        primitiveId: lookup('--primitive')
      }).run({ ctx });
    }
    case 'export': {
      return createIndexExportCommand({
        output: parsedI.output,
        indexFile: lookup('--index'),
        shortlistId: lookup('--shortlist') ?? '',
        profileId: lookup('--profile-id') ?? '',
        outDir: lookup('--out-dir'),
        profileName: lookup('--name'),
        description: lookup('--description'),
        icon: lookup('--icon'),
        suggestCollection: restArgv.includes('--suggest-collection')
      }).run({ ctx });
    }
    case 'eval': {
      return createIndexEvalCommand({
        output: parsedI.output,
        indexFile: lookup('--index'),
        goldFile: lookup('--gold') ?? ''
      }).run({ ctx });
    }
    case 'bench': {
      const iter = lookup('--iterations');
      return createIndexBenchCommand({
        output: parsedI.output,
        indexFile: lookup('--index'),
        goldFile: lookup('--gold') ?? '',
        iterations: iter === undefined ? undefined : Number.parseInt(iter, 10)
      }).run({ ctx });
    }
    case 'harvest': {
      const concurrency = lookup('--concurrency');
      return createIndexHarvestCommand({
        output: parsedI.output,
        hubRepo: lookup('--hub-repo') ?? positional,
        hubBranch: lookup('--hub-branch'),
        hubConfigFile: lookup('--hub-config-file'),
        noHubConfig: restArgv.includes('--no-hub-config'),
        cacheDir: lookup('--cache-dir'),
        progressFile: lookup('--progress'),
        outFile: lookup('--out'),
        concurrency: concurrency === undefined ? undefined : Number.parseInt(concurrency, 10),
        tokenEnv: lookup('--token-env'),
        sourcesInclude: parseCsv(lookup('--sources-include')),
        sourcesExclude: parseCsv(lookup('--sources-exclude')),
        extraSources: collectRepeated(restArgv, '--extra-source'),
        force: restArgv.includes('--force'),
        dryRun: restArgv.includes('--dry-run'),
        verbose: restArgv.includes('--verbose') || restArgv.includes('-v')
      }).run({ ctx });
    }
    case 'report': {
      return createIndexReportCommand({
        output: parsedI.output,
        hubRepo: lookup('--hub-repo'),
        progressFile: lookup('--progress'),
        cacheDir: lookup('--cache-dir')
      }).run({ ctx });
    }
    default: {
      ctx.stderr.write(`Unknown index subcommand: ${String(sub)}\n`);
      ctx.stderr.write(
        'Valid: search | stats | build | shortlist | export | eval | bench | harvest | report\n'
      );
      return 64;
    }
  }
};

// Helper for iter-13 proxy paths: spawn the legacy bin/ script with
// argv and return its exit code. The bin scripts call process.exit()
// internally; we resolve when the spawned process exits to keep the
// async main()'s contract.
const runLegacyBin = async (script: string, argv: string[]): Promise<number> => {
  const path = await import('node:path');
  const fs = await import('node:fs');
  const cp = await import('node:child_process');
  // From dist/cli/index.js, lib/bin/<script> sits at ../../bin/<script>.
  const scriptPath = path.resolve(__dirname, '..', '..', 'bin', script);
  
  // Fix 7: Check if script exists before attempting to run it
  if (!fs.existsSync(scriptPath)) {
    throw new Error(
      `Legacy script not found: ${scriptPath}\n` +
      `The script may have been removed or renamed. ` +
      `Check the deprecation shims in lib/bin/ for the current migration status.`
    );
  }
  
  const proc = cp.spawnSync('node', [scriptPath, ...argv], {
    stdio: 'inherit'
  });
  return proc.status ?? 1;
};

interface ParsedArgs {
  positional: string[];
  output: OutputFormat | undefined;
  cwd: string | undefined;
  collectionFile: string | undefined;
  version: string | undefined;
  outFile: string | undefined;
  outDir: string | undefined;
  repoSlug: string | undefined;
  changedPaths: string[];
  skillName: string | undefined;
  description: string | undefined;
  skillsDir: string | undefined;
  verbose: boolean;
  markdownPath: string | undefined;
  lockfile: string | undefined;
  target: string | undefined;
  from: string | undefined;
  source: string | undefined;
  allowTarget: string | undefined;
  helpRequested: boolean;
}

const OUTPUT_FORMATS = new Set<string>(['text', 'json', 'yaml', 'ndjson']);

const parseArgs = (argv: string[]): ParsedArgs => {
  const out: ParsedArgs = {
    positional: [],
    output: undefined,
    cwd: undefined,
    collectionFile: undefined,
    version: undefined,
    outFile: undefined,
    outDir: undefined,
    repoSlug: undefined,
    changedPaths: [],
    skillName: undefined,
    description: undefined,
    skillsDir: undefined,
    verbose: false,
    markdownPath: undefined,
    lockfile: undefined,
    target: undefined,
    from: undefined,
    source: undefined,
    allowTarget: undefined,
    helpRequested: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    const skip = parseArgWithNext(a, next, out);
    if (skip) {
      i += 1;
      continue;
    }
    const handled = parseFlagWithoutNext(a, out);
    if (handled) {
      continue;
    }
    parsePositionalOrHelp(a, next, out, i);
  }
  return out;
};

function parseArgWithNext(arg: string, next: string | undefined, out: ParsedArgs): boolean {
  if ((arg === '-o' || arg === '--output') && next !== undefined && OUTPUT_FORMATS.has(next)) {
    out.output = next as OutputFormat;
    return true;
  }
  if (arg === '--json') {
    out.output = 'json';
    process.stderr.write(
      'warning: --json is a deprecated alias for `-o json`; update your scripts.\n'
    );
    return false;
  }
  if (parsePathArg(arg, next, out)) {
    return true;
  }
  return false;
}

/**
 * Parse path-related arguments.
 * @param arg Argument to parse.
 * @param next Next argument value.
 * @param out Output object to populate.
 * @returns True if argument was parsed.
 */
function parsePathArg(arg: string, next: string | undefined, out: ParsedArgs): boolean {
  if (next === undefined) {
    return false;
  }

  const argHandlers: Record<string, (next: string, out: ParsedArgs) => void> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--cwd': (n, o) => {
      o.cwd = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--collection-file': (n, o) => {
      o.collectionFile = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--version': (n, o) => {
      o.version = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--out': (n, o) => {
      o.outFile = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--out-file': (n, o) => {
      o.outFile = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--out-dir': (n, o) => {
      o.outDir = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--repo-slug': (n, o) => {
      o.repoSlug = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--changed-path': (n, o) => {
      o.changedPaths.push(n);
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--skill-name': (n, o) => {
      o.skillName = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--description': (n, o) => {
      o.description = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--skills-dir': (n, o) => {
      o.skillsDir = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--markdown': (n, o) => {
      o.markdownPath = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--lockfile': (n, o) => {
      o.lockfile = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--target': (n, o) => {
      o.target = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--from': (n, o) => {
      o.from = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--source': (n, o) => {
      o.source = n;
    },
    // eslint-disable-next-line @typescript-eslint/naming-convention -- CLI flag names use kebab-case convention
    '--allow-target': (n, o) => {
      o.allowTarget = n;
    }
  };

  const handler = argHandlers[arg];
  if (handler) {
    handler(next, out);
    return true;
  }
  return false;
}

function parseFlagWithoutNext(arg: string, out: ParsedArgs): boolean {
  switch (arg) {
    case '--verbose':
    case '-v': {
      out.verbose = true;
      return true;
    }
    case '--quiet':
    case '-q': {
      return true;
    }
    case '--no-color':
    case '--color=never': {
      return true;
    }
    default: {
      return false;
    }
  }
}

function parsePositionalOrHelp(arg: string, next: string | undefined, out: ParsedArgs, _i: number): void {
  if (arg === '--help' || arg === '-h') {
    out.helpRequested = true;
    out.positional.push(arg);
  } else {
    out.positional.push(arg);
  }
}

function extractCwdOverride(argv: string[]): string | undefined {
  const cwdIdx = argv.indexOf('--cwd');
  return cwdIdx !== -1 && cwdIdx + 1 < argv.length ? argv[cwdIdx + 1] : undefined;
}

function applyQuietOverride(baseCtx: ReturnType<typeof createProductionContext>, argv: string[]): ReturnType<typeof createProductionContext> {
  // Check for --quiet flag
  const quiet = argv.includes('--quiet');
  // Check for -q flag only if it's not followed by a value (i.e., it's not being used as --q for query)
  const qIndex = argv.indexOf('-q');
  const qIsQuiet = qIndex !== -1 && (qIndex === argv.length - 1 || argv[qIndex + 1].startsWith('-'));
  
  // Fix 9: Deprecate -q for query, require --query
  // If -q is followed by a non-flag value, it's being used as --q (query), which is deprecated
  if (qIndex !== -1 && !qIsQuiet) {
    // eslint-disable-next-line no-console -- CLI entry only
    console.warn('warning: -q with a value is deprecated for query. Use --query instead. -q is reserved for quiet mode.');
  }
  
  return (quiet || qIsQuiet)
    ? { ...baseCtx, stdout: { write: (): void => undefined } }
    : baseCtx;
}

function createLookup(restArgv: string[]): (flag: string) => string | undefined {
  return (flag: string): string | undefined => {
    const i = restArgv.indexOf(flag);
    return i !== -1 && i + 1 < restArgv.length ? restArgv[i + 1] : undefined;
  };
}

async function handleInstallCommand(argv: string[], ctx: ReturnType<typeof createProductionContext>): Promise<number> {
  // When using --lockfile, there's no bundle-id positional argument
  const hasLockfile = argv.includes('--lockfile');
  const bundle = hasLockfile && (argv.length < 2 || argv[1].startsWith('-')) ? undefined : argv[1];
  // Include all arguments except the bundle-id positional (if present)
  const bundleIndex = hasLockfile && (argv.length < 2 || argv[1].startsWith('-')) ? -1 : 1;
  const restArgv = bundleIndex === -1 ? argv : [argv[0], ...argv.slice(bundleIndex + 1)];
  const parsedI = parseArgs(restArgv);
  const lookup = createLookup(restArgv);
  const cmd = createInstallCommand({
    output: parsedI.output,
    bundle,
    lockfile: parsedI.lockfile ?? lookup('--lockfile'),
    target: parsedI.target ?? lookup('--target'),
    from: parsedI.from ?? lookup('--from'),
    dryRun: restArgv.includes('--dry-run'),
    allowTarget: parsedI.allowTarget ?? lookup('--allow-target'),
    source: parsedI.source ?? lookup('--source')
  });
  return cmd.run({ ctx });
}

async function handleUninstallCommand(argv: string[], ctx: ReturnType<typeof createProductionContext>): Promise<number> {
  const bundle = argv[1];
  const restArgv = [argv[0], ...argv.slice(2)];
  const parsedU = parseArgs(restArgv);
  const lookup = createLookup(restArgv);
  const cmd = createUninstallCommand({
    output: parsedU.output,
    bundle,
    lockfile: lookup('--lockfile'),
    target: lookup('--target'),
    all: restArgv.includes('--all')
  });
  return cmd.run({ ctx });
}

async function handleTargetRemoveCommand(argv: string[], ctx: ReturnType<typeof createProductionContext>): Promise<number> {
  const name = argv[2];
  const restArgv = [argv[0], argv[1], ...argv.slice(3)];
  const parsedT = parseArgs(restArgv);
  const cmd = createTargetRemoveCommand({ output: parsedT.output, name });
  return cmd.run({ ctx });
}

async function handleTargetAddCommand(argv: string[], ctx: ReturnType<typeof createProductionContext>): Promise<number> {
  const name = argv[2];
  const restArgv = [argv[0], argv[1], ...argv.slice(3)];
  const parsedT = parseArgs(restArgv);
  const lookup = createLookup(restArgv);
  const cmd = createTargetAddCommand({
    output: parsedT.output,
    name,
    type: lookup('--type') ?? '',
    scope: lookup('--scope'),
    path: lookup('--path'),
    allowedKinds: lookup('--allowed-kinds')
  });
  return cmd.run({ ctx });
}

async function handleConfigGetCommand(argv: string[], ctx: ReturnType<typeof createProductionContext>): Promise<number> {
  const key = argv[2];
  const restArgv = [argv[0], argv[1], ...argv.slice(3)];
  const parsedCfg = parseArgs(restArgv);
  const cmd = createConfigGetCommand({ output: parsedCfg.output, key });
  return cmd.run({ ctx });
}

async function handleExplainCommand(argv: string[], ctx: ReturnType<typeof createProductionContext>): Promise<number> {
  const explainCode = argv[1];
  const restArgv = [argv[0], ...argv.slice(2)];
  const parsedExplain = parseArgs(restArgv);
  const cmd = createExplainCommand({ output: parsedExplain.output, code: explainCode });
  return cmd.run({ ctx });
}

/**
 * Check if argv matches a command pattern with positional argument.
 * @param argv Command arguments.
 * @param command Command name.
 * @param subcommand Optional subcommand name.
 * @param positionalIndex Index of positional argument.
 * @returns True if pattern matches.
 */
function matchesCommandWithPositional(
  argv: string[],
  command: string,
  subcommand?: string,
  positionalIndex?: number
): boolean {
  if (argv[0] !== command) {
    return false;
  }
  if (subcommand !== undefined && argv[1] !== subcommand) {
    return false;
  }
  const idx = subcommand === undefined ? 1 : 2;
  if (argv.length <= idx) {
    return false;
  }
  if (positionalIndex !== undefined && argv[positionalIndex].startsWith('-')) {
    return false;
  }
  return true;
}

/**
 * Handle legacy bin script commands.
 * @param argv Command arguments.
 * @returns Command result or null if not a legacy command.
 */
async function handleLegacyCommands(argv: string[]): Promise<number | null> {
  if (argv[0] === 'hub' && argv[1] === 'analyze') {
    return runLegacyBin('hub-release-analyzer.js', argv.slice(2));
  }
  if (argv[0] === 'collection' && argv[1] === 'publish') {
    return runLegacyBin('publish-collections.js', argv.slice(2));
  }
  return null;
}

/**
 * Handle subcommand-based commands.
 * @param argv Command arguments.
 * @param ctx Production context.
 * @returns Command result or null if not a subcommand command.
 */
async function handleSubcommandCommands(argv: string[], ctx: ReturnType<typeof createProductionContext>): Promise<number | null> {
  // Let --help fall through to clipanion for proper help display
  if (argv[0] === 'index' && argv.length >= 2 && !argv.includes('--help') && !argv.includes('-h')) {
    return runIndexCommand(argv, ctx);
  }
  return null;
}

const main = async (argv: string[]): Promise<number> => {
  const cwdOverride = extractCwdOverride(argv);
  const baseCtx = createProductionContext({ cwd: cwdOverride });
  const ctx = applyQuietOverride(baseCtx, argv);

  // Phase 4 / Iter 31 → Phase 5 / Iter 23: `prompt-registry install
  // <bundle> [--target N] [--from D] [--dry-run] [--lockfile L]`.
  // Allow install with --lockfile (no bundle-id required) or with bundle-id.
  // Intercept all install commands to avoid clipanion rejecting --lockfile as unknown.
  // Let --help fall through to clipanion for proper help display.
  if (argv[0] === 'install' && !argv.includes('--help') && !argv.includes('-h')) {
    return handleInstallCommand(argv, ctx);
  }

  // Phase 5 / Iter 23: `prompt-registry uninstall <bundle-id> [--target N]
  // [--lockfile L] [--all]`.
  if (argv[0] === 'uninstall') {
    return handleUninstallCommand(argv, ctx);
  }

  // Phase 4 / Iter 30: `prompt-registry target remove <NAME>` intercept.
  if (matchesCommandWithPositional(argv, 'target', 'remove', 2)) {
    return handleTargetRemoveCommand(argv, ctx);
  }

  // Phase 4 / Iter 29 → Phase 5 / Iter 3: `target add <NAME> --type <T>
  // [--scope user|workspace] [--path P] [--allowed-kinds a,b,c]`.
  if (matchesCommandWithPositional(argv, 'target', 'add', 2)) {
    return handleTargetAddCommand(argv, ctx);
  }

  // Handle subcommand-based commands
  const subcommandResult = await handleSubcommandCommands(argv, ctx);
  if (subcommandResult !== null) {
    return subcommandResult;
  }

  // Phase 4 / Iter 23: `prompt-registry config get <KEY>` intercept,
  // same shape as explain. Defines the key positional manually until
  // clipanion-native option wiring lands.
  if (matchesCommandWithPositional(argv, 'config', 'get', 2)) {
    return handleConfigGetCommand(argv, ctx);
  }

  // Phase 4 / Iter 19: `prompt-registry explain <CODE>` is intercepted
  // here because clipanion rejects extraneous positional args on a
  // command defined with no positional schema. Iter 9's clipanion-
  // native option wiring will let us define the positional formally;
  // until then, this short-circuit handles it.
  if (matchesCommandWithPositional(argv, 'explain', undefined, 1)) {
    return handleExplainCommand(argv, ctx);
  }

  // Phase 4 / Iter 13: proxy `hub analyze` and `collection publish`
  // to the legacy bin/ scripts. They are large (771 / 350 lines)
  // and scripted; rewriting them as framework commands is iter 26+
  // work. The proxy delegates argv directly so flag handling stays
  // identical.
  const legacyResult = await handleLegacyCommands(argv);
  if (legacyResult !== null) {
    return legacyResult;
  }

  const parsed = parseArgs(argv);

  // Build every command with the parsed flags propagated. Commands
  // that don't need a flag simply ignore it. The required-options
  // commands (`bundle manifest`, `version compute`, `skill new`)
  // surface a USAGE error at runtime if invoked without the needed
  // flag — iter 9 makes that a clipanion-native compile error.
  const commands = [
    createDoctorCommand({ output: parsed.output }),
    createExplainCommand({
      output: parsed.output,
      // The error code is the first non-flag positional after `explain`.
      // The framework adapter strips the path tokens; the remaining
      // positionals (if any) appear here. Iter 9 will surface this
      // properly via clipanion options.
      code: parsed.positional.length >= 2 && parsed.positional[0] === 'explain'
        ? parsed.positional[1]
        : ''
    }),
    createCollectionListCommand({ output: parsed.output }),
    createCollectionValidateCommand({
      output: parsed.output,
      verbose: parsed.verbose,
      markdownPath: parsed.markdownPath,
      collectionFiles: parsed.collectionFile === undefined ? undefined : [parsed.collectionFile]
    }),
    createCollectionAffectedCommand({
      output: parsed.output,
      changedPaths: parsed.changedPaths
    }),
    createBundleBuildCommand({
      output: parsed.output,
      collectionFile: parsed.collectionFile ?? '',
      version: parsed.version ?? '0.0.0-dev',
      outDir: parsed.outDir,
      repoSlug: parsed.repoSlug
    }),
    createBundleManifestCommand({
      output: parsed.output,
      // `version` is required for bundle.manifest. Defaulting to a
      // sentinel keeps the factory typed; the command handler will
      // surface USAGE.MISSING_FLAG if the user actually invokes it
      // without the flag (iter 9 wires real validation).
      version: parsed.version ?? '0.0.0-dev',
      collectionFile: parsed.collectionFile,
      outFile: parsed.outFile
    }),
    createSkillNewCommand({
      output: parsed.output,
      skillName: parsed.skillName ?? '',
      description: parsed.description ?? '',
      skillsDir: parsed.skillsDir
    }),
    createSkillValidateCommand({
      output: parsed.output,
      skillsDir: parsed.skillsDir,
      verbose: parsed.verbose
    }),
    createVersionComputeCommand({
      output: parsed.output,
      collectionFile: parsed.collectionFile ?? ''
    }),
    createConfigListCommand({ output: parsed.output }),
    createPluginsListCommand({ output: parsed.output }),
    createTargetListCommand({ output: parsed.output }),
    // install/uninstall: dispatched before runCli — stubs for --help.
    createInstallCommand({ output: parsed.output }),
    createUninstallCommand({ output: parsed.output }),
    createConfigGetCommand({
      output: parsed.output,
      // The dotted key is the second positional after `config get`.
      // Same pattern as explain: clipanion needs the positional
      // declared formally (iter 9), but for now we extract from the
      // hand-rolled positional array.
      key: parsed.positional.length >= 3
        && parsed.positional[0] === 'config'
        && parsed.positional[1] === 'get'
        ? parsed.positional[2]
        : ''
    }),
    // Index commands: dispatched via runIndexCommand before runCli is reached.
    // These stubs exist solely for --help display and are never executed.
    createIndexSearchCommand(),
    createIndexStatsCommand(),
    createIndexBuildCommand({ root: '' }),
    createIndexShortlistCommand({ subcommand: 'new' }),
    createIndexExportCommand({ shortlistId: '', profileId: '' }),
    createIndexEvalCommand({ goldFile: '' }),
    createIndexBenchCommand({ goldFile: '' }),
    createIndexHarvestCommand(),
    createIndexReportCommand(),
    // target add/remove: dispatched before runCli — stubs for --help.
    createTargetAddCommand({ name: '', type: '' }),
    createTargetRemoveCommand({ name: '' })
  ];

  const commandClasses = [
    createHubListCommand(ctx, undefined, undefined, parsed.output),
    createHubAddCommand(ctx, undefined, undefined, parsed.output),
    createHubUseCommand(ctx, undefined, undefined, parsed.output),
    createHubRemoveCommand(ctx, undefined, undefined, parsed.output),
    createHubSyncCommand(ctx, undefined, undefined, parsed.output),
    createSourceAddCommand(ctx, undefined, undefined, parsed.output),
    createSourceListCommand(ctx, undefined, undefined, parsed.output),
    createSourceRemoveCommand(ctx, undefined, undefined, parsed.output),
    createProfileListCommand(ctx, undefined, undefined, parsed.output),
    createProfileShowCommand(ctx, undefined, undefined, parsed.output),
    createProfileActivateCommand(ctx, undefined, undefined, parsed.output),
    createProfileDeactivateCommand(ctx, undefined, undefined, parsed.output),
    createProfileCurrentCommand(ctx, undefined, undefined, parsed.output)
  ];

  return runCli(parsed.positional, {
    ctx,
    commands,
    commandClasses,
    name: 'prompt-registry',
    version: readPackageVersion()
  });
};

// Read the lib/ package.json's `version` field at startup. The
// resolved path goes from dist/cli/index.js -> ../../package.json.
// On failure (e.g., the file moved during a future refactor), fall
// back to '0.0.0-dev' so --version still produces something rather
// than crashing the entire CLI.
const readPackageVersion = (): string => {
  try {
    const pkgPath = nodePath.resolve(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(nodeFs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
};

// CLI binary entry: only place where process.exit/console.error are
// permitted (spec §14.2 invariant #3). ESLint rule from Phase 2
// iter 9 enforces this for every other file under src/cli/.
//
// The mainWithArgv function accepts an optional argv parameter for
// deprecation shims that need to pass rewritten arguments without
// mutating process.argv. If not provided, it defaults to process.argv.slice(2).
export const mainWithArgv = (argv?: string[]): Promise<number> => {
  return main(argv ?? process.argv.slice(2));
};

// Direct binary invocation (uses process.argv)
main(process.argv.slice(2))
  // eslint-disable-next-line unicorn/no-process-exit -- CLI entry only.
  .then((code) => process.exit(code))
  .catch((err) => {
    // eslint-disable-next-line no-console -- CLI entry only.
    console.error(err);
    // eslint-disable-next-line unicorn/no-process-exit -- CLI entry only.
    process.exit(70); // EX_SOFTWARE
  });

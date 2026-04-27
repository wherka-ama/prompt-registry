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
  createHubCommand,
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
  createProfileCommand,
} from './commands/profile';
import {
  createSkillNewCommand,
} from './commands/skill-new';
import {
  createSkillValidateCommand,
} from './commands/skill-validate';
import {
  createSourceCommand,
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
  createVersionComputeCommand,
} from './commands/version-compute';
import {
  runCli,
} from './framework/cli';
import type {
  OutputFormat,
} from './framework/output';
import {
  createProductionContext,
} from './framework/production-context';

/**
 * Parse a comma-separated list flag (e.g. `--kinds prompt,agent`).
 * @param raw Flag value as captured from argv (or undefined).
 * @returns Trimmed array, or undefined when the flag was not set.
 */
const parseCsv = (raw: string | undefined): string[] | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
};

/**
 * Collect repeatable flag occurrences (e.g. multiple `--extra-source`).
 * @param argv Argument vector to scan.
 * @param flag Flag name including the leading `--`.
 * @returns Captured values in order; empty when the flag never appears.
 */
const collectRepeated = (argv: string[], flag: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag && i + 1 < argv.length) {
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
        query: lookup('--q') ?? lookup('-q'),
        indexFile: lookup('--index'),
        kinds: parseCsv(lookup('--kinds')) as never,
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
  const cp = await import('node:child_process');
  // From dist/cli/index.js, lib/bin/<script> sits at ../../bin/<script>.
  const scriptPath = path.resolve(__dirname, '..', '..', 'bin', script);
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
    helpRequested: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if ((a === '-o' || a === '--output') && next !== undefined && OUTPUT_FORMATS.has(next)) {
      out.output = next as OutputFormat;
      i += 1;
    } else if (a === '--json') {
      // Legacy alias from the original bin/* scripts. Migration
      // guide notes `-o json` is preferred; warn once on stderr so
      // pipelines using `--json` get nudged toward the new flag.
      out.output = 'json';
      process.stderr.write(
        'warning: --json is a deprecated alias for `-o json`; update your scripts.\n'
      );
    } else if (a === '--cwd' && next !== undefined) {
      out.cwd = next;
      i += 1;
    } else if (a === '--collection-file' && next !== undefined) {
      out.collectionFile = next;
      i += 1;
    } else if (a === '--version' && next !== undefined) {
      out.version = next;
      i += 1;
    } else if ((a === '--out' || a === '--out-file') && next !== undefined) {
      out.outFile = next;
      i += 1;
    } else if (a === '--out-dir' && next !== undefined) {
      out.outDir = next;
      i += 1;
    } else if (a === '--repo-slug' && next !== undefined) {
      out.repoSlug = next;
      i += 1;
    } else if (a === '--changed-path' && next !== undefined) {
      out.changedPaths.push(next);
      i += 1;
    } else if (a === '--skill-name' && next !== undefined) {
      out.skillName = next;
      i += 1;
    } else if (a === '--description' && next !== undefined) {
      out.description = next;
      i += 1;
    } else if (a === '--skills-dir' && next !== undefined) {
      out.skillsDir = next;
      i += 1;
    } else {
      switch (a) {
        case '--verbose':
        case '-v': {
          out.verbose = true;

          break;
        }
        case '--quiet':
        case '-q': {
          // Consumed at the binary entry (iter 39) by overriding ctx.stdout.
          // The parser swallows it here so it doesn't end up in `positional`.

          break;
        }
        case '--no-color':
        case '--color=never': {
          // Honors NO_COLOR convention. Not used by Phase 4 commands
          // (none of them emit ANSI sequences yet); recognized so future
          // colorized output respects it. Same swallow pattern as
          // --quiet to keep `positional` clean.

          break;
        }
        default: { if (a === '--markdown' && next !== undefined) {
          out.markdownPath = next;
          i += 1;
        } else if (a === '--help' || a === '-h') {
          out.helpRequested = true;
          out.positional.push(a);
        } else {
          out.positional.push(a);
        }
        }
      }
    }
  }
  return out;
};

const main = async (): Promise<number> => {
  const argv = process.argv.slice(2);
  // Pre-scan for --cwd so the production Context can be built with
  // the redirected working directory before any command runs.
  const cwdIdx = argv.indexOf('--cwd');
  const cwdOverride = cwdIdx !== -1 && cwdIdx + 1 < argv.length ? argv[cwdIdx + 1] : undefined;
  const baseCtx = createProductionContext({ cwd: cwdOverride });

  // Phase 4 / Iter 39: --quiet swaps stdout for a no-op sink. Errors
  // (stderr) and JSON envelopes still pass through. Spec §9.4 says
  // `--quiet` suppresses prose only; `-o json` callers always get the
  // envelope. We keep stderr live so deprecation warnings and
  // RegistryError renderings remain visible.
  const quiet = argv.includes('--quiet') || argv.includes('-q');
  const ctx = quiet
    ? { ...baseCtx, stdout: { write: (): void => undefined } }
    : baseCtx;

  // Phase 4 / Iter 31 → Phase 5 / Iter 23: `prompt-registry install
  // <bundle> [--target N] [--from D] [--dry-run] [--lockfile L]`.
  if (argv[0] === 'install' && argv.length >= 2 && !argv[1].startsWith('-')) {
    const bundle = argv[1];
    const restArgv = [argv[0], ...argv.slice(2)];
    const parsedI = parseArgs(restArgv);
    const lookup = (flag: string): string | undefined => {
      const i = restArgv.indexOf(flag);
      return i !== -1 && i + 1 < restArgv.length ? restArgv[i + 1] : undefined;
    };
    const cmd = createInstallCommand({
      output: parsedI.output,
      bundle,
      lockfile: lookup('--lockfile'),
      target: lookup('--target'),
      from: lookup('--from'),
      dryRun: restArgv.includes('--dry-run'),
      allowTarget: lookup('--allow-target'),
      source: lookup('--source')
    });
    return cmd.run({ ctx });
  }

  // Phase 4 / Iter 30: `prompt-registry target remove <NAME>` intercept.
  if (argv[0] === 'target' && argv[1] === 'remove'
    && argv.length >= 3 && !argv[2].startsWith('-')) {
    const name = argv[2];
    const restArgv = [argv[0], argv[1], ...argv.slice(3)];
    const parsedT = parseArgs(restArgv);
    const cmd = createTargetRemoveCommand({ output: parsedT.output, name });
    return cmd.run({ ctx });
  }

  // Phase 4 / Iter 29 → Phase 5 / Iter 3: `target add <NAME> --type <T>
  // [--scope user|workspace] [--path P] [--allowed-kinds a,b,c]`.
  if (argv[0] === 'target' && argv[1] === 'add'
    && argv.length >= 3 && !argv[2].startsWith('-')) {
    const name = argv[2];
    const restArgv = [argv[0], argv[1], ...argv.slice(3)];
    const parsedT = parseArgs(restArgv);
    const lookup = (flag: string): string | undefined => {
      const i = restArgv.indexOf(flag);
      return i !== -1 && i + 1 < restArgv.length ? restArgv[i + 1] : undefined;
    };
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

  // Phase 6 / Iter 51-58: `prompt-registry hub <subcommand> [...]`.
  if (argv[0] === 'hub' && argv.length >= 2) {
    const sub = argv[1];
    const valid = new Set(['add', 'list', 'use', 'remove', 'sync']);
    if (!valid.has(sub)) {
      ctx.stderr.write(`Unknown hub subcommand: ${sub}\n`);
      return 1;
    }
    const restArgv = [argv[0], argv[1], ...argv.slice(2)];
    const parsedH = parseArgs(restArgv);
    const lookup = (flag: string): string | undefined => {
      const i = restArgv.indexOf(flag);
      return i !== -1 && i + 1 < restArgv.length ? restArgv[i + 1] : undefined;
    };
    // Positional id for use/remove/sync (third arg, no leading dash).
    const positional = restArgv.length >= 3 && !restArgv[2].startsWith('-')
      ? restArgv[2]
      : undefined;
    const refType = lookup('--type');
    const cmd = createHubCommand({
      subcommand: sub as 'add' | 'list' | 'use' | 'remove' | 'sync',
      output: parsedH.output,
      refType: refType === 'github' || refType === 'local' || refType === 'url' ? refType : undefined,
      refLocation: lookup('--location'),
      refRef: lookup('--ref'),
      hubId: lookup('--id') ?? positional,
      clear: restArgv.includes('--clear'),
      check: restArgv.includes('--check')
    });
    return cmd.run({ ctx });
  }

  // Phase 6 / Iter 84: `prompt-registry source <subcommand> [...]`.
  if (argv[0] === 'source' && argv.length >= 2) {
    const sub = argv[1];
    const valid = new Set(['add', 'list', 'remove']);
    if (!valid.has(sub)) {
      ctx.stderr.write(`Unknown source subcommand: ${sub}\n`);
      return 1;
    }
    const restArgv = [argv[0], argv[1], ...argv.slice(2)];
    const parsedS = parseArgs(restArgv);
    const lookup = (flag: string): string | undefined => {
      const i = restArgv.indexOf(flag);
      return i !== -1 && i + 1 < restArgv.length ? restArgv[i + 1] : undefined;
    };
    const positional = restArgv.length >= 3 && !restArgv[2].startsWith('-')
      ? restArgv[2]
      : undefined;
    const tStr = lookup('--type');
    const cmd = createSourceCommand({
      subcommand: sub as 'add' | 'list' | 'remove',
      output: parsedS.output,
      sourceType: tStr === 'github' || tStr === 'local' ? tStr : undefined,
      url: lookup('--url'),
      sourceId: lookup('--id') ?? positional,
      name: lookup('--name'),
      hubId: lookup('--hub')
    });
    return cmd.run({ ctx });
  }

  // Phase 6 / Iter 79-80: `prompt-registry profile <subcommand> [...]`.
  if (argv[0] === 'profile' && argv.length >= 2) {
    const sub = argv[1];
    const valid = new Set(['list', 'show', 'activate', 'deactivate', 'current']);
    if (!valid.has(sub)) {
      ctx.stderr.write(`Unknown profile subcommand: ${sub}\n`);
      return 1;
    }
    const restArgv = [argv[0], argv[1], ...argv.slice(2)];
    const parsedP = parseArgs(restArgv);
    const lookup = (flag: string): string | undefined => {
      const i = restArgv.indexOf(flag);
      return i !== -1 && i + 1 < restArgv.length ? restArgv[i + 1] : undefined;
    };
    const positional = restArgv.length >= 3 && !restArgv[2].startsWith('-')
      ? restArgv[2]
      : undefined;
    const cmd = createProfileCommand({
      subcommand: sub as 'list' | 'show' | 'activate' | 'deactivate' | 'current',
      output: parsedP.output,
      profileId: positional,
      hubId: lookup('--hub'),
      targets: lookup('--target')
    });
    return cmd.run({ ctx });
  }

  // Phase 4 / Iter 23: `prompt-registry config get <KEY>` intercept,
  // same shape as explain. Defines the key positional manually until
  // clipanion-native option wiring lands.
  if (argv[0] === 'config' && argv[1] === 'get'
    && argv.length >= 3 && !argv[2].startsWith('-')) {
    const key = argv[2];
    const restArgv = [argv[0], argv[1], ...argv.slice(3)];
    const parsedCfg = parseArgs(restArgv);
    const cmd = createConfigGetCommand({ output: parsedCfg.output, key });
    return cmd.run({ ctx });
  }

  // Phase 4 / Iter 19: `prompt-registry explain <CODE>` is intercepted
  // here because clipanion rejects extraneous positional args on a
  // command defined with no positional schema. Iter 9's clipanion-
  // native option wiring will let us define the positional formally;
  // until then, this short-circuit handles it.
  if (argv[0] === 'explain' && argv.length >= 2 && !argv[1].startsWith('-')) {
    const explainCode = argv[1];
    const restArgv = [argv[0], ...argv.slice(2)];
    const parsedExplain = parseArgs(restArgv);
    const cmd = createExplainCommand({ output: parsedExplain.output, code: explainCode });
    return cmd.run({ ctx });
  }

  // `prompt-registry index <subcommand>` — every verb is a framework
  // command (lib/src/cli/commands/index-*.ts). The legacy proxy was
  // retired together with `lib/src/primitive-index/cli.ts`.
  if (argv[0] === 'index' && argv.length >= 2) {
    return runIndexCommand(argv, ctx);
  }

  // Phase 4 / Iter 13: proxy `hub analyze` and `collection publish`
  // to the legacy bin/ scripts. They are large (771 / 350 lines)
  // and scripted; rewriting them as framework commands is iter 26+
  // work. The proxy delegates argv directly so flag handling stays
  // identical.
  if (argv[0] === 'hub' && argv[1] === 'analyze') {
    return runLegacyBin('hub-release-analyzer.js', argv.slice(2));
  }
  if (argv[0] === 'collection' && argv[1] === 'publish') {
    return runLegacyBin('publish-collections.js', argv.slice(2));
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
    createInstallCommand({ output: parsed.output }),
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
    })
  ];

  return runCli(parsed.positional, {
    ctx,
    commands,
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
main()
  // eslint-disable-next-line unicorn/no-process-exit -- CLI entry only.
  .then((code) => process.exit(code))
  .catch((err) => {
    // eslint-disable-next-line no-console -- CLI entry only.
    console.error(err);
    // eslint-disable-next-line unicorn/no-process-exit -- CLI entry only.
    process.exit(70); // EX_SOFTWARE
  });

/**
 * Phase 2D / Iter 1 — CLI composition root.
 *
 * Replaces the 918-line src/cli/index.ts monolith with a clean
 * composition root pattern. This file:
 * - Creates production Context (FileSystem, HttpClient, Clock, TokenProvider)
 * - Registers all CLI commands
 * - Dispatches via clipanion
 *
 * Commands are still using the defineCommand wrapper during this iter.
 * Subsequent iters will convert each command to native clipanion
 * Command subclasses with Option decorators.
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
import type {
  OutputFormat,
} from './framework/output';
import {
  parseCsv,
  parseCsvKinds,
} from './framework/parsers';
import {
  createProductionContext,
} from './framework/production-context';

/**
 * Main CLI entry point.
 * @param argv Process arguments (typically process.argv.slice(2)).
 * @returns Exit code.
 */
export const main = async (argv: string[]): Promise<number> => {
  const ctx = createProductionContext();

  // Parse common flags
  const parsed = parseArgs(argv);

  const commands = [
    createBundleBuildCommand({
      output: parsed.output,
      collectionFile: parsed.collectionFile ?? '',
      version: parsed.version ?? '0.0.0-dev',
      outDir: parsed.outDir,
      repoSlug: parsed.repoSlug
    }),
    createBundleManifestCommand({
      output: parsed.output,
      outFile: parsed.outFile ?? '',
      version: parsed.version ?? '',
      collectionFile: parsed.collectionFile ?? ''
    }),
    createCollectionAffectedCommand({
      output: parsed.output,
      changedPaths: parseCsv(parsed.changedPath)
    }),
    createCollectionListCommand({ output: parsed.output }),
    createCollectionValidateCommand({
      output: parsed.output,
      markdownPath: parsed.markdownPath,
      collectionFiles: parseCsv(parsed.collectionFile),
      verbose: parsed.verbose
    }),
    createDoctorCommand({ output: parsed.output }),
    createExplainCommand({
      output: parsed.output,
      code: '' // Will be extracted from positionals in the actual dispatch
    }),
    createIndexSearchCommand(),
    createIndexStatsCommand(),
    createIndexBuildCommand({ root: '' }),
    createIndexShortlistCommand({ subcommand: 'new' }),
    createIndexExportCommand({ shortlistId: '', profileId: '' }),
    createIndexEvalCommand({ goldFile: '' }),
    createIndexBenchCommand({ goldFile: '' }),
    createIndexHarvestCommand(),
    createIndexReportCommand(),
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
    createUninstallCommand({ output: parsed.output }),
    createConfigGetCommand({
      output: parsed.output,
      key: parsed.positional.length >= 3
        && parsed.positional[0] === 'config'
        && parsed.positional[1] === 'get'
        ? parsed.positional[2]
        : ''
    }),
    createIndexSearchCommand(),
    createIndexStatsCommand(),
    createIndexBuildCommand({ root: '' }),
    createIndexShortlistCommand({ subcommand: 'new' }),
    createIndexExportCommand({ shortlistId: '', profileId: '' }),
    createIndexEvalCommand({ goldFile: '' }),
    createIndexBenchCommand({ goldFile: '' }),
    createIndexHarvestCommand(),
    createIndexReportCommand(),
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

/**
 * Parse command-line arguments into common flags and positionals.
 * @param argv Argument vector.
 * @returns Parsed arguments.
 */
const parseArgs = (argv: string[]): {
  positional: string[];
  output?: OutputFormat;
  collectionFile?: string;
  version?: string;
  outDir?: string;
  outFile?: string;
  repoSlug?: string;
  changedPath?: string;
  markdown?: string;
  markdownPath?: string;
  skillName?: string;
  description?: string;
  skillsDir?: string;
  verbose?: boolean;
} => {
  const positional: string[] = [];
  let output: OutputFormat | undefined = undefined;
  let collectionFile: string | undefined = undefined;
  let version: string | undefined = undefined;
  let outDir: string | undefined = undefined;
  let outFile: string | undefined = undefined;
  let repoSlug: string | undefined = undefined;
  let changedPath: string | undefined = undefined;
  let markdown: string | undefined = undefined;
  let markdownPath: string | undefined = undefined;
  let skillName: string | undefined = undefined;
  let description: string | undefined = undefined;
  let skillsDir: string | undefined = undefined;
  let verbose = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-o' || arg === '--output') {
      output = argv[i + 1] as OutputFormat;
      i += 1;
    } else if (arg === '--collection-file') {
      collectionFile = argv[i + 1];
      i += 1;
    } else if (arg === '--version') {
      version = argv[i + 1];
      i += 1;
    } else if (arg === '--out-dir') {
      outDir = argv[i + 1];
      i += 1;
    } else if (arg === '--out' || arg === '--out-file') {
      outFile = argv[i + 1];
      i += 1;
    } else if (arg === '--repo-slug') {
      repoSlug = argv[i + 1];
      i += 1;
    } else if (arg === '--changed-path') {
      changedPath = argv[i + 1];
      i += 1;
    } else if (arg === '--markdown') {
      markdown = argv[i + 1];
      i += 1;
    } else if (arg === '--markdown-path') {
      markdownPath = argv[i + 1];
      i += 1;
    } else if (arg === '--skill-name') {
      skillName = argv[i + 1];
      i += 1;
    } else if (arg === '--description') {
      description = argv[i + 1];
      i += 1;
    } else if (arg === '--skills-dir') {
      skillsDir = argv[i + 1];
      i += 1;
    } else if (arg === '-v' || arg === '--verbose') {
      verbose = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return {
    positional,
    output,
    collectionFile,
    version,
    outDir,
    outFile,
    repoSlug,
    changedPath,
    markdown,
    markdownPath,
    skillName,
    description,
    skillsDir,
    verbose
  };
};

/**
 * Read the lib/ package.json's `version` field at startup.
 * @returns Version string or '0.0.0-dev' fallback.
 */
const readPackageVersion = (): string => {
  try {
    const pkgPath = nodePath.resolve(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(nodeFs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
};

/**
 * CLI binary entry: only place where process.exit/console.error are
 * permitted (spec §14.2 invariant #3).
 */
if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

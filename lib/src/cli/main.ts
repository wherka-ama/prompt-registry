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
  envTokenProvider,
} from '../infra/github/token';
import {
  NodeHttpClient,
} from '../infra/http/node-http-client';
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
  ExplainCommand,
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
  IndexBenchCommand,
} from './commands/index-bench';
import {
  createIndexBuildCommand,
  IndexBuildCommand,
} from './commands/index-build';
import {
  createIndexEvalCommand,
  IndexEvalCommand,
} from './commands/index-eval';
import {
  createIndexExportCommand,
  IndexExportCommand,
} from './commands/index-export';
import {
  createIndexHarvestCommand,
  IndexHarvestCommand,
} from './commands/index-harvest';
import {
  createIndexReportCommand,
  IndexReportCommand,
} from './commands/index-report';
import {
  createIndexSearchCommand,
  IndexSearchCommand,
} from './commands/index-search';
import {
  createIndexShortlistCommand,
  IndexShortlistNewCommand,
  IndexShortlistAddCommand,
  IndexShortlistRemoveCommand,
  IndexShortlistListCommand,
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
  TargetAddCommand,
} from './commands/target-add';
import {
  TargetListCommand,
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

  // Create HTTP client and token provider for hub/profile commands
  const httpClient = new NodeHttpClient();
  const tokenProvider = envTokenProvider(ctx.env);

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
    createIndexStatsCommand(),
    // createIndexBuildCommand({ root: '' }), // Removed: IndexBuildCommand is now registered as a class
    // createIndexShortlistCommand({ subcommand: 'new' }), // Removed: IndexShortlist*Commands are now registered as classes
    // createIndexExportCommand({ shortlistId: '', profileId: '' }), // Removed: IndexExportCommand is now registered as a class
    // createIndexEvalCommand({ goldFile: '' }), // Removed: IndexEvalCommand is now registered as a class
    // createIndexBenchCommand({ goldFile: '' }), // Removed: IndexBenchCommand is now registered as a class
    // createIndexHarvestCommand(), // Removed: IndexHarvestCommand is now registered as a class
    // createIndexReportCommand(), // Removed: IndexReportCommand is now registered as a class
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
    createTargetRemoveCommand({ name: '' })
  ];

  const commandClasses = [
    ExplainCommand,
    TargetAddCommand,
    TargetListCommand,
    IndexSearchCommand,
    IndexBuildCommand,
    IndexShortlistNewCommand,
    IndexShortlistAddCommand,
    IndexShortlistRemoveCommand,
    IndexShortlistListCommand,
    IndexExportCommand,
    IndexEvalCommand,
    IndexBenchCommand,
    IndexHarvestCommand,
    IndexReportCommand,
    createHubListCommand(ctx, httpClient, tokenProvider, parsed.output),
    createHubAddCommand(ctx, httpClient, tokenProvider, parsed.output),
    createHubUseCommand(ctx, httpClient, tokenProvider, parsed.output),
    createHubRemoveCommand(ctx, httpClient, tokenProvider, parsed.output),
    createHubSyncCommand(ctx, httpClient, tokenProvider, parsed.output),
    createSourceAddCommand(ctx, httpClient, tokenProvider, parsed.output),
    createSourceListCommand(ctx, httpClient, tokenProvider, parsed.output),
    createSourceRemoveCommand(ctx, httpClient, tokenProvider, parsed.output),
    createProfileListCommand(ctx, httpClient, tokenProvider, parsed.output),
    createProfileShowCommand(ctx, httpClient, tokenProvider, parsed.output),
    createProfileActivateCommand(ctx, httpClient, tokenProvider, parsed.output),
    createProfileDeactivateCommand(ctx, httpClient, tokenProvider, parsed.output),
    createProfileCurrentCommand(ctx, httpClient, tokenProvider, parsed.output)
  ];

  return runCli(argv, {
    ctx,
    commands,
    commandClasses,
    name: 'prompt-registry',
    version: readPackageVersion(),
    http: httpClient,
    tokens: tokenProvider
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
  let output: OutputFormat | undefined;
  let collectionFile: string | undefined;
  let version: string | undefined;
  let outDir: string | undefined;
  let outFile: string | undefined;
  let repoSlug: string | undefined;
  let changedPath: string | undefined;
  let markdown: string | undefined;
  let markdownPath: string | undefined;
  let skillName: string | undefined;
  let description: string | undefined;
  let skillsDir: string | undefined;
  let verbose = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '-o':
      case '--output': {
        output = argv[i + 1] as OutputFormat;
        i += 1;

        break;
      }
      case '--collection-file': {
        collectionFile = argv[i + 1];
        i += 1;

        break;
      }
      case '--version': {
        version = argv[i + 1];
        i += 1;

        break;
      }
      case '--out-dir': {
        outDir = argv[i + 1];
        i += 1;

        break;
      }
      case '--out':
      case '--out-file': {
        outFile = argv[i + 1];
        i += 1;

        break;
      }
      case '--repo-slug': {
        repoSlug = argv[i + 1];
        i += 1;

        break;
      }
      case '--changed-path': {
        changedPath = argv[i + 1];
        i += 1;

        break;
      }
      case '--markdown': {
        markdown = argv[i + 1];
        i += 1;

        break;
      }
      case '--markdown-path': {
        markdownPath = argv[i + 1];
        i += 1;

        break;
      }
      case '--skill-name': {
        skillName = argv[i + 1];
        i += 1;

        break;
      }
      case '--description': {
        description = argv[i + 1];
        i += 1;

        break;
      }
      case '--skills-dir': {
        skillsDir = argv[i + 1];
        i += 1;

        break;
      }
      case '-v':
      case '--verbose': {
        verbose = true;

        break;
      }
      default: { if (!arg.startsWith('-')) {
        positional.push(arg);
      }
      }
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
 * permitted (spec §14.2 invariant #3). ESLint rule from Phase 2
 * iter 9 enforces this for every other file under src/cli/.
 */

if (require.main === module) {
  main(process.argv.slice(2))
    // eslint-disable-next-line unicorn/no-process-exit -- CLI entry point
    .then((code) => process.exit(code))
    .catch((err) => {
      // eslint-disable-next-line no-console -- CLI entry point
      console.error(err);
      // eslint-disable-next-line unicorn/no-process-exit -- CLI entry point
      process.exit(1);
    });
}

/**
 * Legacy entry point for bin scripts.
 * @deprecated Use main() directly.
 */
export const mainWithArgv = main;

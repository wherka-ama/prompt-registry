/**
 * CLI composition root.
 *
 * This file:
 * - Creates production Context (FileSystem, HttpClient, Clock, TokenProvider)
 * - Registers all CLI commands
 * - Dispatches via clipanion
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
  BundleBuildCommand,
} from './commands/bundle-build';
import {
  BundleManifestCommand,
} from './commands/bundle-manifest';
import {
  CollectionAffectedCommand,
} from './commands/collection-affected';
import {
  CollectionListCommand,
} from './commands/collection-list';
import {
  CollectionValidateCommand,
} from './commands/collection-validate';
import {
  ConfigGetCommand,
} from './commands/config-get';
import {
  DoctorCommand,
} from './commands/doctor';
import {
  ExplainCommand,
} from './commands/explain';
import {
  HubAddCommand,
  HubListCommand,
  HubRemoveCommand,
  HubSyncCommand,
  HubUseCommand,
} from './commands/hub';
import {
  IndexBenchCommand,
} from './commands/index-bench';
import {
  IndexBuildCommand,
} from './commands/index-build';
import {
  IndexEvalCommand,
} from './commands/index-eval';
import {
  IndexExportCommand,
} from './commands/index-export';
import {
  IndexHarvestCommand,
} from './commands/index-harvest';
import {
  IndexReportCommand,
} from './commands/index-report';
import {
  IndexSearchCommand,
} from './commands/index-search';
import {
  IndexShortlistAddCommand,
  IndexShortlistListCommand,
  IndexShortlistNewCommand,
  IndexShortlistRemoveCommand,
} from './commands/index-shortlist';
import {
  IndexStatsCommand,
} from './commands/index-stats';
import {
  InitCommand,
} from './commands/init';
import {
  InstallCommand,
} from './commands/install';
import {
  PluginsListCommand,
} from './commands/plugins-list';
import {
  ProfileActivateCommand,
  ProfileCreateCommand,
  ProfileCurrentCommand,
  ProfileDeactivateCommand,
  ProfileEditCommand,
  ProfileListCommand,
  ProfileShowCommand,
} from './commands/profile';
import {
  SkillNewCommand,
} from './commands/skill-new';
import {
  SkillValidateCommand,
} from './commands/skill-validate';
import {
  SourceAddCommand,
  SourceListCommand,
  SourceRemoveCommand,
} from './commands/source';
import {
  StatusCommand,
} from './commands/status';
import {
  TargetAddCommand,
} from './commands/target-add';
import {
  TargetListCommand,
} from './commands/target-list';
import {
  TargetRemoveCommand,
} from './commands/target-remove';
import {
  UninstallCommand,
} from './commands/uninstall';
import {
  VersionComputeCommand,
} from './commands/version-compute';
import {
  createProductionContext,
} from './framework';
import type {
  CommandDefinition,
} from './framework/cli';
import {
  runCli,
} from './framework/cli';
import type {
  OutputFormat,
} from './framework/output';

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

  const commands: CommandDefinition[] = [];

  const commandClasses = [
    ExplainCommand,
    DoctorCommand,
    PluginsListCommand,
    VersionComputeCommand,
    ConfigGetCommand,
    TargetAddCommand,
    TargetListCommand,
    TargetRemoveCommand,
    BundleBuildCommand,
    BundleManifestCommand,
    CollectionAffectedCommand,
    CollectionListCommand,
    CollectionValidateCommand,
    SkillNewCommand,
    SkillValidateCommand,
    IndexSearchCommand,
    IndexStatsCommand,
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
    HubListCommand,
    HubAddCommand,
    HubUseCommand,
    HubRemoveCommand,
    HubSyncCommand,
    SourceAddCommand,
    SourceListCommand,
    SourceRemoveCommand,
    ProfileListCommand,
    ProfileShowCommand,
    ProfileActivateCommand,
    ProfileDeactivateCommand,
    ProfileCurrentCommand,
    ProfileCreateCommand,
    ProfileEditCommand,
    InstallCommand,
    UninstallCommand,
    InitCommand,
    StatusCommand
  ];

  return runCli(argv, {
    ctx,
    commands,
    commandClasses,
    name: 'prompt-registry',
    version: CLI_VERSION_CONST,
    http: httpClient,
    tokens: tokenProvider,
    defaultOutput: parsed.output
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

// Build-time version injection for bundled/SEA distributions.
// Falls back to reading package.json for development builds.
declare const CLI_VERSION: string | undefined;
// NOSONAR typescript:S7741 — typeof is required here: CLI_VERSION is a declare const injected
// by the bundler and may not exist in dev builds; a direct comparison would throw ReferenceError.
export const CLI_VERSION_CONST = typeof CLI_VERSION === 'undefined' ? readPackageVersion() : CLI_VERSION;

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

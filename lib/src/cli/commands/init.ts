/**
 * `prompt-registry init` — zero-friction project bootstrap.
 *
 * Creates a target and optionally imports a hub in a single step,
 * replacing the 6-command manual sequence a new user previously needed.
 *
 * Interactive wizard mode: prompts for IDE, target, and hub connection.
 * Non-interactive mode: accepts flags for all values so it works well in CI.
 *
 * Usage:
 *   prompt-registry init
 *   prompt-registry init --target-name copilot --target-type copilot-cli --hub owner/repo --yes
 */
import * as path from 'node:path';
import inquirer from 'inquirer';
import {
  HubManager,
  resolveUserConfigPaths,
} from '../../app/registry';
import {
  TARGET_TYPES,
  type TargetType,
} from '../../domain/install';
import {
  envTokenProvider,
  type TokenProvider,
} from '../../infra/github/token';
import {
  NodeHttpClient,
} from '../../infra/http/node-http-client';
import {
  CompositeHubResolver,
  GitHubHubResolver,
  LocalHubResolver,
  UrlHubResolver,
} from '../../infra/resolvers/hub-resolver';
import {
  ActiveHubStore,
} from '../../infra/stores/active-hub-store';
import {
  addTarget,
} from '../../infra/stores/target-store';
import {
  HubStore,
} from '../../infra/stores/yaml-hub-store';
import type {
  HttpClient,
} from '../../ports/http';
import {
  Command,
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  Option,
  type OutputFormat,
  RegistryError,
  renderError,
} from '../framework';

const DEFAULT_TARGET_NAME = 'copilot';
const DEFAULT_TARGET_TYPE: TargetType = 'copilot-cli';

/** Options for the init command (programmatic API + test seam). */
export interface InitOptions {
  output?: OutputFormat;
  /** Target name (default: 'copilot'). */
  targetName?: string;
  /** Target type (default: 'copilot-cli'). */
  targetType?: string;
  /** Hub location ref (e.g. owner/repo or file:./hub-config.yml). */
  hub?: string;
  /** Hub type override (default: auto-detect from ref). */
  hubType?: 'github' | 'local' | 'url';
  /** Skip confirmation prompt. */
  yes?: boolean;
  /** HTTP client seam for testing. */
  http?: HttpClient;
  /** Token provider seam for testing. */
  tokens?: TokenProvider;
}

/**
 * Build the `init` command (defineCommand variant for test compatibility).
 * @param opts Command options.
 * @returns CommandDefinition.
 */
export const createInitCommand = (
  opts: InitOptions = {}
): CommandDefinition =>
  defineCommand({
    path: ['init'],
    description: 'Bootstrap a project: add a target and optionally import a hub.',
    category: 'Project',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      return runInit(ctx, opts);
    }
  });

/**
 * Init command class (clipanion variant).
 */
export class InitCommand extends Command {
  public static readonly paths = [['init']];
  // eslint-disable-next-line new-cap -- Command.Usage is a static method, not a constructor
  public static readonly usage = Command.Usage({
    description: 'Bootstrap a project: add a target and optionally import a hub.',
    category: 'Project',
    details: `
      Usage: prompt-registry init [options]

      Creates a target in prompt-registry.yml and optionally imports a hub,
      replacing the manual multi-step setup sequence.

      Examples:
        prompt-registry init
        prompt-registry init --target-name my-copilot --target-type copilot-cli --yes
        prompt-registry init --hub owner/repo --yes
        prompt-registry init --hub file:./hub-config.yml --hub-type local --yes
    `
  });

  public targetName = Option.String('--target-name');
  public targetType = Option.String('--target-type');
  public hub = Option.String('--hub');
  public hubType = Option.String('--hub-type');
  public yes = Option.Boolean('--yes');
  public output = Option.String('-o,--output');
  public commandContext!: { ctx: Context; http?: HttpClient; tokens?: TokenProvider };

  public async execute(): Promise<number> {
    const { ctx, http, tokens } = this.commandContext;
    return runInit(ctx, {
      output: (this.output ?? 'text') as OutputFormat,
      targetName: this.targetName,
      targetType: this.targetType,
      hub: this.hub,
      hubType: this.hubType as 'github' | 'local' | 'url' | undefined,
      yes: this.yes,
      http,
      tokens
    });
  }
}

/**
 * Core init logic shared by both command variants.
 * @param ctx CLI context.
 * @param opts Init options.
 * @returns Exit code.
 */
async function runInit(ctx: Context, opts: InitOptions): Promise<number> {
  const fmt = opts.output ?? 'text';
  const isInteractive = !opts.yes && process.stdout.isTTY;

  let targetName = opts.targetName ?? DEFAULT_TARGET_NAME;
  let targetType = (opts.targetType ?? DEFAULT_TARGET_TYPE) as TargetType;
  let hubRef = opts.hub;

  // Interactive wizard mode
  if (isInteractive) {
    interface WizardAnswers {
      ide: string;
      connectHub: boolean;
      hubChoice?: string;
      hubPath?: string;
    }

    const answers = await inquirer.prompt<WizardAnswers>([
      {
        type: 'list',
        name: 'ide',
        message: 'What IDE are you using?',
        choices: [
          { name: 'GitHub Copilot CLI (user scope)', value: 'copilot-cli' },
          { name: 'GitHub Copilot (workspace scope)', value: 'copilot-ws' },
          { name: 'Cursor', value: 'cursor' },
          { name: 'Kiro', value: 'kiro' }
        ],
        default: 'copilot-cli'
      },
      {
        type: 'confirm',
        name: 'connectHub',
        message: 'Connect to a hub? (recommended)',
        default: true
      },
      {
        type: 'list',
        name: 'hubChoice',
        message: 'Select hub:',
        choices: [
          { name: 'Amadeus Hub (default)', value: 'amadeus' },
          { name: 'Local directory', value: 'local' },
          { name: 'Skip for now', value: 'skip' }
        ],
        default: 'amadeus',
        when: (a: { connectHub: boolean }) => a.connectHub
      },
      {
        type: 'input',
        name: 'hubPath',
        message: 'Enter local hub path:',
        default: './hub-config.yml',
        when: (a: { hubChoice: string }) => a.hubChoice === 'local'
      }
    ]);

    targetType = answers.ide as TargetType;
    targetName = DEFAULT_TARGET_NAME;

    if (answers.hubChoice === 'amadeus') {
      hubRef = 'amadeus';
    } else if (answers.hubChoice === 'local' && answers.hubPath) {
      hubRef = `file:${answers.hubPath}`;
    } else {
      hubRef = undefined;
    }
  }

  if (!TARGET_TYPES.includes(targetType)) {
    return failWith(ctx, fmt, new RegistryError({
      code: 'USAGE.MISSING_FLAG',
      message: `init: unknown --target-type "${targetType}"`,
      hint: `Known types: ${[...TARGET_TYPES].toSorted((a, b) => a.localeCompare(b)).join(', ')}`
    }));
  }

  try {
    // Step 1: add target
    const result = await addTarget(
      { cwd: ctx.cwd(), fs: ctx.fs },
      { name: targetName, type: targetType, scope: 'user' }
    );

    const steps: string[] = [
      `target "${targetName}" (${targetType}) → ${result.file}`
    ];

    // Step 2: optionally import + sync hub
    let hubId: string | null = null;
    if (hubRef !== undefined && hubRef.length > 0) {
      const mgr = buildHubManager(ctx, opts.http, opts.tokens);
      const refType = opts.hubType ?? inferHubType(hubRef);
      const location = refType === 'local' && !path.isAbsolute(hubRef)
        ? path.resolve(ctx.cwd(), hubRef)
        : hubRef;

      hubId = await mgr.importHub({ type: refType, location });
      await mgr.syncHub(hubId);
      steps.push(`hub "${hubId}" imported and synced`);
    }

    const data = {
      target: { name: targetName, type: targetType, file: result.file, created: result.created },
      hub: hubId === null ? null : { id: hubId },
      steps
    };

    formatOutput({
      ctx,
      command: 'init',
      output: fmt,
      status: 'ok',
      data,
      textRenderer: (d) => {
        const lines = ['Initialized prompt-registry project:\n'];
        for (const step of d.steps) {
          lines.push(`  ✓ ${step}\n`);
        }
        if (d.hub === null) {
          lines.push(
            '\nNext steps:\n',
            '  1. prompt-registry hub add <owner/repo> --yes\n',
            '  2. prompt-registry profile activate <profileId>\n'
          );
        } else {
          lines.push('\nNext step:\n', '  prompt-registry profile activate <profileId>\n');
        }
        return lines.join('');
      }
    });
    return 0;
  } catch (cause) {
    if (cause instanceof RegistryError) {
      return failWith(ctx, fmt, cause);
    }
    return failWith(ctx, fmt, new RegistryError({
      code: 'INTERNAL.UNEXPECTED',
      message: cause instanceof Error ? cause.message : String(cause),
      cause: cause instanceof Error ? cause : undefined
    }));
  }
}

/**
 * Infer hub reference type from the location string.
 * - Starts with `file:` or is an absolute path → local
 * - Starts with `http` → url
 * - Otherwise → github (owner/repo)
 * @param location Hub reference string.
 * @returns Inferred reference type.
 */
function inferHubType(location: string): 'github' | 'local' | 'url' {
  if (location.startsWith('file:') || path.isAbsolute(location)) {
    return 'local';
  }
  if (location.startsWith('http://') || location.startsWith('https://')) {
    return 'url';
  }
  return 'github';
}

/**
 * Build HubManager with the given seams.
 * @param ctx CLI context.
 * @param http HTTP client seam.
 * @param tokens Token provider seam.
 * @returns HubManager instance.
 */
function buildHubManager(ctx: Context, http?: HttpClient, tokens?: TokenProvider): HubManager {
  const paths = resolveUserConfigPaths(ctx.env);
  const httpClient = http ?? new NodeHttpClient();
  const tokenProvider = tokens ?? envTokenProvider(ctx.env);
  const resolver = new CompositeHubResolver(
    new GitHubHubResolver(httpClient, tokenProvider),
    new LocalHubResolver(ctx.fs),
    new UrlHubResolver(httpClient, tokenProvider)
  );
  return new HubManager(
    new HubStore(paths.hubs, ctx.fs),
    new ActiveHubStore(paths.activeHub, ctx.fs),
    resolver
  );
}

/**
 * Emit error in appropriate format.
 * @param ctx CLI context.
 * @param output Output format.
 * @param err Registry error.
 * @returns Exit code 1.
 */
function failWith(ctx: Context, output: OutputFormat, err: RegistryError): number {
  if (output === 'json' || output === 'yaml' || output === 'ndjson') {
    formatOutput({
      ctx,
      command: 'init',
      output,
      status: 'error',
      data: null,
      errors: [err.toJSON()]
    });
  } else {
    renderError(err, ctx);
  }
  return 1;
}

/**
 * Phase 2 / Iter 8 — `doctor` subcommand.
 *
 * `prompt-registry doctor` performs a self-check and reports findings
 * via the iter-5 formatter. It exercises every framework slice:
 * Context (fs / env / cwd), formatOutput, and (on failure) RegistryError.
 *
 * Iter-8 scope: report Node version, cwd accessibility, and presence of
 * the framework's required env vars. Phase 3+ will add domain-specific
 * checks (index path writable, hub reachability, etc.) as those
 * components materialize.
 *
 * This is also the *first leaf command* — the canary for the
 * "leaf commands never import clipanion / node:fs / process directly"
 * invariant from spec §14.2. The implementation only imports from the
 * framework barrel.
 *
 * NOTE: Option support (--output) is a Phase 3 feature. For Phase 2
 * testing, the output format is set via the factory parameter.
 */
import {
  envTokenProvider,
} from '../../install/http';
import {
  NodeHttpClient,
} from '../../install/node-http-client';
import {
  findProjectConfigPath,
  readTargets,
} from '../../install/target-store';
import {
  ActiveHubStore,
  HubStore,
  resolveUserConfigPaths,
} from '../../registry-config';
import {
  type CommandDefinition,
  type Context,
  defineCommand,
  formatOutput,
  type OutputFormat,
} from '../framework';

interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

interface DoctorResult {
  checks: DoctorCheck[];
  summary: { ok: number; warn: number; fail: number };
}

/**
 * Build the `doctor` command. Caller controls the output format so the
 * same handler runs under text mode for humans and JSON mode for CI.
 * @param opts - Command options
 * @param opts.output - Output format to use (default 'text').
 * @returns CommandDefinition wired to the framework adapter.
 */
export const createDoctorCommand = (opts: { output?: OutputFormat } = {}): CommandDefinition =>
  defineCommand({
    path: ['doctor'],
    description: 'Run environment self-checks and print a health report.',
    run: async ({ ctx }: { ctx: Context }): Promise<number> => {
      const result = await runDoctorChecks(ctx);
      const status = result.summary.fail > 0
        ? 'error'
        : (result.summary.warn > 0 ? 'warning' : 'ok');
      formatOutput({
        ctx,
        command: 'doctor',
        output: opts.output ?? 'text',
        status,
        data: result,
        textRenderer: renderDoctorText
      });
      return result.summary.fail > 0 ? 1 : 0;
    }
  });

/**
 * Execute every check and aggregate the result.
 * @param ctx Application Context — fs/env/cwd accessed only via this.
 * @returns Aggregated `DoctorResult` (every check is reported regardless of pass/fail).
 */
const runDoctorChecks = async (ctx: Context): Promise<DoctorResult> => {
  const checks: DoctorCheck[] = [
    checkNodeVersion(ctx),
    await checkCwdReadable(ctx),
    checkPathEnvVar(ctx),
    await checkProjectConfig(ctx),
    await checkTargets(ctx),
    // I-008: surface CLI-level state that affects most commands.
    await checkXdgConfig(ctx),
    await checkGitHubAuth(ctx),
    await checkActiveHub(ctx),
    await checkApiReachable(ctx)
  ];
  const summary = checks.reduce(
    (acc, c) => {
      acc[c.status] += 1;
      return acc;
    },
    { ok: 0, warn: 0, fail: 0 }
  );
  return { checks, summary };
};

const checkNodeVersion = (ctx: Context): DoctorCheck => {
  const v = ctx.env.NODE_VERSION ?? extractRuntimeNodeVersion();
  const major = Number.parseInt(v.replace(/^v/, '').split('.')[0] ?? '0', 10);
  if (Number.isFinite(major) && major >= 20) {
    return { name: 'node-version', status: 'ok', detail: `Node ${v} satisfies >=20.` };
  }
  return {
    name: 'node-version',
    status: 'fail',
    detail: `Node ${v} < required minimum 20. See engines.node in package.json.`
  };
};

const extractRuntimeNodeVersion = (): string => {
  // Read process.version once — this is the only allowed touch in
  // command code because there is no cleaner Context surface for the
  // runtime version. Phase 5 may add `ctx.runtime` if we add more
  // checks like this.
  return process.version;
};

const checkCwdReadable = async (ctx: Context): Promise<DoctorCheck> => {
  try {
    const cwd = ctx.cwd();
    const ok = await ctx.fs.exists(cwd);
    if (!ok) {
      return {
        name: 'cwd-accessible',
        status: 'fail',
        detail: `Working directory ${cwd} does not exist or is not accessible.`
      };
    }
    return { name: 'cwd-accessible', status: 'ok', detail: `Working directory ${cwd} accessible.` };
  } catch (err) {
    return {
      name: 'cwd-accessible',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err)
    };
  }
};

// Phase 5 / Iter 31: install-related checks.
const checkProjectConfig = async (ctx: Context): Promise<DoctorCheck> => {
  try {
    const { file, exists } = await findProjectConfigPath({ cwd: ctx.cwd(), fs: ctx.fs });
    if (!exists) {
      return {
        name: 'project-config',
        status: 'warn',
        detail: `No prompt-registry.yml found from ${ctx.cwd()} upward. Run \`prompt-registry target add ...\` to create one.`
      };
    }
    return {
      name: 'project-config',
      status: 'ok',
      detail: `Project config: ${file}`
    };
  } catch (err) {
    return {
      name: 'project-config',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err)
    };
  }
};

const checkTargets = async (ctx: Context): Promise<DoctorCheck> => {
  try {
    const targets = await readTargets({ cwd: ctx.cwd(), fs: ctx.fs });
    if (targets.length === 0) {
      return {
        name: 'install-targets',
        status: 'warn',
        detail: 'No install targets configured. Add one with `prompt-registry target add <name> --type <kind>`.'
      };
    }
    return {
      name: 'install-targets',
      status: 'ok',
      detail: `${targets.length} target${targets.length === 1 ? '' : 's'}: ${targets.map((t) => `${t.name}(${t.type})`).join(', ')}`
    };
  } catch (err) {
    return {
      name: 'install-targets',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err)
    };
  }
};

const checkPathEnvVar = (ctx: Context): DoctorCheck => {
  const p = ctx.env.PATH ?? '';
  if (p.length === 0) {
    return {
      name: 'path-env',
      status: 'warn',
      detail: 'PATH env var is empty; subprocess plugins (PATH-binary discovery) will not work.'
    };
  }
  return { name: 'path-env', status: 'ok', detail: `PATH has ${p.split(':').length} entries.` };
};

// I-008: XDG / hub / token / network checks.

const checkXdgConfig = async (ctx: Context): Promise<DoctorCheck> => {
  try {
    const paths = resolveUserConfigPaths(ctx.env);
    const exists = await ctx.fs.exists(paths.root);
    if (!exists) {
      return {
        name: 'xdg-config',
        status: 'warn',
        detail: `User config dir ${paths.root} does not exist yet (will be created on first hub add).`
      };
    }
    return {
      name: 'xdg-config',
      status: 'ok',
      detail: `User config: ${paths.root}`
    };
  } catch (err) {
    return {
      name: 'xdg-config',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err)
    };
  }
};

const checkActiveHub = async (ctx: Context): Promise<DoctorCheck> => {
  try {
    const paths = resolveUserConfigPaths(ctx.env);
    const exists = await ctx.fs.exists(paths.root);
    if (!exists) {
      return { name: 'active-hub', status: 'warn', detail: 'No user config yet — no active hub.' };
    }
    const active = new ActiveHubStore(paths.activeHub, ctx.fs);
    const id = await active.get();
    if (id === null) {
      return { name: 'active-hub', status: 'warn', detail: 'No active hub. Run `hub use <id>`.' };
    }
    const store = new HubStore(paths.hubs, ctx.fs);
    if (!(await store.has(id))) {
      return {
        name: 'active-hub',
        status: 'fail',
        detail: `Active hub "${id}" pointer is stale (config missing).`
      };
    }
    return { name: 'active-hub', status: 'ok', detail: `Active hub: ${id}` };
  } catch (err) {
    return {
      name: 'active-hub',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err)
    };
  }
};

const checkGitHubAuth = async (ctx: Context): Promise<DoctorCheck> => {
  try {
    const provider = envTokenProvider(ctx.env);
    const token = await provider.getToken('api.github.com');
    if (token === null || token.length === 0) {
      return {
        name: 'github-auth',
        status: 'warn',
        detail: 'No GitHub token resolvable. Set GITHUB_TOKEN/GH_TOKEN or run `gh auth login`. '
          + 'Public hubs work without auth (60 req/hour rate limit).'
      };
    }
    // Never echo the token; just confirm length.
    return {
      name: 'github-auth',
      status: 'ok',
      detail: `GitHub token resolved (${token.length} chars). Token is never logged.`
    };
  } catch (err) {
    return {
      name: 'github-auth',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err)
    };
  }
};

const checkApiReachable = async (ctx: Context): Promise<DoctorCheck> => {
  // Use the lib's own HTTP client (so we test the same path users hit).
  // Skip when running offline tests by setting PROMPT_REGISTRY_SKIP_NETWORK=1.
  if (ctx.env.PROMPT_REGISTRY_SKIP_NETWORK === '1') {
    return {
      name: 'github-api',
      status: 'warn',
      detail: 'Skipped (PROMPT_REGISTRY_SKIP_NETWORK=1).'
    };
  }
  try {
    const http = new NodeHttpClient();
    const provider = envTokenProvider(ctx.env);
    const token = await provider.getToken('api.github.com');
    const headers: Record<string, string> = {};
    if (token !== null && token.length > 0) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await http.fetch({ url: 'https://api.github.com/rate_limit', headers });
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return { name: 'github-api', status: 'ok', detail: 'api.github.com reachable.' };
    }
    return {
      name: 'github-api',
      status: 'warn',
      detail: `api.github.com returned ${String(res.statusCode)}.`
    };
  } catch (err) {
    return {
      name: 'github-api',
      status: 'warn',
      detail: `api.github.com unreachable: ${err instanceof Error ? err.message : String(err)}`
    };
  }
};

const STATUS_GLYPHS: Record<DoctorCheck['status'], string> = {
  ok: '[ OK ]',
  warn: '[WARN]',
  fail: '[FAIL]'
};

const renderDoctorText = (result: DoctorResult): string => {
  const lines: string[] = ['prompt-registry doctor'];
  for (const c of result.checks) {
    lines.push(`  ${STATUS_GLYPHS[c.status]} ${c.name}: ${c.detail}`);
  }
  lines.push(
    '',
    `summary: ${result.summary.ok} ok / ${result.summary.warn} warn / ${result.summary.fail} fail`
  );
  return `${lines.join('\n')}\n`;
};

/**
 * Phase 2 / Iter 7 — Golden-test runner.
 *
 * `runCommand(argv, opts)` is a thin convenience wrapper around iter-3's
 * `runCli` + iter-1's `createTestContext`. It builds an ephemeral test
 * Context, runs the dispatcher, and returns `{ exitCode, stdout, stderr }`
 * — exactly the three values almost every end-to-end test needs.
 *
 * Why a separate helper?
 *   1. Golden-style tests routinely need all three captured streams plus
 *      the exit code; doing the createTestContext/runCli/captured triple
 *      by hand for every assertion is repetitive.
 *   2. Centralizing the test entry point gives Phase 4's command
 *      extractions a single place to evolve (e.g., adding a `clock`
 *      override or pre-seeding fs/env without touching every test).
 *
 * What this is NOT:
 *   - A snapshot harness. Snapshot diffing belongs in tests proper
 *     (mocha + a JSON.stringify diff is sufficient for now).
 *   - A clipanion runner. The framework adapter (`runCli`) handles all
 *     dispatch; this helper only composes.
 */
import type {
  CommandDefinition,
} from './cli';
import {
  runCli,
} from './cli';
import type {
  TestContextOptions,
} from './test-context';
import {
  createTestContext,
} from './test-context';

export interface RunCommandOptions {
  /** Commands available for dispatch (passed to `runCli`). */
  commands: CommandDefinition[];
  /** Binary name reported in usage / version output. Default: `prompt-registry`. */
  name?: string;
  /** Binary version reported by --version. Default: `0.0.0-test`. */
  version?: string;
  /** Test-Context overrides (env, cwd, etc.). */
  context?: TestContextOptions;
}

export interface RunCommandResult {
  /** Exit code returned by the dispatcher. */
  exitCode: number;
  /** Captured stdout content. */
  stdout: string;
  /** Captured stderr content. */
  stderr: string;
}

/**
 * Run a command end-to-end through the framework adapter.
 * @param argv Argument vector to dispatch (`['hello']`, `['index', 'search']`, etc.).
 * @param opts Commands to register, optional binary metadata, and optional Context overrides.
 * @returns `{ exitCode, stdout, stderr }` — captured outcome.
 */
export const runCommand = async (
  argv: string[],
  opts: RunCommandOptions
): Promise<RunCommandResult> => {
  const ctx = createTestContext(opts.context);
  const exitCode = await runCli(argv, {
    ctx,
    name: opts.name ?? 'prompt-registry',
    version: opts.version ?? '0.0.0-test',
    commands: opts.commands
  });
  return {
    exitCode,
    stdout: ctx.stdout.captured(),
    stderr: ctx.stderr.captured()
  };
};

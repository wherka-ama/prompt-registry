/**
 * Phase 2 / Iter 3 — Framework adapter (clipanion wrapping).
 *
 * Spec §14.2 invariant #2 — only this folder is allowed to import
 * clipanion. Leaf command code uses `defineCommand` and `runCli` from
 * the public barrel; clipanion details never leak.
 *
 * Adapter contract
 *   defineCommand({ path, description, run }) — declarative definition
 *   runCli(argv, opts) — dispatch argv against registered commands and
 *                       return an exit code (never throws on usage errors)
 *
 * Exit-code policy
 *   command return value -> propagated as-is
 *   unknown command      -> 64 (EX_USAGE per spec §9.2)
 *   thrown error         -> 70 (EX_SOFTWARE per spec §9.2)
 *   --version / --help   -> 0
 */
import {
  Builtins,
  Cli,
  Command,
  UsageError,
} from 'clipanion';
import type {
  CommandClass,
} from 'clipanion';
import type {
  Context,
} from './context';

/**
 * Public command shape returned by `defineCommand`. Pure data plus a run
 * handler — no clipanion type leaks.
 */
export interface CommandDefinition {
  /** Noun-verb path tuple, e.g. `['index', 'search']`. */
  path: string[];
  /** One-line description shown in --help listings. */
  description: string;
  /** Handler invoked when the command is dispatched. */
  run: (args: { ctx: Context }) => number | Promise<number>;
}

/**
 * Options accepted by `runCli`.
 */
export interface RunCliOptions {
  /** Application Context (production or test). */
  ctx: Context;
  /** Registered commands. */
  commands: CommandDefinition[];
  /** Binary name used in usage output. */
  name: string;
  /** Binary version reported by --version. */
  version: string;
}

/**
 * Define a command declaratively.
 * @param def Command definition (path / description / run).
 * @returns The same definition object, frozen.
 */
export const defineCommand = (def: CommandDefinition): CommandDefinition =>
  Object.freeze({ ...def });

/**
 * Adapt an `OutputStream` to the duck-typed `Writable` shape clipanion
 * expects. Only `.write()` is invoked by clipanion's runtime for normal
 * paths; we forward to our captured sink. `.end()` and other Writable
 * methods are no-ops — clipanion does not require them for `cli.run`.
 * @param out
 * @param out.write
 */
const adaptWritable = (out: { write: (chunk: string) => void }): NodeJS.WriteStream => {
  const stream = {
    write: (chunk: string | Uint8Array): boolean => {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      out.write(text);
      return true;
    },
    end: (): void => undefined
  };
  // Cast to clipanion's expected type. Clipanion's BaseContext narrows
  // the type but only calls .write/.end at runtime, so this duck-type
  // is sufficient.
  return stream as unknown as NodeJS.WriteStream;
};

const adaptReadable = (): NodeJS.ReadStream => {
  const stream = {
    read: (): null => null
  };
  return stream as unknown as NodeJS.ReadStream;
};

/**
 * Build a dynamic clipanion Command class that closes over our run
 * handler and our `Context`. `execute()` returns the exit code so
 * clipanion can propagate it unchanged.
 * @param def
 * @param ctx
 */
const toClipanionCommandClass = (
  def: CommandDefinition,
  ctx: Context
): CommandClass => {
  class DynamicCommand extends Command {
    public static paths: string[][] = [def.path];
    // eslint-disable-next-line new-cap, @typescript-eslint/explicit-member-accessibility -- clipanion's static factory uses PascalCase by convention; we mirror its API.
    static usage = Command.Usage({ description: def.description });

    public async execute(): Promise<number> {
      return def.run({ ctx });
    }
  }
  return DynamicCommand;
};

/**
 * Dispatch an argv vector against the registered commands.
 * @param argv  Argument vector — typically `process.argv.slice(2)` in
 *              production, or a literal array in tests.
 * @param opts  ctx / commands / name / version.
 * @returns Exit code (0 success, 64 usage, 70 internal, or whatever
 *          the command handler returned).
 */
export const runCli = async (argv: string[], opts: RunCliOptions): Promise<number> => {
  const cli = new Cli({
    binaryName: opts.name,
    binaryVersion: opts.version,
    enableColors: false
  });

  // Built-in --help and --version commands.
  cli.register(Builtins.HelpCommand);
  cli.register(Builtins.VersionCommand);

  for (const def of opts.commands) {
    cli.register(toClipanionCommandClass(def, opts.ctx));
  }

  const clipanionCtx = {
    env: opts.ctx.env as Record<string, string | undefined>,
    stdin: adaptReadable(),
    stdout: adaptWritable(opts.ctx.stdout),
    stderr: adaptWritable(opts.ctx.stderr),
    colorDepth: 0
  };

  // We bypass clipanion's `cli.run` because (a) it always returns 0/1,
  // collapsing the EX_USAGE / EX_SOFTWARE distinction we need per
  // spec §9.2, and (b) it writes errors to stdout instead of stderr.
  // Instead we use `cli.process()` to parse argv into a Command, wire
  // up the bindings clipanion's run() would otherwise set, then call
  // validateAndExecute() ourselves with a try/catch around each phase.
  let command;
  try {
    command = cli.process({ input: argv, context: clipanionCtx });
  } catch (err) {
    // process() throws on unknown command, bad flags, missing arg, etc.
    // Per spec §9.2 that's EX_USAGE = 64.
    const message = err instanceof Error ? err.message : String(err);
    opts.ctx.stderr.write(`${message}\n`);
    return 64;
  }

  // Wire bindings the way clipanion's own cli.run() does — without
  // these, HelpCommand and VersionCommand crash because they read
  // `this.context` and `this.cli`. Mirroring the binding shape from
  // clipanion's lib/advanced/Cli.js#run().
  command.context = clipanionCtx;
  command.cli = {
    binaryLabel: opts.name,
    binaryName: opts.name,
    binaryVersion: opts.version,
    enableCapture: false,
    enableColors: false,
    definitions: () => cli.definitions(),
    definition: (c) => cli.definition(c),
    error: (e, o) => cli.error(e, o),
    format: (c) => cli.format(c),
    process: (input, subContext) => cli.process({
      input,
      context: { ...clipanionCtx, ...(subContext as object) }
    }),
    run: (input, subContext) => cli.run(input, { ...clipanionCtx, ...subContext }),
    usage: (c, o) => cli.usage(c, o)
  };

  // Per-command --help: clipanion sets `command.help = true` when -h/
  // --help follows a registered command path. Honour that by printing
  // the detailed usage and exiting 0 — same behavior cli.run provides.
  if ((command as { help?: boolean }).help === true) {
    opts.ctx.stdout.write(cli.usage(command, { detailed: true }));
    return 0;
  }

  try {
    const exitCode = await command.validateAndExecute();
    return exitCode ?? 0;
  } catch (err) {
    if (err instanceof UsageError) {
      opts.ctx.stderr.write(`${err.message}\n`);
      return 64;
    }
    // Any other thrown error is an internal bug — EX_SOFTWARE = 70.
    const message = err instanceof Error ? err.message : String(err);
    opts.ctx.stderr.write(`${message}\n`);
    return 70;
  }
};

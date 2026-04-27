/**
 * Phase 2 / Iter 1 — Public surface of the CLI framework.
 *
 * This barrel is the *only* import path command code (and tests) should use
 * to reach the framework. Spec §14.2 invariant #2 ("framework isolation")
 * requires that nothing outside `lib/src/cli/framework/` import clipanion
 * directly; the eslint rule in iter 9 enforces that. Keeping a single
 * entry point makes the rule easy to express and easy to audit.
 *
 * What ships in iter 1:
 *   - the `Context` interface and its sub-abstractions (Fs/Net/Clock/IO),
 *   - the in-memory `createTestContext()` factory used by golden tests.
 *
 * What lands later in Phase 2:
 *   - iter 2: production Context wiring (memfs/undici real wraps),
 *   - iter 3: framework adapter that wraps clipanion (createCli),
 *   - iter 4: layered config loader,
 *   - iter 5: output formatter (text / json envelope / yaml / ndjson),
 *   - iter 6: RegistryError class + renderer,
 *   - iter 7: golden-test runner runCommand(argv, ctx),
 *   - iter 8: root command (help, version, doctor stub, --explain stub),
 *   - iter 9: eslint rule banning direct node:fs / process.exit / etc.,
 *   - iter 10: end-to-end smoke test wiring everything together.
 */
export type {
  CapturedOutputStream,
  ClockAbstraction,
  Context,
  FsAbstraction,
  InputStream,
  NetAbstraction,
  NetRequestInit,
  NetResponse,
  OutputStream,
  TestClock,
} from './context';
export type {
  TestContext,
  TestContextOptions,
} from './test-context';
export {
  createTestContext,
  isTestContext,
} from './test-context';
export {
  createProductionContext,
} from './production-context';
export type {
  CommandDefinition,
  RunCliOptions,
} from './cli';
export {
  defineCommand,
  runCli,
} from './cli';
export type {
  Config,
  ConfigFs,
  LoadConfigOptions,
} from './config';
export {
  loadConfig,
} from './config';
export type {
  FormatOutputOptions,
  OutputError,
  OutputFormat,
  OutputStatus,
} from './output';
export {
  formatOutput,
} from './output';
export type {
  RegistryErrorNamespace,
  RegistryErrorOptions,
} from './error';
export {
  RegistryError,
  isRegistryError,
  renderError,
} from './error';
export type {
  RunCommandOptions,
  RunCommandResult,
} from './golden';
export {
  runCommand,
} from './golden';

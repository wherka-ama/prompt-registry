/**
 * Phase 2 / Iter 1 — Context interface skeleton.
 *
 * The `Context` object is the single seam through which every prompt-registry
 * subcommand performs IO. Spec §11.2 calls this "Context-only IO" and
 * §14.2 invariant #3 makes it ESLint-enforced (rule lands in iter 9).
 *
 * Shape captured here is the smallest contract that lets us:
 *   - run commands in unit tests with captured stdout/stderr,
 *   - inject a fake clock for cache/retry/timestamp determinism,
 *   - inject a fake filesystem in iter 2 (memfs),
 *   - inject a fake network in iter 2 (undici MockAgent),
 *   - record the requested exit code without terminating the process.
 *
 * This file deliberately holds *only* type definitions plus the abstraction
 * sub-interfaces (Fs, Net, Clock). Concrete production implementations of
 * those sub-interfaces are written in iter 2 (production-context.ts) and
 * the in-memory test factory lives in test-context.ts.
 *
 * Why this layout:
 *   - keeping interfaces in one file gives a stable surface to import from
 *     anywhere in `lib/src/cli/framework/` without circular imports;
 *   - command code only ever imports the interface, not the implementation,
 *     so the eslint rule in iter 9 can ban concrete imports;
 *   - the same shape is used in both production and tests, ruling out
 *     drift between what we test and what ships.
 */

/**
 * Filesystem abstraction — eight operations cover every read/write pattern
 * found in the existing 11 binaries (per spec §11.2 inventory). Concrete
 * implementations land in iter 2; iter 1 only nails down the shape.
 */
export interface FsAbstraction {
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  readJson<T = unknown>(path: string): Promise<T>;
  writeJson(path: string, value: unknown): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  readDir(path: string): Promise<string[]>;
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
}

/**
 * Network abstraction — single fetch-like call returning a streaming body.
 * Iter 2 wraps undici; tests use undici's MockAgent (same library in prod
 * and test, no global mutation, no nock).
 */
export interface NetAbstraction {
  fetch(url: string, init?: NetRequestInit): Promise<NetResponse>;
}

export interface NetRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export interface NetResponse {
  status: number;
  headers: Record<string, string>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  bytes(): Promise<Uint8Array>;
}

/**
 * Clock abstraction — `now()` returns epoch milliseconds. Iter 2 wraps
 * `Date.now()`; the test factory in this iter offers a manual `advance()`
 * lever so we can pin the clock and step it forward deterministically.
 */
export interface ClockAbstraction {
  now(): number;
}

/**
 * Test-clock extension — the manual `advance()` lever used by golden
 * tests. Production code never sees this type; only the test factory
 * upcasts to `ClockAbstraction` when handing it to commands.
 */
export interface TestClock extends ClockAbstraction {
  advance(ms: number): void;
}

/**
 * Output stream abstraction — `write()` is the only sink, mirroring the
 * `Writable.write()` shape so production wiring (process.stdout) and the
 * test capture sink can share a contract. `captured()` is exposed only
 * by the test sink; production streams expose `flush()` instead (added in
 * iter 5 alongside the formatter).
 */
export interface OutputStream {
  write(chunk: string): void;
}

export interface CapturedOutputStream extends OutputStream {
  captured(): string;
}

/**
 * Input stream abstraction — Phase 2 only needs static `read()` for
 * non-interactive command tests (e.g. piped JSON). Streaming stdin
 * (interactive prompts) is added in iter 8 when the doctor stub lands.
 */
export interface InputStream {
  read(): string;
}

/**
 * Context — the single object passed to every command. Carries every IO
 * surface the command might need plus environment/cwd/exit hooks.
 */
export interface Context {
  fs: FsAbstraction;
  net: NetAbstraction;
  clock: ClockAbstraction;
  stdin: InputStream;
  stdout: OutputStream;
  stderr: OutputStream;
  env: Readonly<Record<string, string>>;
  cwd(): string;
  exit(code: number): void;
}

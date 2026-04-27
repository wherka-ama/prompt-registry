/**
 * Phase 2 / Iter 4 — Layered YAML config loader.
 *
 * Implements the 8-step precedence chain locked in spec §8.1 (decision
 * D3, iter 18):
 *   1. Built-in defaults
 *   2. User config         ($XDG_CONFIG_HOME/prompt-registry/config.yml)
 *   3. Project config      (./prompt-registry.yml, walking up Cargo-style)
 *   4. Env vars            (PROMPT_REGISTRY_<DOTTED_PATH>)
 *   5. --config FILE       (explicit file overrides)
 *   6. --config KEY=VALUE  (single-key overrides; not yet in iter 4)
 *   7. CLI flags           (handled by the framework adapter, iter 3)
 *   8. Profile activation  (handled in iter 5 alongside formatter/output)
 *
 * Iter 4 covers steps 1-5. Steps 6-8 land in later iters.
 */
import * as assert from 'node:assert';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadConfig,
} from '../../../src/cli/framework';

describe('Phase 2 / Iter 4 — layered config loader', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'prompt-registry-iter4-'));
  });

  afterEach(async () => {
    await fsp.rm(workDir, { recursive: true, force: true });
  });

  describe('layer 1: defaults', () => {
    it('returns built-in defaults when no other source is present', async () => {
      // We need a real-fs context for file walking. Use production fs
      // surface but with a captured stdout/stderr by composition: just
      // import createProductionContext and override cwd/env. Simpler:
      // pass cwd/env directly; the loader uses opts.fs, not ctx.fs.
      const cfg = await loadConfig({
        cwd: workDir,
        env: {},
        fs: realFs()
      });
      assert.strictEqual(typeof cfg, 'object');
      // Defaults: at minimum the schema-version field is present.
      assert.strictEqual(cfg.version, 1);
    });
  });

  describe('layer 2: user config file', () => {
    it('reads ~/.config/prompt-registry/config.yml when provided via XDG_CONFIG_HOME', async () => {
      const xdg = path.join(workDir, 'xdg');
      const userConfigDir = path.join(xdg, 'prompt-registry');
      await fsp.mkdir(userConfigDir, { recursive: true });
      await fsp.writeFile(
        path.join(userConfigDir, 'config.yml'),
        'output: yaml\nverbose: true\n'
      );

      const cfg = await loadConfig({
        cwd: workDir,
        env: { XDG_CONFIG_HOME: xdg },
        fs: realFs()
      });
      assert.strictEqual(cfg.output, 'yaml');
      assert.strictEqual(cfg.verbose, true);
    });
  });

  describe('layer 3: project config (Cargo-style upward walk)', () => {
    it('finds prompt-registry.yml in the cwd', async () => {
      await fsp.writeFile(
        path.join(workDir, 'prompt-registry.yml'),
        'output: json\n'
      );
      const cfg = await loadConfig({
        cwd: workDir,
        env: {},
        fs: realFs()
      });
      assert.strictEqual(cfg.output, 'json');
    });

    it('walks upward to find prompt-registry.yml in a parent directory', async () => {
      const sub = path.join(workDir, 'a', 'b', 'c');
      await fsp.mkdir(sub, { recursive: true });
      await fsp.writeFile(
        path.join(workDir, 'prompt-registry.yml'),
        'output: yaml\n'
      );
      const cfg = await loadConfig({
        cwd: sub,
        env: {},
        fs: realFs()
      });
      assert.strictEqual(cfg.output, 'yaml');
    });

    it('project config overrides user config', async () => {
      const xdg = path.join(workDir, 'xdg');
      const userConfigDir = path.join(xdg, 'prompt-registry');
      await fsp.mkdir(userConfigDir, { recursive: true });
      await fsp.writeFile(
        path.join(userConfigDir, 'config.yml'),
        'output: yaml\n'
      );
      await fsp.writeFile(
        path.join(workDir, 'prompt-registry.yml'),
        'output: json\n'
      );
      const cfg = await loadConfig({
        cwd: workDir,
        env: { XDG_CONFIG_HOME: xdg },
        fs: realFs()
      });
      assert.strictEqual(cfg.output, 'json');
    });
  });

  describe('layer 4: env vars (PROMPT_REGISTRY_*)', () => {
    it('PROMPT_REGISTRY_OUTPUT maps to output', async () => {
      const cfg = await loadConfig({
        cwd: workDir,
        env: { PROMPT_REGISTRY_OUTPUT: 'ndjson' },
        fs: realFs()
      });
      assert.strictEqual(cfg.output, 'ndjson');
    });

    it('env overrides project config', async () => {
      await fsp.writeFile(
        path.join(workDir, 'prompt-registry.yml'),
        'output: text\n'
      );
      const cfg = await loadConfig({
        cwd: workDir,
        env: { PROMPT_REGISTRY_OUTPUT: 'json' },
        fs: realFs()
      });
      assert.strictEqual(cfg.output, 'json');
    });

    it('coerces "true"/"false" to boolean', async () => {
      const cfg = await loadConfig({
        cwd: workDir,
        env: { PROMPT_REGISTRY_VERBOSE: 'true', PROMPT_REGISTRY_QUIET: 'false' },
        fs: realFs()
      });
      assert.strictEqual(cfg.verbose, true);
      assert.strictEqual(cfg.quiet, false);
    });

    it('maps PROMPT_REGISTRY_FOO_BAR to fooBar (camelCase)', async () => {
      const cfg = await loadConfig({
        cwd: workDir,
        env: { PROMPT_REGISTRY_INDEX_PATH: '/tmp/idx.json' },
        fs: realFs()
      });
      assert.strictEqual(cfg.indexPath, '/tmp/idx.json');
    });
  });

  describe('layer 5: --config FILE override', () => {
    it('--config FILE overrides everything else', async () => {
      const explicit = path.join(workDir, 'explicit.yml');
      await fsp.writeFile(explicit, 'output: markdown\n');
      await fsp.writeFile(
        path.join(workDir, 'prompt-registry.yml'),
        'output: json\n'
      );
      const cfg = await loadConfig({
        cwd: workDir,
        env: { PROMPT_REGISTRY_OUTPUT: 'yaml' },
        configFile: explicit,
        fs: realFs()
      });
      assert.strictEqual(cfg.output, 'markdown');
    });

    it('throws when --config FILE points to a non-existent file', async () => {
      const missing = path.join(workDir, 'nope.yml');
      await assert.rejects(() => loadConfig({
        cwd: workDir,
        env: {},
        configFile: missing,
        fs: realFs()
      }), /not found|ENOENT/);
    });
  });

  describe('deep merge semantics', () => {
    it('deeply merges nested objects from later layers (env via __ separator)', async () => {
      await fsp.writeFile(
        path.join(workDir, 'prompt-registry.yml'),
        'index:\n  cacheDir: /a\n  ttl: 60\n'
      );
      const cfg = await loadConfig({
        cwd: workDir,
        // Double-underscore = path separator. Single-underscore inside
        // a segment would have produced flat `indexTtl` instead.
        env: { PROMPT_REGISTRY_INDEX__TTL: '120' },
        fs: realFs()
      });
      assert.deepStrictEqual(cfg.index, { cacheDir: '/a', ttl: 120 });
    });
  });
});

// Test helper: build a real fs surface from node:fs/promises so the
// loader can do its own fs work. Identical to what
// createProductionContext returns but without the rest of the Context.
const realFs = () => ({
  readFile: (p: string): Promise<string> => fsp.readFile(p, 'utf8'),
  exists: async (p: string): Promise<boolean> => {
    try {
      await fsp.access(p);
      return true;
    } catch {
      return false;
    }
  }
});

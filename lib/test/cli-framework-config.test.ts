import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  loadConfig,
} from '../src/cli/framework';

describe('layered config loader', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'prompt-registry-iter4-'));
  });

  afterEach(async () => {
    await fsp.rm(workDir, { recursive: true, force: true });
  });

  describe('layer 1: defaults', () => {
    it('returns built-in defaults when no other source is present', async () => {
      const cfg = await loadConfig({
        cwd: workDir,
        env: {},
        fs: realFs()
      });
      expect(typeof cfg).toBe('object');
      expect(cfg.version).toBe(1);
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
      expect(cfg.output).toBe('yaml');
      expect(cfg.verbose).toBe(true);
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
      expect(cfg.output).toBe('json');
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
      expect(cfg.output).toBe('yaml');
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
      expect(cfg.output).toBe('json');
    });
  });

  describe('layer 4: env vars (PROMPT_REGISTRY_*)', () => {
    it('PROMPT_REGISTRY_OUTPUT maps to output', async () => {
      const cfg = await loadConfig({
        cwd: workDir,
        env: { PROMPT_REGISTRY_OUTPUT: 'ndjson' },
        fs: realFs()
      });
      expect(cfg.output).toBe('ndjson');
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
      expect(cfg.output).toBe('json');
    });

    it('coerces "true"/"false" to boolean', async () => {
      const cfg = await loadConfig({
        cwd: workDir,
        env: { PROMPT_REGISTRY_VERBOSE: 'true', PROMPT_REGISTRY_QUIET: 'false' },
        fs: realFs()
      });
      expect(cfg.verbose).toBe(true);
      expect(cfg.quiet).toBe(false);
    });

    it('maps PROMPT_REGISTRY_FOO_BAR to fooBar (camelCase)', async () => {
      const cfg = await loadConfig({
        cwd: workDir,
        env: { PROMPT_REGISTRY_INDEX_PATH: '/tmp/idx.json' },
        fs: realFs()
      });
      expect(cfg.indexPath).toBe('/tmp/idx.json');
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
      expect(cfg.output).toBe('markdown');
    });

    it('throws when --config FILE points to a non-existent file', async () => {
      const missing = path.join(workDir, 'nope.yml');
      await expect(loadConfig({
        cwd: workDir,
        env: {},
        configFile: missing,
        fs: realFs()
      })).rejects.toThrow(/not found|ENOENT/);
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
        env: { PROMPT_REGISTRY_INDEX__TTL: '120' },
        fs: realFs()
      });
      expect(cfg.index).toStrictEqual({ cacheDir: '/a', ttl: 120 });
    });
  });
});

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

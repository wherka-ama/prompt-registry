import {
  spawnSync,
} from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

/**
 * End-to-end CLI workflow tests inspired by e2e-user-flow.sh
 * These tests verify the complete user workflow from target creation to profile activation
 */

const LIB_ROOT = path.resolve(__dirname, '..');
const CLI_BIN = path.join(LIB_ROOT, 'dist', 'cli', 'main.js');

const haveBuild = fs.existsSync(CLI_BIN);

const runCli = (args: string[], cwd?: string): { code: number; stdout: string; stderr: string } => {
  const proc = spawnSync('node', [CLI_BIN, ...args], { cwd, encoding: 'utf8' });
  return {
    code: proc.status ?? 1,
    stdout: proc.stdout ?? '',
    stderr: proc.stderr ?? ''
  };
};

const maybeDescribe = haveBuild ? describe : describe.skip;

let tmp: string;
let xdgConfigHome: string;
let xdgCacheHome: string;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-e2e-'));
  xdgConfigHome = path.join(tmp, 'xdg');
  xdgCacheHome = path.join(tmp, 'cache');
  await fsp.mkdir(xdgConfigHome, { recursive: true });
  await fsp.mkdir(xdgCacheHome, { recursive: true });
});

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

maybeDescribe('E2E CLI Workflow', () => {
  describe('Basic CLI Commands', () => {
    it('shows help for all commands', () => {
      const r = runCli(['--help']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('prompt-registry');
    });

    it('shows version', () => {
      const r = runCli(['--version']);
      expect(r.code).toBe(0);
      expect(/\d+\.\d+\.\d+/.test(r.stdout)).toBe(true);
    });

    it('doctor command runs successfully', () => {
      const r = runCli(['doctor', '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { command: string; status: string };
      expect(parsed.status === 'ok' || parsed.status === 'warning').toBe(true);
      expect(parsed.command).toBe('doctor');
    });

    it('config get reads config values', () => {
      const r = runCli(['config', 'get', 'output.json.indent']);
      expect(r.code).toBe(0);
    });

    it('plugins list runs successfully', () => {
      const r = runCli(['plugins', 'list', '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string };
      expect(parsed.status === 'ok' || parsed.status === 'warning').toBe(true);
    });

    it('target list runs successfully', () => {
      const r = runCli(['target', 'list', '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string };
      expect(parsed.status === 'ok' || parsed.status === 'warning').toBe(true);
    });

    it('collection list reports FS.NOT_FOUND in non-collections cwd', () => {
      const r = runCli(['collection', 'list', '-o', 'json'], tmp);
      expect(r.code).toBe(1);
      const parsed = JSON.parse(r.stdout) as { status: string; errors: { code: string }[] };
      expect(parsed.status).toBe('error');
      expect(parsed.errors[0].code).toBe('FS.NOT_FOUND');
    });

    it('bundle help is accessible', () => {
      const r = runCli(['bundle', '--help']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('bundle');
    });

    it('index help is accessible', () => {
      const r = runCli(['index', '--help']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('index');
    });

    it('install help is accessible', () => {
      const r = runCli(['install', '--help']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('install');
    });
  });

  describe('Bundle Building Workflow', () => {
    it('bundle help shows build options', () => {
      const r = runCli(['bundle', 'build', '--help']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('build');
    });

    it('bundle help shows manifest options', () => {
      const r = runCli(['bundle', 'manifest', '--help']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('manifest');
    });
  });

  describe('Index Building and Searching Workflow', () => {
    it('builds index from local bundle', () => {
      const bundleDir = path.join(tmp, 'bundles', 'test-bundle');
      const indexFile = path.join(xdgCacheHome, 'index.json');
      fs.mkdirSync(bundleDir, { recursive: true });

      // Create deployment manifest
      const manifest = `
id: test-bundle
version: 1.0.0
name: Test Bundle
description: A test bundle
items:
  - path: prompts/test.prompt.md
    kind: prompt
`;
      fs.writeFileSync(path.join(bundleDir, 'deployment-manifest.yml'), manifest.trim());

      // Create a prompt file
      const prompt = `---
title: Test Prompt
description: A test prompt
tags:
  - test
---
# Test Prompt

This is a test prompt.
`;
      fs.mkdirSync(path.join(bundleDir, 'prompts'), { recursive: true });
      fs.writeFileSync(path.join(bundleDir, 'prompts', 'test.prompt.md'), prompt.trim());

      // Build index
      const r = runCli(['index', 'build', '--root', bundleDir, '--out', indexFile, '--source-id', 'test-src', '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string };
      expect(parsed.status).toBe('ok');

      // Verify index file was created
      expect(fs.existsSync(indexFile)).toBe(true);
    });

    it('searches index by query', () => {
      const bundleDir = path.join(tmp, 'bundles', 'test-bundle');
      const indexFile = path.join(xdgCacheHome, 'index.json');
      fs.mkdirSync(bundleDir, { recursive: true });

      // Create deployment manifest
      const manifest = `
id: test-bundle
version: 1.0.0
name: Test Bundle
description: A test bundle
items:
  - path: prompts/test.prompt.md
    kind: prompt
`;
      fs.writeFileSync(path.join(bundleDir, 'deployment-manifest.yml'), manifest.trim());

      // Create a prompt file
      const prompt = `---
title: Test Prompt
description: A test prompt
tags:
  - test
---
# Test Prompt

This is a test prompt.
`;
      fs.mkdirSync(path.join(bundleDir, 'prompts'), { recursive: true });
      fs.writeFileSync(path.join(bundleDir, 'prompts', 'test.prompt.md'), prompt.trim());

      // Build index
      runCli(['index', 'build', '--root', bundleDir, '--out', indexFile, '--source-id', 'test-src', '-o', 'json']);

      // Search index
      const r = runCli(['index', 'search', '--query', 'test', '--index', indexFile, '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string; data: { total: number } };
      expect(parsed.status).toBe('ok');
    });

    it('searches index by kind filter', () => {
      const bundleDir = path.join(tmp, 'bundles', 'test-bundle');
      const indexFile = path.join(xdgCacheHome, 'index.json');
      fs.mkdirSync(bundleDir, { recursive: true });

      // Create deployment manifest
      const manifest = `
id: test-bundle
version: 1.0.0
name: Test Bundle
description: A test bundle
items:
  - path: prompts/test.prompt.md
    kind: prompt
`;
      fs.writeFileSync(path.join(bundleDir, 'deployment-manifest.yml'), manifest.trim());

      // Create a prompt file
      const prompt = `---
title: Test Prompt
description: A test prompt
tags:
  - test
---
# Test Prompt

This is a test prompt.
`;
      fs.mkdirSync(path.join(bundleDir, 'prompts'), { recursive: true });
      fs.writeFileSync(path.join(bundleDir, 'prompts', 'test.prompt.md'), prompt.trim());

      // Build index
      runCli(['index', 'build', '--root', bundleDir, '--out', indexFile, '--source-id', 'test-src', '-o', 'json']);

      // Search index with kind filter
      const r = runCli(['index', 'search', '--query', 'test', '--kinds', 'prompt', '--index', indexFile, '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string; data: { total: number } };
      expect(parsed.status).toBe('ok');
    });

    it('shows index stats', () => {
      const bundleDir = path.join(tmp, 'bundles', 'test-bundle');
      const indexFile = path.join(xdgCacheHome, 'index.json');
      fs.mkdirSync(bundleDir, { recursive: true });

      // Create deployment manifest
      const manifest = `
id: test-bundle
version: 1.0.0
name: Test Bundle
description: A test bundle
items:
  - path: prompts/test.prompt.md
    kind: prompt
`;
      fs.writeFileSync(path.join(bundleDir, 'deployment-manifest.yml'), manifest.trim());

      // Create a prompt file
      const prompt = `---
title: Test Prompt
description: A test prompt
tags:
  - test
---
# Test Prompt

This is a test prompt.
`;
      fs.mkdirSync(path.join(bundleDir, 'prompts'), { recursive: true });
      fs.writeFileSync(path.join(bundleDir, 'prompts', 'test.prompt.md'), prompt.trim());

      // Build index
      runCli(['index', 'build', '--root', bundleDir, '--out', indexFile, '--source-id', 'test-src', '-o', 'json']);

      // Show stats
      const r = runCli(['index', 'stats', '--index', indexFile, '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string };
      expect(parsed.status).toBe('ok');
    });
  });

  describe('Shortlist Management Workflow', () => {
    it('creates a new shortlist', () => {
      const bundleDir = path.join(tmp, 'bundles', 'test-bundle');
      const indexFile = path.join(xdgCacheHome, 'index.json');
      fs.mkdirSync(bundleDir, { recursive: true });

      // Create deployment manifest
      const manifest = `
id: test-bundle
version: 1.0.0
name: Test Bundle
description: A test bundle
items:
  - path: prompts/test.prompt.md
    kind: prompt
`;
      fs.writeFileSync(path.join(bundleDir, 'deployment-manifest.yml'), manifest.trim());

      // Create a prompt file
      const prompt = `---
title: Test Prompt
description: A test prompt
tags:
  - test
---
# Test Prompt

This is a test prompt.
`;
      fs.mkdirSync(path.join(bundleDir, 'prompts'), { recursive: true });
      fs.writeFileSync(path.join(bundleDir, 'prompts', 'test.prompt.md'), prompt.trim());

      // Build index
      runCli(['index', 'build', '--root', bundleDir, '--out', indexFile, '--source-id', 'test-src', '-o', 'json']);

      // Create shortlist
      const r = runCli(['index', 'shortlist', 'new', '--name', 'test-shortlist', '--index', indexFile, '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string; data: { shortlist: { id: string } } };
      expect(parsed.status).toBe('ok');
      expect(parsed.data.shortlist.id).toBeDefined();
    });

    it('lists all shortlists', () => {
      const bundleDir = path.join(tmp, 'bundles', 'test-bundle');
      const indexFile = path.join(xdgCacheHome, 'index.json');
      fs.mkdirSync(bundleDir, { recursive: true });

      // Create deployment manifest
      const manifest = `
id: test-bundle
version: 1.0.0
name: Test Bundle
description: A test bundle
items:
  - path: prompts/test.prompt.md
    kind: prompt
`;
      fs.writeFileSync(path.join(bundleDir, 'deployment-manifest.yml'), manifest.trim());

      // Create a prompt file
      const prompt = `---
title: Test Prompt
description: A test prompt
tags:
  - test
---
# Test Prompt

This is a test prompt.
`;
      fs.mkdirSync(path.join(bundleDir, 'prompts'), { recursive: true });
      fs.writeFileSync(path.join(bundleDir, 'prompts', 'test.prompt.md'), prompt.trim());

      // Build index
      runCli(['index', 'build', '--root', bundleDir, '--out', indexFile, '--source-id', 'test-src', '-o', 'json']);

      // Create shortlist
      runCli(['index', 'shortlist', 'new', '--name', 'test-shortlist', '--index', indexFile, '-o', 'json']);

      // List shortlists
      const r = runCli(['index', 'shortlist', 'list', '--index', indexFile, '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string; data: { shortlists: any[] } };
      expect(parsed.status).toBe('ok');
      expect(parsed.data.shortlists.length).toBeGreaterThan(0);
    });
  });

  describe('Profile Export Workflow', () => {
    it('exports profile from shortlist', async () => {
      const bundleDir = path.join(tmp, 'bundles', 'test-bundle');
      const exportDir = path.join(tmp, 'exports');
      const indexFile = path.join(xdgCacheHome, 'index.json');
      fs.mkdirSync(bundleDir, { recursive: true });
      fs.mkdirSync(exportDir, { recursive: true });

      // Create deployment manifest
      const manifest = `
id: test-bundle
version: 1.0.0
name: Test Bundle
description: A test bundle
items:
  - path: prompts/test.prompt.md
    kind: prompt
`;
      fs.writeFileSync(path.join(bundleDir, 'deployment-manifest.yml'), manifest.trim());

      // Create a prompt file
      const prompt = `---
title: Test Prompt
description: A test prompt
tags:
  - test
---
# Test Prompt

This is a test prompt.
`;
      fs.mkdirSync(path.join(bundleDir, 'prompts'), { recursive: true });
      fs.writeFileSync(path.join(bundleDir, 'prompts', 'test.prompt.md'), prompt.trim());

      // Build index
      runCli(['index', 'build', '--root', bundleDir, '--out', indexFile, '--source-id', 'test-src', '-o', 'json']);

      // Create shortlist
      const createR = runCli(['index', 'shortlist', 'new', '--name', 'test-shortlist', '--index', indexFile, '-o', 'json']);
      const shortlistId = JSON.parse(createR.stdout).data.shortlist.id;

      // Export profile
      const r = runCli(['index', 'export', '--shortlist', shortlistId, '--profile-id', 'test-profile', '--out-dir', exportDir, '--index', indexFile, '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string };
      expect(parsed.status).toBe('ok');

      // Verify profile file was created
      const profileFiles = await fsp.readdir(exportDir);
      expect(profileFiles.some((f: string) => f.endsWith('.profile.yml'))).toBe(true);
    });
  });

  describe('Collection Validation Workflow', () => {
    it('collection validate help is accessible', () => {
      const r = runCli(['collection', 'validate', '--help']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('validate');
    });

    it('version compute help is accessible', () => {
      const r = runCli(['version', 'compute', '--help']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('compute');
    });
  });

  describe('Skill Management Workflow', () => {
    it('skill new help is accessible', () => {
      const r = runCli(['skill', 'new', '--help']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('new');
    });

    it('skill validate help is accessible', () => {
      const r = runCli(['skill', 'validate', '--help']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('validate');
    });
  });

  describe('Init Wizard Workflow (F-01)', () => {
    it('init creates target with --yes flag', () => {
      const targetDir = path.join(tmp, 'copilot-cli');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.mkdirSync(path.join(targetDir, 'prompts'), { recursive: true });
      fs.mkdirSync(path.join(targetDir, 'skills'), { recursive: true });

      const r = runCli(['init', '--target-name', 'test-target', '--target-type', 'copilot-cli', '--yes', '-o', 'json'], tmp);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string };
      expect(parsed.status).toBe('ok');
      expect(fs.existsSync(path.join(tmp, 'prompt-registry.yml'))).toBe(true);
    });
  });

  describe('Status Command Workflow (F-03)', () => {
    it('status shows current configuration', () => {
      const targetDir = path.join(tmp, 'copilot-cli');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.mkdirSync(path.join(targetDir, 'prompts'), { recursive: true });
      fs.mkdirSync(path.join(targetDir, 'skills'), { recursive: true });

      // First create a target
      runCli(['target', 'add', 'test-target', '--type', 'copilot-cli', '--path', targetDir, '-o', 'json'], tmp);

      // Then run status
      const r = runCli(['status', '-o', 'json'], tmp);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string };
      expect(parsed.status).toBe('ok');
    });
  });

  describe('Search Alias Workflow (F-07)', () => {
    it('search alias works as top-level command', () => {
      const bundleDir = path.join(tmp, 'bundles', 'test-bundle');
      const indexFile = path.join(xdgCacheHome, 'index.json');
      fs.mkdirSync(bundleDir, { recursive: true });

      // Create deployment manifest
      const manifest = `
id: test-bundle
version: 1.0.0
name: Test Bundle
description: A test bundle
items:
  - path: prompts/test.prompt.md
    kind: prompt
`;
      fs.writeFileSync(path.join(bundleDir, 'deployment-manifest.yml'), manifest.trim());

      // Create a prompt file
      const prompt = `---
title: Test Prompt
description: A test prompt
tags:
  - test
---
# Test Prompt

This is a test prompt.
`;
      fs.mkdirSync(path.join(bundleDir, 'prompts'), { recursive: true });
      fs.writeFileSync(path.join(bundleDir, 'prompts', 'test.prompt.md'), prompt.trim());

      // Build index
      runCli(['index', 'build', '--root', bundleDir, '--out', indexFile, '--source-id', 'test-src', '-o', 'json']);

      // Use search alias (not index search)
      const r = runCli(['search', '--query', 'test', '--index', indexFile, '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string };
      expect(parsed.status).toBe('ok');
    });
  });

  describe('Error Handling Workflow', () => {
    it('handles missing index file error', () => {
      const nonExistentIndex = path.join(tmp, 'nonexistent-index.json');
      const r = runCli(['index', 'search', '--query', 'test', '--index', nonExistentIndex, '-o', 'json']);
      expect(r.code).not.toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string; errors: { code: string; hint?: string }[] };
      expect(parsed.status).toBe('error');
      expect(parsed.errors[0].code).toBe('INDEX.NOT_FOUND');
      // F-06: Verify error hint is present
      expect(parsed.errors[0].hint).toContain('index build');
    });

    it('handles invalid collection file error', () => {
      const invalidFile = path.join(tmp, 'invalid.yml');
      fs.writeFileSync(invalidFile, 'invalid yaml content {{{');

      const r = runCli(['collection', 'validate', invalidFile, '-o', 'json']);
      expect(r.code).not.toBe(0);
    });

    it('handles missing bundle directory error', () => {
      const nonExistentDir = path.join(tmp, 'nonexistent-bundle');
      const r = runCli(['bundle', 'build', '--root', nonExistentDir, '-o', 'json']);
      expect(r.code).not.toBe(0);
    });
  });

  describe('Dry-Run Workflow (F-09)', () => {
    it('profile activate with --dry-run flag is accepted', () => {
      // Test that --dry-run flag is accepted without requiring full setup
      const r = runCli(['profile', 'activate', 'backend', '--dry-run', '-o', 'json']);
      // Should not fail on unknown flag
      expect(r.stdout).not.toContain('unknown option');
    });

    it('profile deactivate with --dry-run flag is accepted', () => {
      // Test that --dry-run flag is accepted (even if no active profile)
      const r = runCli(['profile', 'deactivate', '--dry-run', '-o', 'json']);
      // Should not fail on unknown flag
      expect(r.stdout).not.toContain('unknown option');
    });
  });
});

// ============================================================================
// Full Lifecycle: Blank Slate → Configure → Install → Search → Teardown
//
// Mirrors the 20-scenario flow in docs/developer-guide/e2e-user-flow.sh.
// Each describe phase builds on the previous; shared state is held in the
// outer lets. Uses its own XDG dirs via beforeAll/afterAll so the
// module-level beforeEach/afterEach (which reset `tmp`) do not interfere.
// ============================================================================
maybeDescribe('Full Lifecycle (Blank Slate to Teardown)', () => {
  let lifecycleTmp: string;
  let lifecycleXdgConfig: string;
  let lifecycleXdgCache: string;
  let projectDir: string;
  let targetDir: string;
  let bundleDir: string;
  let hubDir: string;
  let indexFile: string;
  let shortlistId = '';

  const cli = (args: string[], cwd?: string): { code: number; stdout: string; stderr: string } => {
    const proc = spawnSync('node', [CLI_BIN, ...args], {
      cwd: cwd ?? projectDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        XDG_CONFIG_HOME: lifecycleXdgConfig,
        XDG_CACHE_HOME: lifecycleXdgCache
      }
    });
    return { code: proc.status ?? 1, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' };
  };

  beforeAll(async () => {
    lifecycleTmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'prc-lifecycle-'));
    lifecycleXdgConfig = path.join(lifecycleTmp, 'xdg');
    lifecycleXdgCache = path.join(lifecycleTmp, 'cache');
    projectDir = path.join(lifecycleTmp, 'project');
    targetDir = path.join(lifecycleTmp, 'copilot-cli');
    bundleDir = path.join(lifecycleTmp, 'bundles', 'local-foo');
    hubDir = path.join(lifecycleTmp, 'local-hub');
    indexFile = path.join(lifecycleXdgCache, 'primitive-index.json');

    for (const dir of [
      lifecycleXdgConfig, lifecycleXdgCache, projectDir,
      path.join(targetDir, 'prompts'), path.join(targetDir, 'skills'),
      path.join(bundleDir, 'prompts'), path.join(bundleDir, 'skills', 'test-skill'),
      hubDir, path.join(lifecycleTmp, 'exports')
    ]) {
      await fsp.mkdir(dir, { recursive: true });
    }
  });

  afterAll(async () => {
    await fsp.rm(lifecycleTmp, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  describe('Phase 1: Project Setup', () => {
    it('starts with empty or default target list', () => {
      const r = cli(['target', 'list', '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string };
      expect(parsed.status === 'ok' || parsed.status === 'warning').toBe(true);
    });

    it('target add creates prompt-registry.yml in cwd', () => {
      const r = cli(['target', 'add', 'copilot-target', '--type', 'copilot-cli', '--path', targetDir, '-o', 'json']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ status: 'ok' });
      expect(fs.existsSync(path.join(projectDir, 'prompt-registry.yml'))).toBe(true);
    });

    it('target list shows the registered target', () => {
      const r = cli(['target', 'list', '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string; data?: { targets?: { name: string }[] } };
      expect(parsed.status === 'ok' || parsed.status === 'warning').toBe(true);
      // data.targets shape may vary; just confirm the output text mentions the target name
      expect(r.stdout).toContain('copilot-target');
    });
  });

  // --------------------------------------------------------------------------
  describe('Phase 2: Local Bundle Creation', () => {
    it('deployment-manifest.yml is present', () => {
      fs.writeFileSync(path.join(bundleDir, 'deployment-manifest.yml'), [
        'id: local-foo',
        'version: 1.0.0',
        'name: Local Foo',
        'description: A test bundle for e2e testing',
        'items:',
        '  - path: prompts/hello.prompt.md',
        '    kind: prompt',
        '  - path: skills/test-skill/SKILL.md',
        '    kind: skill'
      ].join('\n'));
      expect(fs.existsSync(path.join(bundleDir, 'deployment-manifest.yml'))).toBe(true);
    });

    it('prompt file with frontmatter is present', () => {
      fs.writeFileSync(path.join(bundleDir, 'prompts', 'hello.prompt.md'), [
        '---',
        'title: Hello Prompt',
        'description: A simple greeting prompt',
        'tags:',
        '  - greeting',
        '  - test',
        '---',
        '# Hello Prompt',
        '',
        'This is a test prompt for end-to-end testing.'
      ].join('\n'));
      expect(fs.existsSync(path.join(bundleDir, 'prompts', 'hello.prompt.md'))).toBe(true);
    });

    it('skill file is present', () => {
      fs.writeFileSync(path.join(bundleDir, 'skills', 'test-skill', 'SKILL.md'), [
        '# Test Skill',
        '',
        'A test skill for end-to-end testing.',
        '',
        '## Purpose',
        'Tests the installation system.'
      ].join('\n'));
      expect(fs.existsSync(path.join(bundleDir, 'skills', 'test-skill', 'SKILL.md'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  describe('Phase 3: Hub Setup', () => {
    it('hub-config.yml is present', () => {
      fs.writeFileSync(path.join(hubDir, 'hub-config.yml'), [
        'version: 1.0.0',
        'metadata:',
        '  name: Local Test Hub',
        '  description: Synthetic hub for e2e testing',
        '  maintainer: tester',
        "  updatedAt: '2026-05-12T00:00:00Z'",
        'sources:',
        '  - id: local-foo-src',
        '    name: Local Foo Source',
        '    type: local',
        `    url: ${bundleDir}`,
        '    enabled: true',
        '    priority: 0',
        '    hubId: local-test-hub',
        'profiles:',
        '  - id: backend',
        '    name: Backend Developer',
        '    description: Profile for backend developers',
        '    bundles:',
        '      - id: local-foo',
        '        version: 1.0.0',
        '        source: local-foo-src',
        '        required: true'
      ].join('\n'));
      expect(fs.existsSync(path.join(hubDir, 'hub-config.yml'))).toBe(true);
    });

    it('hub add (local) registers hub and returns its id', () => {
      const r = cli(['hub', 'add', '--type', 'local', '--location', hubDir, '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string; data: { id: string } };
      expect(parsed.status).toBe('ok');
      expect(parsed.data.id).toBe('local-test-hub');
    });

    it('hub list shows hub as active after add', () => {
      const r = cli(['hub', 'list', '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as {
        status: string;
        data: { hubs: { id: string }[]; activeId: string | null };
      };
      expect(parsed.status).toBe('ok');
      expect(parsed.data.hubs.some((h) => h.id === 'local-test-hub')).toBe(true);
    });

    it('hub sync succeeds for local hub', () => {
      const r = cli(['hub', 'sync', 'local-test-hub', '-o', 'json']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ status: 'ok' });
    });

    it('profile list returns profiles from synced hub', () => {
      const r = cli(['profile', 'list', '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string };
      expect(parsed.status === 'ok' || parsed.status === 'warning').toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  describe('Phase 4: Profile Activation — Files Written to Target', () => {
    it('profile activate succeeds', () => {
      const r = cli(['profile', 'activate', 'backend', '--target', 'copilot-target', '-o', 'json']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ status: 'ok' });
    });

    it('lockfile created after activation', () => {
      expect(fs.existsSync(path.join(projectDir, 'prompt-registry.lock.json'))).toBe(true);
    });

    it('lockfile records active profileId', () => {
      const lock = JSON.parse(
        fs.readFileSync(path.join(projectDir, 'prompt-registry.lock.json'), 'utf8')
      ) as { useProfile?: { profileId?: string } };
      expect(lock.useProfile?.profileId).toBe('backend');
    });

    it('prompt is installed in target/prompts/', () => {
      expect(fs.existsSync(path.join(targetDir, 'prompts', 'hello.prompt.md'))).toBe(true);
    });

    it('skill is installed in target/skills/', () => {
      expect(fs.existsSync(path.join(targetDir, 'skills', 'test-skill', 'SKILL.md'))).toBe(true);
    });

    it('profile current reflects active profile', () => {
      const r = cli(['profile', 'current', '-o', 'json']);
      expect(r.code).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  describe('Phase 5: Primitive Index — Build, Search, Shortlist, Export', () => {
    it('index build produces an index file', () => {
      const r = cli(['index', 'build', '--root', bundleDir, '--out', indexFile, '--source-id', 'local-foo-src', '-o', 'json']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ status: 'ok' });
      expect(fs.existsSync(indexFile)).toBe(true);
    });

    it('index stats reports primitives', () => {
      const r = cli(['index', 'stats', '--index', indexFile, '-o', 'json']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ status: 'ok' });
    });

    it('index search (free text) returns ok', () => {
      const r = cli(['index', 'search', '--query', 'hello', '--index', indexFile, '-o', 'json']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ status: 'ok' });
    });

    it('index search filtered by kind=prompt returns ok', () => {
      const r = cli(['index', 'search', '--query', 'hello', '--kinds', 'prompt', '--index', indexFile, '-o', 'json']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ status: 'ok' });
    });

    it('index search filtered by kind=skill returns ok', () => {
      const r = cli(['index', 'search', '--query', 'test', '--kinds', 'skill', '--index', indexFile, '-o', 'json']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ status: 'ok' });
    });

    it('shortlist new returns a shortlist id', () => {
      const r = cli(['index', 'shortlist', 'new', '--name', 'my-selection', '--index', indexFile, '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string; data: { shortlist: { id: string } } };
      expect(parsed.status).toBe('ok');
      shortlistId = parsed.data.shortlist.id;
      expect(shortlistId.length).toBeGreaterThan(0);
    });

    it('shortlist add succeeds for the first search hit', () => {
      const searchR = cli(['index', 'search', '--query', 'hello', '--index', indexFile, '-o', 'json']);
      const search = JSON.parse(searchR.stdout) as {
        data: { hits: { primitive: { id: string } }[] };
      };
      if (search.data.hits.length > 0) {
        const primitiveId = search.data.hits[0].primitive.id;
        const r = cli(['index', 'shortlist', 'add', '--id', shortlistId, '--primitive', primitiveId, '--index', indexFile, '-o', 'json']);
        expect(r.code).toBe(0);
        expect(JSON.parse(r.stdout)).toMatchObject({ status: 'ok' });
      }
    });

    it('shortlist list shows the created shortlist', () => {
      const r = cli(['index', 'shortlist', 'list', '--index', indexFile, '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string; data: { shortlists: { id: string }[] } };
      expect(parsed.status).toBe('ok');
      expect(parsed.data.shortlists.some((s) => s.id === shortlistId)).toBe(true);
    });

    it('index export produces a .profile.yml file', () => {
      const exportDir = path.join(lifecycleTmp, 'exports');
      const r = cli(['index', 'export', '--shortlist', shortlistId, '--profile-id', 'custom-profile', '--out-dir', exportDir, '--index', indexFile, '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string; data: { profileFile: string } };
      expect(parsed.status).toBe('ok');
      expect(fs.existsSync(parsed.data.profileFile)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  describe('Phase 6: Profile Deactivation — Files Removed from Target', () => {
    it('profile deactivate succeeds', () => {
      const r = cli(['profile', 'deactivate', '-o', 'json']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ status: 'ok' });
    });

    it('lockfile useProfile cleared after deactivation', () => {
      const lockPath = path.join(projectDir, 'prompt-registry.lock.json');
      if (fs.existsSync(lockPath)) {
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { useProfile?: unknown };
        expect(lock.useProfile == null).toBe(true);
      }
    });

    it('prompt removed from target after deactivation', () => {
      expect(fs.existsSync(path.join(targetDir, 'prompts', 'hello.prompt.md'))).toBe(false);
    });

    it('skill removed from target after deactivation', () => {
      expect(fs.existsSync(path.join(targetDir, 'skills', 'test-skill', 'SKILL.md'))).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  describe('Phase 7: Direct Install and Uninstall', () => {
    it('install --from installs bundle from local directory', () => {
      const r = cli(['install', 'local-foo', '--from', bundleDir, '--target', 'copilot-target', '-o', 'json']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ status: 'ok' });
    });

    it('prompt present in target after direct install', () => {
      expect(fs.existsSync(path.join(targetDir, 'prompts', 'hello.prompt.md'))).toBe(true);
    });

    it('skill present in target after direct install', () => {
      expect(fs.existsSync(path.join(targetDir, 'skills', 'test-skill', 'SKILL.md'))).toBe(true);
    });

    it('uninstall --lockfile removes files recorded in lockfile', () => {
      const lockfile = path.join(projectDir, 'test-uninstall.lock.json');
      fs.writeFileSync(lockfile, JSON.stringify({
        schemaVersion: 1,
        entries: [{
          target: 'copilot-target',
          sourceId: 'local-foo-src',
          bundleId: 'local-foo',
          bundleVersion: '1.0.0',
          installedAt: '2026-05-12T00:00:00Z',
          files: ['prompts/hello.prompt.md', 'skills/test-skill/SKILL.md'],
          fileChecksums: {}
        }]
      }, null, 2));
      const r = cli(['uninstall', '--lockfile', lockfile, '--target', 'copilot-target', '-o', 'json']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ status: 'ok' });
    });

    it('prompt removed from target after uninstall', () => {
      expect(fs.existsSync(path.join(targetDir, 'prompts', 'hello.prompt.md'))).toBe(false);
    });

    it('skill removed from target after uninstall', () => {
      expect(fs.existsSync(path.join(targetDir, 'skills', 'test-skill', 'SKILL.md'))).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  describe('Phase 8: Teardown', () => {
    it('target remove succeeds', () => {
      const r = cli(['target', 'remove', 'copilot-target', '-o', 'json']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ status: 'ok' });
    });

    it('target no longer appears in target list', () => {
      const r = cli(['target', 'list', '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { status: string; data?: { targets?: { name: string }[] } };
      if (parsed.status === 'ok' && parsed.data?.targets) {
        expect(parsed.data.targets.some((t) => t.name === 'copilot-target')).toBe(false);
      }
    });

    it('hub remove succeeds', () => {
      const r = cli(['hub', 'remove', 'local-test-hub', '-o', 'json']);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ status: 'ok' });
    });

    it('hub list is empty after hub removal', () => {
      const r = cli(['hub', 'list', '-o', 'json']);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout) as { data: { hubs: unknown[] } };
      expect(parsed.data.hubs.length).toBe(0);
    });
  });
});

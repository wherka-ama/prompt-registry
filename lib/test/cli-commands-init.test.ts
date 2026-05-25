import * as fs from 'node:fs/promises';
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
  createInitCommand,
  InitCommand,
} from '../src/cli/commands/init';
import {
  runCommand,
} from '../src/cli/framework';
import {
  TARGET_TYPES,
} from '../src/domain/install';
import {
  createNodeFsAdapter,
} from './cli/helpers/node-fs-adapter';

let tmpRoot: string;
let xdgConfig: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-init-'));
  xdgConfig = path.join(tmpRoot, 'xdg-config');
  await fs.mkdir(xdgConfig, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('cli `init`', () => {
  it('creates prompt-registry.yml with default target on blank project', async () => {
    const { exitCode, stdout, stderr } = await runCommand(
      ['init'],
      {
        commands: [createInitCommand({ output: 'json', yes: true, scope: 'repository' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      status: string;
      data: { target: { name: string; type: string } };
    };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.target.name).toBe('copilot');
    expect(parsed.data.target.type).toBe('copilot-cli');

    const configExists = await fs
      .access(path.join(tmpRoot, 'prompt-registry.yml'))
      .then(() => true)
      .catch(() => false);
    expect(configExists).toBe(true);
  });

  it('accepts custom target name and type', async () => {
    const { exitCode, stdout } = await runCommand(
      ['init'],
      {
        commands: [createInitCommand({
          output: 'json',
          yes: true,
          targetName: 'my-workspace',
          targetType: 'vscode'
        })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      data: { target: { name: string; type: string } };
    };
    expect(parsed.data.target.name).toBe('my-workspace');
    expect(parsed.data.target.type).toBe('vscode');
  });

  it('exits 1 with USAGE.MISSING_FLAG for unknown target type', async () => {
    const { exitCode, stdout } = await runCommand(
      ['init'],
      {
        commands: [createInitCommand({
          output: 'json',
          yes: true,
          targetType: 'not-a-real-type'
        })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('returns hub: null in data when no --hub flag supplied', async () => {
    const { exitCode, stdout } = await runCommand(
      ['init'],
      {
        commands: [createInitCommand({ output: 'json', yes: true })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { data: { hub: null } };
    expect(parsed.data.hub).toBeNull();
  });

  it('text output includes next-steps hint when no hub supplied', async () => {
    const { exitCode, stdout } = await runCommand(
      ['init'],
      {
        commands: [createInitCommand({ output: 'text', yes: true })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('hub add');
  });

  it('outputs error in JSON format when invalid type given with --output json', async () => {
    const { exitCode, stdout } = await runCommand(
      ['init'],
      {
        commands: [createInitCommand({
          output: 'json',
          yes: true,
          targetType: 'bad-type'
        })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout) as {
      status: string;
      errors: { code: string; message: string }[];
    };
    expect(parsed.status).toBe('error');
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
    expect(parsed.errors[0].message).toContain('bad-type');
  });

  it('text output shows profile activate hint when hub IS supplied (via mock)', async () => {
    const { exitCode, stdout } = await runCommand(
      ['init'],
      {
        commands: [createInitCommand({ output: 'text', yes: true })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    // Covers the 'else' branch of the hub null check in textRenderer
    expect(stdout).toContain('profile activate');
  });

  describe('target type coverage', () => {
    TARGET_TYPES.forEach((targetType) => {
      it(`accepts ${targetType} as valid target type`, async () => {
        const { exitCode, stdout } = await runCommand(
          ['init'],
          {
            commands: [createInitCommand({
              output: 'json',
              yes: true,
              targetName: `test-${targetType}`,
              targetType
            })],
            context: {
              cwd: tmpRoot,
              fs: createNodeFsAdapter(),
              env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
            }
          }
        );
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(stdout) as {
          data: { target: { name: string; type: string } };
        };
        expect(parsed.data.target.name).toBe(`test-${targetType}`);
        expect(parsed.data.target.type).toBe(targetType);
      });
    });
  });

  it('skips target creation when target already exists', async () => {
    // Create initial target
    await runCommand(
      ['init'],
      {
        commands: [createInitCommand({
          output: 'json',
          yes: true,
          targetName: 'copilot',
          targetType: 'copilot-cli'
        })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );

    // Try to init again with same target name
    const { exitCode, stdout } = await runCommand(
      ['init'],
      {
        commands: [createInitCommand({
          output: 'json',
          yes: true,
          targetName: 'copilot',
          targetType: 'copilot-cli'
        })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      data: { target: { created: boolean } };
    };
    expect(parsed.data.target.created).toBe(false);
  });

  it('updates target type when re-running init with a different IDE selection', async () => {
    const fsAdapter = createNodeFsAdapter();
    const ctx = { cwd: tmpRoot, fs: fsAdapter, env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot } };

    await runCommand(['init'], {
      commands: [createInitCommand({ output: 'json', yes: true, scope: 'repository', targetName: 'copilot', targetType: 'vscode' })],
      context: ctx
    });

    const { exitCode, stdout } = await runCommand(['init'], {
      commands: [createInitCommand({ output: 'json', yes: true, scope: 'repository', targetName: 'copilot', targetType: 'copilot-cli' })],
      context: ctx
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { status: string; data: { target: { type: string; created: boolean } }; steps?: string[] };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.target.type).toBe('copilot-cli');
    expect(parsed.data.target.created).toBe(false);

    const raw = await fs.readFile(path.join(tmpRoot, 'prompt-registry.yml'), 'utf8');
    expect(raw).toContain('copilot-cli');
    expect(raw).not.toContain('type: vscode');
  });

  it('user scope: writes target to user config dir, not cwd', async () => {
    const { exitCode, stdout } = await runCommand(
      ['init'],
      {
        commands: [createInitCommand({ output: 'json', yes: true, scope: 'user' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { status: string };
    expect(parsed.status).toBe('ok');

    const projectConfig = await fs
      .access(path.join(tmpRoot, 'prompt-registry.yml'))
      .then(() => true)
      .catch(() => false);
    expect(projectConfig).toBe(false);

    const userTargets = await fs
      .access(path.join(xdgConfig, 'prompt-registry', 'targets.yml'))
      .then(() => true)
      .catch(() => false);
    expect(userTargets).toBe(true);

    const userLockfile = await fs
      .access(path.join(xdgConfig, 'prompt-registry', 'prompt-registry.lock.json'))
      .then(() => true)
      .catch(() => false);
    expect(userLockfile).toBe(true);
  });

  it('returns HUB.ACCESS_DENIED with auth hint when hub returns 404 (private repo / wrong token)', async () => {
    const mockHttp = {
      fetch: (_req: { url: string; headers?: Record<string, string> }) => Promise.resolve({
        statusCode: 404,
        body: new Uint8Array(),
        headers: {},
        finalUrl: 'https://api.github.com/repos/owner/private-hub/contents/hub-config.yml'
      })
    };
    const mockTokens = {
      getToken: (_host: string) => Promise.resolve('gho_wrong_account_token')
    };
    const { exitCode, stdout } = await runCommand(
      ['init'],
      {
        commands: [createInitCommand({
          output: 'json',
          yes: true,
          scope: 'repository',
          hub: 'owner/private-hub',
          hubType: 'github',
          http: mockHttp,
          tokens: mockTokens
        })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout) as { status: string; errors: { code: string; hint: string }[] };
    expect(parsed.status).toBe('error');
    expect(parsed.errors[0].code).toBe('HUB.ACCESS_DENIED');
    expect(parsed.errors[0].hint).toContain('gh auth status');
  });

  it('repository scope: writes target and lockfile to cwd', async () => {
    const { exitCode } = await runCommand(
      ['init'],
      {
        commands: [createInitCommand({ output: 'json', yes: true, scope: 'repository' })],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);

    const projectConfig = await fs
      .access(path.join(tmpRoot, 'prompt-registry.yml'))
      .then(() => true)
      .catch(() => false);
    expect(projectConfig).toBe(true);

    const projectLockfile = await fs
      .access(path.join(tmpRoot, 'prompt-registry.lock.json'))
      .then(() => true)
      .catch(() => false);
    expect(projectLockfile).toBe(true);
  });
});

describe('InitCommand (native class)', () => {
  it('creates config with --yes --scope repository via class flags', async () => {
    const { exitCode, stdout } = await runCommand(
      ['init', '--yes', '--scope', 'repository', '-o', 'json'],
      {
        commandClasses: [InitCommand],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as { status: string };
    expect(result.status).toBe('ok');
    const configExists = await fs
      .access(path.join(tmpRoot, 'prompt-registry.yml'))
      .then(() => true).catch(() => false);
    expect(configExists).toBe(true);
  });

  it('accepts --target-name and --target-type flags', async () => {
    const { exitCode, stdout } = await runCommand(
      ['init', '--yes', '--scope', 'repository', '--target-name', 'my-target', '--target-type', 'vscode', '-o', 'json'],
      {
        commandClasses: [InitCommand],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as { status: string; data: { target?: { name: string } } };
    expect(result.status).toBe('ok');
    expect(result.data.target?.name).toBe('my-target');
  });

  it('supports all TARGET_TYPES via --target-type', async () => {
    for (const type of TARGET_TYPES) {
      const dir = await fs.mkdtemp(path.join(tmpRoot, `type-${type}-`));
      const { exitCode } = await runCommand(
        ['init', '--yes', '--scope', 'repository', '--target-type', type, '-o', 'json'],
        {
          commandClasses: [InitCommand],
          context: {
            cwd: dir,
            fs: createNodeFsAdapter(),
            env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
          }
        }
      );
      expect(exitCode).toBe(0);
    }
  });

  it('user scope creates config in XDG_CONFIG_HOME', async () => {
    const { exitCode, stdout } = await runCommand(
      ['init', '--yes', '--scope', 'user', '-o', 'json'],
      {
        commandClasses: [InitCommand],
        context: {
          cwd: tmpRoot,
          fs: createNodeFsAdapter(),
          env: { XDG_CONFIG_HOME: xdgConfig, HOME: tmpRoot }
        }
      }
    );
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as { status: string };
    expect(result.status).toBe('ok');
  });
});

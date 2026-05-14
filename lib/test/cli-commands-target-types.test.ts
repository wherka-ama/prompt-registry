import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createTargetTypesCommand,
} from '../src/cli/commands/target-types';
import {
  runCommand,
} from '../src/cli/framework';

describe('target types command', () => {
  it('lists all supported target types in text format', async () => {
    const { exitCode, stdout } = await runCommand(['target', 'types'], {
      commands: [createTargetTypesCommand({ output: 'text' })]
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('copilot-cli');
    expect(stdout).toContain('vscode');
    expect(stdout).toContain('windsurf');
    expect(stdout).toContain('kiro');
  });

  it('returns JSON array with type and description fields', async () => {
    const { exitCode, stdout } = await runCommand(['target', 'types'], {
      commands: [createTargetTypesCommand({ output: 'json' })]
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { data: { type: string; description: string }[] };
    expect(Array.isArray(parsed.data)).toBe(true);
    const types = parsed.data.map((e) => e.type);
    expect(types).toContain('copilot-cli');
    expect(types).toContain('vscode');
    for (const entry of parsed.data) {
      expect(typeof entry.type).toBe('string');
      expect(typeof entry.description).toBe('string');
    }
  });

  it('includes usage hint in text output', async () => {
    const { stdout } = await runCommand(['target', 'types'], {
      commands: [createTargetTypesCommand({ output: 'text' })]
    });
    expect(stdout).toContain('target add');
  });

  it('uses text format by default', async () => {
    const { exitCode, stdout } = await runCommand(['target', 'types'], {
      commands: [createTargetTypesCommand()]
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('copilot-cli');
    expect(stdout).not.toContain('"status"');
  });
});

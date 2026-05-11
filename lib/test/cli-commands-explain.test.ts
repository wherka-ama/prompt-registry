import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  createExplainCommand,
} from '../src/cli/commands/explain';
import {
  runCommand,
} from '../src/cli/framework';

describe('explain command', () => {
  it('returns a documented entry for a known code', async () => {
    const result = await runCommand(['explain'], {
      commands: [createExplainCommand({ output: 'json', code: 'BUNDLE.NOT_FOUND' })]
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      status: string;
      data: { code: string; namespace: string; summary: string; remediation: string };
    };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.code).toBe('BUNDLE.NOT_FOUND');
    expect(parsed.data.namespace).toBe('BUNDLE');
    expect(parsed.data.summary.length).toBeGreaterThan(0);
    expect(parsed.data.remediation.length).toBeGreaterThan(0);
  });

  it('returns a placeholder for an unknown code in a known namespace', async () => {
    const result = await runCommand(['explain'], {
      commands: [createExplainCommand({ output: 'json', code: 'BUNDLE.SOMETHING_NEW' })]
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      status: string;
      data: { summary: string };
    };
    expect(parsed.status).toBe('ok');
    expect(parsed.data.summary).toMatch(/no catalog entry/);
  });

  it('exits 1 with USAGE.MISSING_FLAG for an unknown namespace', async () => {
    const result = await runCommand(['explain'], {
      commands: [createExplainCommand({ output: 'json', code: 'XYZZY.SOMETHING' })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });

  it('exits 1 with USAGE.MISSING_FLAG when no code is provided', async () => {
    const result = await runCommand(['explain'], {
      commands: [createExplainCommand({ output: 'json', code: '' })]
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    expect(parsed.errors[0].code).toBe('USAGE.MISSING_FLAG');
  });
});

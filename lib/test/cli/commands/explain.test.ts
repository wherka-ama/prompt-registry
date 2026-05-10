/**
 * Phase 4 / Iter 20 — `explain` command tests.
 */
import * as assert from 'node:assert';
import {
  createExplainCommand,
} from '../../../src/cli/commands/explain';
import {
  runCommand,
} from '../../../src/cli/framework';

describe('Phase 4 / Iter 20 — explain command', () => {
  it('returns a documented entry for a known code', async () => {
    const result = await runCommand(['explain'], {
      commands: [createExplainCommand({ output: 'json', code: 'BUNDLE.NOT_FOUND' })]
    });
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as {
      status: string;
      data: { code: string; namespace: string; summary: string; remediation: string };
    };
    assert.strictEqual(parsed.status, 'ok');
    assert.strictEqual(parsed.data.code, 'BUNDLE.NOT_FOUND');
    assert.strictEqual(parsed.data.namespace, 'BUNDLE');
    assert.ok(parsed.data.summary.length > 0);
    assert.ok(parsed.data.remediation.length > 0);
  });

  it('returns a placeholder for an unknown code in a known namespace', async () => {
    const result = await runCommand(['explain'], {
      commands: [createExplainCommand({ output: 'json', code: 'BUNDLE.SOMETHING_NEW' })]
    });
    assert.strictEqual(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as {
      status: string;
      data: { summary: string };
    };
    assert.strictEqual(parsed.status, 'ok');
    assert.ok(parsed.data.summary.includes('no catalog entry'),
      `expected placeholder; got: ${parsed.data.summary}`);
  });

  it('exits 1 with USAGE.MISSING_FLAG for an unknown namespace', async () => {
    const result = await runCommand(['explain'], {
      commands: [createExplainCommand({ output: 'json', code: 'XYZZY.SOMETHING' })]
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
  });

  it('exits 1 with USAGE.MISSING_FLAG when no code is provided', async () => {
    const result = await runCommand(['explain'], {
      commands: [createExplainCommand({ output: 'json', code: '' })]
    });
    assert.strictEqual(result.exitCode, 1);
    const parsed = JSON.parse(result.stdout) as { errors: { code: string }[] };
    assert.strictEqual(parsed.errors[0].code, 'USAGE.MISSING_FLAG');
  });
});

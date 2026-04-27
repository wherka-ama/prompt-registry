/**
 * Phase 5 / Iter 18-19 — FileTreeTargetWriter tests.
 *
 * Each test instantiates the writer with an injected fs that records
 * (mkdir/writeFile) into in-memory maps; no real disk IO.
 */
import * as assert from 'node:assert';
import * as path from 'node:path';
import type {
  Target,
} from '../../src/domain/install';
import {
  filesFromRecord,
} from '../../src/install/extractor';
import {
  expandPath,
  FileTreeTargetWriter,
  resolveLayout,
  type WriterFs,
} from '../../src/install/target-writer';

interface RecordingFs extends WriterFs {
  writes: Map<string, string>;
  mkdirs: Set<string>;
}

const makeFs = (): RecordingFs => {
  const writes = new Map<string, string>();
  const mkdirs = new Set<string>();
  return {
    writes,
    mkdirs,
    writeFile: (p: string, b: string): Promise<void> => {
      writes.set(p, b);
      return Promise.resolve();
    },
    mkdir: (p: string): Promise<void> => {
      mkdirs.add(p);
      return Promise.resolve();
    }
  };
};

const ENV = { HOME: '/home/me' };

describe('Phase 5 / Iter 18-19 — FileTreeTargetWriter', () => {
  it('expandPath handles ${HOME} and tilde', () => {
    assert.strictEqual(expandPath('${HOME}/x', ENV), '/home/me/x');
    assert.strictEqual(expandPath('~/x', ENV), '/home/me/x');
  });

  it('vscode default layout writes into User dir', () => {
    const layout = resolveLayout({ name: 'v', type: 'vscode', scope: 'user' });
    assert.strictEqual(layout.baseDir, '${HOME}/.config/Code/User');
    assert.deepStrictEqual(Object.keys(layout.kindRoutes).toSorted(), [
      'chatmodes/', 'instructions/', 'prompts/'
    ]);
  });

  it('windsurf maps prompts/instructions -> rules and agents -> workflows', () => {
    const layout = resolveLayout({ name: 'w', type: 'windsurf', scope: 'user' });
    assert.strictEqual(layout.kindRoutes['prompts/'], 'rules/');
    assert.strictEqual(layout.kindRoutes['instructions/'], 'rules/');
    assert.strictEqual(layout.kindRoutes['agents/'], 'workflows/');
  });

  it('writes routed files and skips non-routed extras', async () => {
    const fs = makeFs();
    const writer = new FileTreeTargetWriter({ fs, env: ENV });
    const target: Target = {
      name: 'dev', type: 'vscode', scope: 'user',
      path: '/tmp/vscode-user'
    };
    const files = filesFromRecord({
      'deployment-manifest.yml': 'id: foo\n',
      'README.md': '# Foo',
      'prompts/a.md': 'A',
      'chatmodes/b.md': 'B',
      'extra/uncovered.md': 'X'
    });
    const result = await writer.write(target, files);
    assert.deepStrictEqual(result.written.toSorted(), [
      path.join('/tmp/vscode-user/chatmodes', 'b.md'),
      path.join('/tmp/vscode-user/prompts', 'a.md')
    ]);
    assert.deepStrictEqual(result.skipped, ['extra/uncovered.md']);
    // The skip list catches manifest + README before the extras pass.
    assert.strictEqual(fs.writes.has(path.join('/tmp/vscode-user/prompts', 'a.md')), true);
    assert.strictEqual(fs.writes.has(path.join('/tmp/vscode-user', 'README.md')), false);
  });

  it('honors allowedKinds (skips chatmodes when not in the list)', async () => {
    const fs = makeFs();
    const writer = new FileTreeTargetWriter({ fs, env: ENV });
    const target: Target = {
      name: 'dev', type: 'vscode', scope: 'user',
      path: '/tmp/v',
      allowedKinds: ['prompts']
    };
    const files = filesFromRecord({
      'prompts/a.md': 'A',
      'chatmodes/b.md': 'B'
    });
    const result = await writer.write(target, files);
    assert.deepStrictEqual(result.written, [path.join('/tmp/v/prompts', 'a.md')]);
    assert.deepStrictEqual(result.skipped, ['chatmodes/b.md']);
  });

  it('windsurf collapses prompts and instructions into rules/', async () => {
    const fs = makeFs();
    const writer = new FileTreeTargetWriter({ fs, env: ENV });
    const target: Target = {
      name: 'w', type: 'windsurf', scope: 'user',
      path: '/tmp/ws'
    };
    const files = filesFromRecord({
      'prompts/p.md': 'P',
      'instructions/i.md': 'I',
      'agents/a.md': 'A'
    });
    const result = await writer.write(target, files);
    assert.deepStrictEqual(result.written.toSorted(), [
      path.join('/tmp/ws/rules', 'i.md'),
      path.join('/tmp/ws/rules', 'p.md'),
      path.join('/tmp/ws/workflows', 'a.md')
    ]);
  });

  it('claude-code routes prompts/ to commands/ and chatmodes/ to modes/ (D18)', async () => {
    const fs = makeFs();
    const writer = new FileTreeTargetWriter({ fs, env: ENV });
    const target: Target = {
      name: 'cc', type: 'claude-code', scope: 'user', path: '/tmp/cc'
    };
    const files = filesFromRecord({
      'prompts/a.md': 'A',
      'agents/b.md': 'B',
      'instructions/c.md': 'C',
      'chatmodes/d.md': 'D',
      'deployment-manifest.yml': 'manifest'
    });
    const result = await writer.write(target, files);
    assert.deepStrictEqual(result.written.toSorted(), [
      '/tmp/cc/agents/b.md',
      '/tmp/cc/commands/a.md',
      '/tmp/cc/instructions/c.md',
      '/tmp/cc/modes/d.md'
    ]);
    // The manifest is filtered out of writes by the routing logic
    // (no kind prefix matches), so it doesn't end up in either
    // written[] or skipped[]; that's the existing FileTreeTargetWriter
    // contract.
  });

  it('claude-code default base dir expands $HOME', () => {
    const layout = resolveLayout({ name: 'cc', type: 'claude-code', scope: 'user' });
    assert.strictEqual(layout.baseDir, '${HOME}/.claude');
    assert.strictEqual(layout.kindRoutes['prompts/'], 'commands/');
    assert.strictEqual(layout.kindRoutes['chatmodes/'], 'modes/');
  });

  it('mkdir-recursive creates the routed kind subdirs', async () => {
    const fs = makeFs();
    const writer = new FileTreeTargetWriter({ fs, env: ENV });
    const target: Target = { name: 'k', type: 'kiro', scope: 'user', path: '/tmp/k' };
    await writer.write(target, filesFromRecord({}));
    // path.join keeps trailing slashes; we accept either form so the
    // assertion is robust against the normalization choice.
    const has = (p: string): boolean => fs.mkdirs.has(p) || fs.mkdirs.has(p + '/');
    assert.ok(has('/tmp/k/prompts'));
    assert.ok(has('/tmp/k/agents'));
  });
});
